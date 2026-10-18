import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { dayAndTime, hoursBetween } from '../shared/format'

// 演示时钟往后跳超过 1 小时（比如推到到货那天）时，屏幕顶部中间出一条大字时间条，让评委看懂时间过去了；不盖住画面中间的字幕
export default function ClockJump({ clock }: { clock: string | null }) {
  const prev = useRef<string | null>(null)
  const hide = useRef<number | undefined>(undefined)
  const [shown, setShown] = useState<{ day: string; time: string; key: string } | null>(null)

  useEffect(() => {
    if (!clock) return
    const last = prev.current
    prev.current = clock
    if (!last || hoursBetween(last, clock) < 1) return
    setShown({ ...dayAndTime(clock), key: clock })
    // 收起的计时只跟这一次跳转走：2.6 秒内再来一个小的时钟变化，也不会把它取消、让时间条一直挂着
    window.clearTimeout(hide.current)
    hide.current = window.setTimeout(() => setShown(null), 2600)
  }, [clock])

  useEffect(() => () => window.clearTimeout(hide.current), [])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.key}
          className="clock-jump"
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        >
          <motion.div className="clock-jump__card">
            <span className="clock-jump__day">{shown.day}</span>
            <span className="clock-jump__time">{shown.time}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
