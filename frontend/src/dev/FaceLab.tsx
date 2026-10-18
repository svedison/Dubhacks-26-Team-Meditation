import { useEffect, useState } from 'react'
import type { FaceState } from '../shared/contracts'
import Face from '../elder/face/Face'

// 开发用：7 种表情并排，外加一个大脸按顺序轮换，用来看形状和过渡
const STATES: FaceState[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'worried', 'alert']
const talk = () => (Math.sin(performance.now() / 90) + 1) / 2

export default function FaceLab() {
  const params = new URLSearchParams(window.location.search)
  const only = params.get('state') as FaceState | null
  const [i, setI] = useState(0)
  useEffect(() => {
    if (only) return
    const t = setInterval(() => setI((n) => (n + 1) % STATES.length), 2200)
    return () => clearInterval(t)
  }, [only])
  const big = only ?? STATES[i]
  if (params.get('solo')) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: big === 'alert' ? 'var(--elder-bg-alert)' : 'var(--elder-bg)' }}>
        <Face state={big} talking={big === 'speaking'} level={talk} hear={talk} />
      </div>
    )
  }
  return (
    <div style={{ background: 'var(--elder-bg)', minHeight: '100dvh', color: '#fff1dc', fontFamily: 'var(--font-ui)', padding: 24 }}>
      <div style={{ height: 420, borderRadius: 28, background: big === 'alert' ? 'var(--elder-bg-alert)' : '#0d0b09', transition: 'background 300ms' }}>
        <Face state={big} talking={big === 'speaking'} level={talk} hear={talk} />
      </div>
      <p style={{ fontSize: 28, margin: '12px 0 20px' }}>{big}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12 }}>
        {STATES.map((s) => (
          <figure key={s} style={{ margin: 0 }}>
            <div style={{ aspectRatio: '1000 / 660', borderRadius: 16, background: s === 'alert' ? 'var(--elder-bg-alert)' : '#0d0b09' }}>
              <Face state={s} talking={s === 'speaking'} level={talk} hear={talk} />
            </div>
            <figcaption style={{ fontSize: 18, marginTop: 6 }}>{s}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
