import { MicVAD } from '@ricky0123/vad-web'
import { api } from '../config'

// 麦克风常开：Silero VAD 自带的 AudioWorklet 取流并重采样到 16 kHz，每帧（512 样本 = 32 ms）转 PCM16，
// 按 8 帧一块 POST /api/audio?seq=&sr=16000&speech=[&end=1]，后端 B 把这些块接进 Deepgram 实时转写。
// - speech（老人端）：只在 VAD 判定有人说话时上传，带 400 ms 预录；一句说完的最后一块带 end=1，后端立刻出最终结果。
// - stream（/mic-test 长测）：不管有没有人说话都连续上传，用来验证 30 分钟不断。

const SAMPLE_RATE = 16000
const FRAMES_PER_CHUNK = 8
const PREROLL_FRAMES = 13 // 约 400 ms
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
  mode: 'speech' | 'stream'
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


export class MicStream {
  private opts: Options
  private vad: MicVAD | null = null
  ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private silence: HTMLAudioElement | null = null
  private wakeLock: WakeLockSentinel | null = null
  private ring: Float32Array[] = []
  private pending: Float32Array[] = []
  private speaking = false
  private held = false
  private seq = 0
  private queue: { pcm: ArrayBuffer; speech: boolean; end: boolean }[] = []
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
      onFrameProcessed: (probs, frame) => this.onFrame(probs.isSpeech, frame),
      onSpeechStart: () => this.onSpeechStart(),
      onSpeechEnd: () => this.onSpeechEnd(),
      onVADMisfire: () => this.onSpeechEnd(),
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
    if (on) {
      // 正在上传的那一句收个尾，让后端结束这一句
      if (this.speaking && this.opts.mode === 'speech') this.flush(true)
      this.pending = []
      this.ring = []
      this.speaking = false
    }
  }

  private onFrame(prob: number, frame: Float32Array) {
    const copy = new Float32Array(frame)
    this.status.framesSeen++
    this.status.speechProb = prob
    if (this.held) return
    if (this.opts.mode === 'stream' || this.speaking) {
      this.pending.push(copy)
      if (this.pending.length >= FRAMES_PER_CHUNK) this.flush(false)
    } else {
      this.ring.push(copy)
      if (this.ring.length > PREROLL_FRAMES) this.ring.shift()
    }
    if (this.status.framesSeen % 8 === 0) this.emit({})
  }

  private onSpeechStart() {
    if (this.held) return
    this.speaking = true
    if (this.opts.mode === 'speech') { this.pending.push(...this.ring); this.ring = [] }
    this.emit({ speaking: true })
    this.opts.onSpeechStart?.()
  }

  private onSpeechEnd() {
    if (!this.speaking) return
    if (this.opts.mode === 'speech') this.flush(true)
    this.speaking = false
    this.emit({ speaking: false })
    this.opts.onSpeechEnd?.()
  }

  private flush(end: boolean) {
    if (this.pending.length === 0 && !end) return
    this.queue.push({ pcm: toPcm16(this.pending).buffer, speech: this.speaking || end, end })
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
    // 合并排队的块，但一句的结尾（end）之后的块留到下一个请求，免得两句话粘在一起
    const endAt = this.queue.findIndex((b) => b.end)
    const batch = this.queue.splice(0, endAt === -1 ? this.queue.length : endAt + 1)
    const total = batch.reduce((n, b) => n + b.pcm.byteLength, 0)
    const body = new Uint8Array(total)
    let o = 0
    for (const b of batch) { body.set(new Uint8Array(b.pcm), o); o += b.pcm.byteLength }
    const seq = this.seq++
    const speech = batch.some((b) => b.speech) ? 1 : 0
    const end = batch.at(-1)!.end
    const url = api(`/api/audio?seq=${seq}&sr=${SAMPLE_RATE}&speech=${speech}${end ? '&end=1' : ''}`)
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
