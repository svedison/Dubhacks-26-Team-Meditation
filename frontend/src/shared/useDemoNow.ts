import { DateTime } from 'luxon'
import { useEffect, useState } from 'react'

// 后端的演示时钟按真实时间往前走，但只在连上、设时间、重置时才推一次 clock。
// 两端从最近一次收到的值开始自己往前数，每 15 秒刷新一次，保留后端给的时区写法
export function useDemoNow(clock: string | null): string | null {
  const [received, setReceived] = useState<{ clock: string | null; at: number }>({ clock, at: Date.now() })
  const [now, setNow] = useState(Date.now())
  if (received.clock !== clock) setReceived({ clock, at: Date.now() })

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(t)
  }, [])

  if (!received.clock) return null
  const base = DateTime.fromISO(received.clock, { setZone: true })
  if (!base.isValid) throw new Error(`bad clock: ${received.clock}`)
  return base.plus({ milliseconds: Math.max(0, now - received.at) }).toISO()
}
