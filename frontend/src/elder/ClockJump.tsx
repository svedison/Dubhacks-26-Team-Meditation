import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { dayAndTime, hoursBetween } from '../shared/format'

// 演示时钟往后跳超过 1 小时（比如推到到货那天）时，屏幕中间出一张大字卡，让评委看懂时间过去了
export default function ClockJump({ clock }: { clock: string | null }) {
  const prev = useRef<string | null>(null)
  const [shown, setShown] = useState<{ day: string; time: string; key: string } | null>(null)

  useEffect(() => {
    if (!clock) return
    const last = prev.current
    prev.current = clock
    if (!last || hoursBetween(last, clock) < 1) return
    setShown({ ...dayAndTime(clock), key: clock })
    const t = window.setTimeout(() => setShown(null), 2600)
    return () => window.clearTimeout(t)
  }, [clock])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.key}
          className="clock-jump"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div className="clock-jump__card" initial={{ y: 24, scale: 0.96 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 24 }}>
            <span className="clock-jump__day">{shown.day}</span>
            <span className="clock-jump__time">{shown.time}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
