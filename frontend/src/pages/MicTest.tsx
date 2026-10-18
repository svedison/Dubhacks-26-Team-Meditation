import { useEffect, useRef, useState } from 'react'
import { MicStream, type MicStatus } from '../shared/audio/micStream'

// 开发用：iPad 上点一次开麦，连续录音并上传，屏幕上大字显示是否一直在跑。
// 默认全部上传（?vad=1 时只在有人说话时上传，和老人端正式行为一样）。

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function MicTest() {
  const uploadAll = new URLSearchParams(window.location.search).get('vad') !== '1'
  const mic = useRef<MicStream | null>(null)
  const [s, setS] = useState<MicStatus | null>(null)
  const [now, setNow] = useState(Date.now())
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  function start() {
    const m = new MicStream({ uploadAll, onStatus: setS })
    mic.current = m
    m.start().catch((e: Error) => { console.error(e); setStartError(`${e.name}: ${e.message}`) })
  }

  const stale = s?.lastSendAt ? Math.max(0, now - s.lastSendAt) : null
  const ok = s?.phase === 'on' && (uploadAll ? stale !== null && stale < 2000 : true) && s.trackState === 'live'

  return (
    <div style={{ minHeight: '100dvh', background: '#111', color: '#eee', font: '20px/1.4 -apple-system, system-ui', padding: 32 }}>
      {!s && (
        <button onClick={start} style={{ fontSize: 40, padding: '32px 48px', borderRadius: 24, border: 0, background: '#f5c26b', color: '#111' }}>
          Tap to start mic
        </button>
      )}
      {startError && <p style={{ color: '#ff6b6b', fontSize: 28 }}>Start failed: {startError}</p>}
      {s && (
        <>
          <div style={{ fontSize: 96, fontWeight: 700, color: ok ? '#7bd88f' : '#ff6b6b' }}>
            {s.startedAt ? fmt(now - s.startedAt) : '--:--'} {ok ? 'OK' : s.phase.toUpperCase()}
          </div>
          <div style={{ height: 24, background: '#333', borderRadius: 12, overflow: 'hidden', margin: '16px 0', width: 600 }}>
            <div style={{ height: '100%', width: `${Math.round(s.speechProb * 100)}%`, background: s.speaking ? '#7bd88f' : '#888' }} />
          </div>
          <pre style={{ fontSize: 22 }}>{[
            `mode        ${uploadAll ? 'upload all' : 'VAD gated'}`,
            `ctx         ${s.ctxState}   track ${s.trackState}   wakeLock ${s.wakeLock}`,
            `frames      ${s.framesSeen}   speaking ${s.speaking}`,
            `chunks sent ${s.chunksSent}   ${(s.bytesSent / 1e6).toFixed(1)} MB   errors ${s.sendErrors}`,
            `last send   ${stale === null ? '-' : `${(stale / 1000).toFixed(1)} s ago`}`,
            s.error ? `ERROR       ${s.error}` : '',
          ].join('\n')}</pre>
          <pre style={{ fontSize: 16, color: '#aaa' }}>{s.events.join('\n')}</pre>
        </>
      )}
    </div>
  )
}
