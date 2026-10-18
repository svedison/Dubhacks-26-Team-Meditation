import { MicVAD } from '@ricky0123/vad-web'
import { WaveFile } from 'wavefile'
import { api } from '../config'

// 麦克风常开：Silero VAD 自带的 AudioWorklet 取流并重采样到 16 kHz，有两种上传方式：
// - utterance（老人端）：VAD 判定一句话说完，把这一整句（含 400 ms 预录）打包成 WAV，POST /api/audio 一次。
//   后端 B 的 /api/audio 每个请求按一整句转写（server/README.md「对接规则」）。
// - stream（/mic-test 长测）：每帧转 PCM16，按 8 帧一块连续上传，用来验证 30 分钟不断。

const SAMPLE_RATE = 16000
const FRAMES_PER_CHUNK = 8
const CHUNK_MS = FRAMES_PER_CHUNK * 32

export type MicStatus = {
  phase: 'off' | 'starting' | 'on' | 'error'
  error: string | null
  startedAt: number | null
  ctxState: string
  trackState: string
  wakeLock: string
  speaking: boolean
  speechProb: number
  framesSeen: number
  chunksSent: number
  bytesSent: number
  sendErrors: number
  lastSendAt: number | null
  queueMs: number // 排队还没发出去的音频
  dropped: number // 积压超过 30 秒被丢掉的块
  events: string[]
}

type Options = {
  mode: 'utterance' | 'stream'
  onStatus: (s: MicStatus) => void
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
}

