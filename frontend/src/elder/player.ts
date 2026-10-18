// 语音播放：有 audio_url 就下载解码，用开机时已经启动的 AudioContext 播（经 AnalyserNode 取音量给嘴型），没有就用 speechSynthesis。
// 不用每段新建 <audio>：iPad Safari 只让用户点过的播放器出声，新建的播放器在没有点击时会被拒绝播放。
// 一条一条排队播，每条播完回调 onDone（页面据此发 spoke）。

type Item = { text: string; audio_url: string | null }

export class Player {
  private ctx: AudioContext
  private queue: Item[] = []
  private busy = false
  private analyser: AnalyserNode
  private buf: Uint8Array<ArrayBuffer>
  private ttsLevel = 0
  private voice: SpeechSynthesisVoice | null = null
  private abort: (() => void) | null = null
  private generation = 0 // stop() 以后被打断的那一句不再回 spoke
  onDone: () => void = () => {}
  onBusy: (busy: boolean) => void = () => {}

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.connect(ctx.destination)
    this.buf = new Uint8Array(this.analyser.fftSize)
    const pick = () => {
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
      this.voice = voices.find((v) => /Samantha|Ava|Allison|Susan|Karen/.test(v.name)) ?? voices.find((v) => v.lang === 'en-US') ?? voices[0] ?? null
    }
    pick()
    speechSynthesis.addEventListener('voiceschanged', pick)
  }

  // iOS 要在用户手势里先说一句空话，之后 speechSynthesis 才能在没有手势时发声
  unlock() {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    speechSynthesis.speak(u)
  }

  // 后端断开时调用：清空队列，停掉正在播的声音
  stop() {
    this.generation++
    this.queue = []
    speechSynthesis.cancel()
    this.ttsLevel = 0
    this.abort?.()
  }

  enqueue(item: Item) {
    this.queue.push(item)
    if (!this.busy) void this.next()
  }

  get playing() {
    return this.busy
  }

  // 0..1 的音量，给嘴型用
  level(): number {
    if (!this.busy) return 0
    if (this.ttsLevel > 0) {
      this.ttsLevel *= 0.9
      return this.ttsLevel
    }
    this.analyser.getByteTimeDomainData(this.buf)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) {
      const d = (this.buf[i] - 128) / 128
      sum += d * d
    }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4)
  }

  private async next() {
    const item = this.queue.shift()
    if (!item) {
      this.busy = false
      this.onBusy(false)
      return
    }
    this.busy = true
    this.onBusy(true)
    const gen = this.generation
    try {
      if (item.audio_url) await this.playUrl(item.audio_url, gen)
      else await this.speak(item.text)
    } catch (e) {
      // 这一句的语音拿不到（下载失败、解码失败、8 秒没回应）：报错，这句的字幕已经在屏上，接着播下一句。
      // 不能让播放器一直停在「在说」：那样麦克风一直静音，后面的话也都不播
      console.error('[player] voice failed', e)
    }
    if (gen === this.generation) this.onDone()
    void this.next()
  }

  private async playUrl(url: string, gen: number) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`audio ${res.status}: ${url}`)
    const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer())
    // 下载、解码期间后端断开过（stop() 换了一代）：这句不再播
    if (gen !== this.generation) return
    await new Promise<void>((resolve) => {
      const src = this.ctx.createBufferSource()
      src.buffer = buffer
      src.connect(this.analyser)
      this.abort = () => {
        src.onended = null
        src.stop()
        src.disconnect()
        resolve()
      }
      src.onended = () => {
        src.disconnect()
        resolve()
      }
      src.start()
    })
  }

  private speak(text: string) {
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      if (this.voice) u.voice = this.voice
      u.lang = 'en-US'
      u.rate = 0.92
      u.pitch = 1.05
      // Safari 的 speechSynthesis 偶尔不触发 onend（已知问题）：按字数估一个最长时长，到点就当说完，并记一条警告
      const words = text.split(/\s+/).length
      let done = false
      const finish = (why: string) => {
        if (done) return
        done = true
        window.clearTimeout(watchdog)
        this.ttsLevel = 0
        if (why !== 'end') console.warn(`[player] speech ${why}: "${text.slice(0, 40)}"`)
        resolve()
      }
      const watchdog = window.setTimeout(() => { speechSynthesis.cancel(); finish('timed out') }, 2000 + words * 550)
      this.abort = () => finish('stopped')
      // speechSynthesis 拿不到音频数据：每读到一个词给嘴型一个脉冲
      u.onboundary = () => { this.ttsLevel = 0.75 + Math.random() * 0.25 }
      u.onstart = () => { this.ttsLevel = 0.8 }
      u.onend = () => finish('end')
      u.onerror = (e) => finish(`error ${e.error}`)
      speechSynthesis.speak(u)
    })
  }
}
