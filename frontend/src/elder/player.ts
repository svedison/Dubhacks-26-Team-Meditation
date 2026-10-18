// 语音播放：有 audio_url 播文件（经 AnalyserNode 取音量给嘴型），没有就用 speechSynthesis。
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
    if (item.audio_url) await this.playUrl(item.audio_url)
    else await this.speak(item.text)
    this.onDone()
    void this.next()
  }

  private playUrl(url: string) {
    return new Promise<void>((resolve, reject) => {
      const el = new Audio(url)
      el.crossOrigin = 'anonymous'
      const src = this.ctx.createMediaElementSource(el)
      src.connect(this.analyser)
      el.onended = () => { src.disconnect(); resolve() }
      el.onerror = () => { src.disconnect(); reject(new Error(`audio failed: ${url}`)) }
      void el.play()
    })
  }

  private speak(text: string) {
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      if (this.voice) u.voice = this.voice
      u.lang = 'en-US'
      u.rate = 0.92
      u.pitch = 1.05
      // speechSynthesis 拿不到音频数据：每读到一个词给嘴型一个脉冲
      u.onboundary = () => { this.ttsLevel = 0.75 + Math.random() * 0.25 }
      u.onstart = () => { this.ttsLevel = 0.8 }
      u.onend = () => { this.ttsLevel = 0; resolve() }
      u.onerror = () => { this.ttsLevel = 0; resolve() }
      speechSynthesis.speak(u)
    })
  }
}