function toPcm16(frames: Float32Array[]): Int16Array<ArrayBuffer> {
  const total = frames.reduce((n, f) => n + f.length, 0)
  const out = new Int16Array(total)
  let i = 0
  for (const f of frames) {
    for (let k = 0; k < f.length; k++) {
      const s = Math.max(-1, Math.min(1, f[k]))
      out[i++] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  return out
}

function toWav(audio: Float32Array): Uint8Array<ArrayBuffer> {
  const wav = new WaveFile()
  wav.fromScratch(1, SAMPLE_RATE, '16', toPcm16([audio]))
  return new Uint8Array(wav.toBuffer())
}

export class MicStream {
  private opts: Options
  private vad: MicVAD | null = null
  ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private silence: HTMLAudioElement | null = null
  private wakeLock: WakeLockSentinel | null = null
  private pending: Float32Array[] = []
  private speaking = false
  private held = false
  private seq = 0
  private queue: { pcm: ArrayBuffer; speech: boolean }[] = []
  private inflight = false
  status: MicStatus = {
    phase: 'off', error: null, startedAt: null, ctxState: 'none', trackState: 'none', wakeLock: 'none',
    speaking: false, speechProb: 0, framesSeen: 0, chunksSent: 0, bytesSent: 0, sendErrors: 0, lastSendAt: null, queueMs: 0, dropped: 0, events: [],
  }

  constructor(opts: Options) {
    this.opts = opts
  }

  private emit(patch: Partial<MicStatus>) {
    this.status = { ...this.status, ...patch }
    this.opts.onStatus(this.status)
  }

  private log(msg: string) {
    const line = `${new Date().toLocaleTimeString()} ${msg}`
    console.info('[mic]', line)
    this.emit({ events: [line, ...this.status.events].slice(0, 30) })
  }

  // 必须在用户点击的回调里同步调用（Safari 只在手势里放行 AudioContext 和播放）
  async start() {
    this.emit({ phase: 'starting', error: null })
    const ctx = new AudioContext()
    this.ctx = ctx
    const silence = new Audio('/sounds/silence.m4a')
    silence.loop = true
    this.silence = silence
    const resumed = ctx.resume()
    const played = silence.play()
    const locked = this.requestWakeLock()
    await Promise.all([resumed, played, locked])

    ctx.onstatechange = () => {
      this.emit({ ctxState: ctx.state })
      this.log(`AudioContext -> ${ctx.state}`)
      if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume()
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const track = this.stream.getAudioTracks()[0]
    track.onended = () => { this.emit({ trackState: 'ended', phase: 'error', error: 'microphone track ended' }); this.log('track ended') }
    track.onmute = () => { this.emit({ trackState: 'muted' }); this.log('track muted') }
    track.onunmute = () => { this.emit({ trackState: 'live' }); this.log('track unmuted') }

    const stream = this.stream
    this.vad = await MicVAD.new({
      model: 'v5',
      audioContext: ctx,
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      startOnLoad: false,
      getStream: async () => stream,
      pauseStream: async () => {},
      resumeStream: async () => stream,
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 600,
      minSpeechMs: 250,
      preSpeechPadMs: 400,
      onFrameProcessed: (probs, frame) => this.onFrame(probs.isSpeech, frame),
      onSpeechStart: () => this.onSpeechStart(),
      onSpeechEnd: (audio) => this.onSpeechEnd(audio),
      onVADMisfire: () => this.onSpeechEnd(null),
    })
    await this.vad.start()
    document.addEventListener('visibilitychange', this.onVisibility)

    this.emit({ phase: 'on', startedAt: Date.now(), ctxState: ctx.state, trackState: track.readyState })
    this.log(`mic on, ctx ${ctx.sampleRate} Hz, mode=${this.opts.mode}`)
  }

  private onVisibility = () => {
    this.log(`visibility -> ${document.visibilityState}`)
    if (document.visibilityState === 'visible') void this.requestWakeLock()
  }

  // 屏幕常亮锁只是辅助（真正防锁屏靠 iPad 设置里的自动锁定=永不 + 引导式访问），被拒时在状态里显示，不影响录音
  private async requestWakeLock() {
    if (!('wakeLock' in navigator)) { this.emit({ wakeLock: 'unsupported' }); return }
    const res = await navigator.wakeLock.request('screen').catch((e: Error) => e)
    if (res instanceof Error) { this.emit({ wakeLock: `denied (${res.message})` }); this.log(`wake lock denied: ${res.message}`); return }
    this.wakeLock = res
    this.emit({ wakeLock: 'held' })
    res.addEventListener('release', () => { this.emit({ wakeLock: 'released' }); this.log('wake lock released') })
  }

  // 设备自己在说话时调用 hold(true)：这段时间不上传，避免把自己的声音当成奶奶的话
  hold(on: boolean) {
    this.held = on
    if (on) this.speaking = false
  }

  private onFrame(prob: number, frame: Float32Array) {
    const copy = new Float32Array(frame)
    this.status.framesSeen++
    this.status.speechProb = prob
    if (this.opts.mode === 'stream') {
      this.pending.push(copy)
      if (this.pending.length >= FRAMES_PER_CHUNK) this.flush()
    }
    if (this.status.framesSeen % 8 === 0) this.emit({})
  }

  private onSpeechStart() {
    if (this.held) return
    this.speaking = true
    this.emit({ speaking: true })
    this.opts.onSpeechStart?.()
  }

  private onSpeechEnd(audio: Float32Array | null) {
    if (!this.speaking) return
    this.speaking = false
    this.emit({ speaking: false })
    // 设备自己在说话时听到的不算奶奶的话
    if (audio && !this.held && this.opts.mode === 'utterance') void this.sendUtterance(audio)
    this.opts.onSpeechEnd?.()
  }

  private async sendUtterance(audio: Float32Array) {
    const body = toWav(audio)
    const res = await fetch(api('/api/audio'), { method: 'POST', headers: { 'content-type': 'audio/wav' }, body }).catch((e: Error) => e)
    if (res instanceof Error || !res.ok) {
      const why = res instanceof Error ? res.message : `HTTP ${res.status}`
      console.error('[mic] utterance upload failed', why)
      this.emit({ sendErrors: this.status.sendErrors + 1 })
      this.log(`upload failed: ${why}`)
      return
    }
    this.emit({ chunksSent: this.status.chunksSent + 1, bytesSent: this.status.bytesSent + body.byteLength, lastSendAt: Date.now() })
  }

  private flush() {
    if (this.pending.length === 0) return
    this.queue.push({ pcm: toPcm16(this.pending).buffer, speech: this.speaking })
    this.pending = []
    // 后端连不上时最多积 30 秒，再多就丢最早的
    const max = Math.ceil(30000 / CHUNK_MS)
    if (this.queue.length > max) {
      const dropped = this.queue.splice(0, this.queue.length - max).length
      this.emit({ dropped: this.status.dropped + dropped })
    }
    void this.pump()
  }

  // 同一时间只有一个请求在路上；回来以前新产生的块排队，下一次合并成一个 POST 发出去。
  // 网络慢时每次多带一点，延迟不会越积越多。
  private async pump() {
    if (this.inflight || this.queue.length === 0) return
    this.inflight = true
    const batch = this.queue.splice(0)
    const total = batch.reduce((n, b) => n + b.pcm.byteLength, 0)
    const body = new Uint8Array(total)
    let o = 0
    for (const b of batch) { body.set(new Uint8Array(b.pcm), o); o += b.pcm.byteLength }
    const seq = this.seq++
    const speech = batch.some((b) => b.speech) ? 1 : 0
    const url = api(`/api/audio?seq=${seq}&sr=${SAMPLE_RATE}&speech=${speech}`)
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body }).catch((e: Error) => e)
    this.inflight = false
    if (res instanceof Error || !res.ok) {
      const why = res instanceof Error ? res.message : `HTTP ${res.status}`
      console.error('[mic] upload failed', seq, why)
      this.emit({ sendErrors: this.status.sendErrors + 1 })
      if (this.status.sendErrors % 20 === 1) this.log(`upload failed: ${why}`)
    } else {
      this.emit({ chunksSent: this.status.chunksSent + batch.length, bytesSent: this.status.bytesSent + total, lastSendAt: Date.now(), queueMs: this.queue.length * CHUNK_MS })
    }
    void this.pump()
  }

  async stop() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    await this.vad?.destroy()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.silence?.pause()
    await this.wakeLock?.release()
    await this.ctx?.close()
    this.emit({ phase: 'off' })
  }
}
