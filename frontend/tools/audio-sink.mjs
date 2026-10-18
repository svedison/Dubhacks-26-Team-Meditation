// 开发用的音频接收端：麦克风 30 分钟测试时代替后端的 POST /api/audio，
// 记下每一块到达的时间、大小、音量，并把原始 PCM 存下来，测完用 GET /stats 看有没有断过。
//
//   node tools/audio-sink.mjs                       监听 8788
//   AUDIO_SINK=http://localhost:8788 npm run dev    让 Vite 把 /api/audio 转过来
//   curl localhost:8788/stats                       看统计
//   DELAY_MS=400 node tools/audio-sink.mjs          每个请求晚 400 ms 才回，模拟慢网络

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 8788)
const DELAY_MS = Number(process.env.DELAY_MS ?? 0)
const dir = path.resolve('.devdata/audio-sink', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(dir, { recursive: true })
const logFile = fs.createWriteStream(path.join(dir, 'chunks.jsonl'))
const pcmFile = fs.createWriteStream(path.join(dir, 'audio.s16le'))
const chunks = []

function rms(buf) {
  const s = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2))
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i]
  return s.length ? Math.sqrt(sum / s.length) : 0
}

function stats() {
  if (chunks.length === 0) return { count: 0 }
  const gaps = []
  let maxGap = 0
  for (let i = 1; i < chunks.length; i++) {
    const g = chunks[i].t - chunks[i - 1].t
    maxGap = Math.max(maxGap, g)
    if (g > 2000) gaps.push({ at: new Date(chunks[i - 1].t).toISOString(), ms: g })
  }
  const seqMissing = chunks.at(-1).seq + 1 - chunks.length
  const silent = chunks.filter((c) => c.rms < 1).length
  return {
    dir,
    count: chunks.length,
    first: new Date(chunks[0].t).toISOString(),
    last: new Date(chunks.at(-1).t).toISOString(),
    durationMin: +((chunks.at(-1).t - chunks[0].t) / 60000).toFixed(2),
    audioSeconds: +(chunks.reduce((n, c) => n + c.bytes, 0) / 32000).toFixed(1),
    maxGapMs: maxGap,
    gapsOver2s: gaps,
    seqMissing,
    allZeroChunks: silent,
    speechChunks: chunks.filter((c) => c.speech).length,
    sinceLastMs: Date.now() - chunks.at(-1).t,
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'POST' && url.pathname === '/api/audio') {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => {
      const buf = Buffer.concat(parts)
      const c = { t: Date.now(), seq: Number(url.searchParams.get('seq')), bytes: buf.length,
        speech: url.searchParams.get('speech') === '1', rms: Math.round(rms(buf)) }
      chunks.push(c)
      logFile.write(JSON.stringify(c) + '\n')
      pcmFile.write(buf)
      setTimeout(() => res.writeHead(204).end(), DELAY_MS)
    })
    return
  }
  if (url.pathname === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(stats(), null, 2))
    return
  }
  res.writeHead(404).end()
}).listen(PORT, () => console.log(`audio sink on http://localhost:${PORT}  (writing to ${dir})`))
