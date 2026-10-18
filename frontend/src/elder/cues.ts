import type { FaceState } from '../shared/contracts'

// 7 种状态的提示音，用 WebAudio 现场合成：软、短、不刺耳。
// 在说的声音就是语音本身，待机没有声音。

type Note = { f: number; at: number; dur: number; gain: number; type?: OscillatorType; glideTo?: number }

const CUES: Partial<Record<FaceState, Note[]>> = {
  // 在听：上扬的「嗯？」两个音
  listening: [
    { f: 660, at: 0, dur: 0.12, gain: 0.22, glideTo: 740 },
    { f: 880, at: 0.11, dur: 0.18, gain: 0.2, glideTo: 990 },
  ],
  // 在想：轻轻的三连哼唱
  thinking: [
    { f: 523, at: 0, dur: 0.16, gain: 0.1 },
    { f: 587, at: 0.16, dur: 0.16, gain: 0.1 },
    { f: 659, at: 0.32, dur: 0.24, gain: 0.1 },
  ],
  // 开心：叮咚
  happy: [
    { f: 1047, at: 0, dur: 0.5, gain: 0.24 },
    { f: 784, at: 0.18, dur: 0.8, gain: 0.24 },
  ],
  // 担心：低低往下的「嗯……」
  worried: [{ f: 392, at: 0, dur: 0.5, gain: 0.16, type: 'triangle', glideTo: 330 }],
  // 警报：两声柔和但清楚的提示，三角波，不用尖锐的方波
  alert: [
    { f: 740, at: 0, dur: 0.22, gain: 0.2, type: 'triangle' },
    { f: 554, at: 0.26, dur: 0.34, gain: 0.2, type: 'triangle' },
  ],
}

export function playCue(ctx: AudioContext, state: FaceState) {
  const notes = CUES[state]
  if (!notes) return
  const t0 = ctx.currentTime + 0.02
  for (const n of notes) {
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = n.type ?? 'sine'
    osc.frequency.setValueAtTime(n.f, t0 + n.at)
    if (n.glideTo) osc.frequency.exponentialRampToValueAtTime(n.glideTo, t0 + n.at + n.dur)
    // 钟声一样的包络：5 ms 起音，指数衰减
    amp.gain.setValueAtTime(0.0001, t0 + n.at)
    amp.gain.exponentialRampToValueAtTime(n.gain, t0 + n.at + 0.005)
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
    osc.connect(amp).connect(ctx.destination)
    osc.start(t0 + n.at)
    osc.stop(t0 + n.at + n.dur + 0.05)
  }
}
