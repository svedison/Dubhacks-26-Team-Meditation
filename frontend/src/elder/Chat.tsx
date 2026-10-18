import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Line } from './elderReducer'

// 价格、星期、钟点在 AI 的话里单独放大（只是排版，不做任何判断）
const EMPHASIS = /(\$\d[\d,]*(?:\.\d{2})?|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|tomorrow|tonight)\b|\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b|\b(?:at )?eight\b)/g

function emphasize(text: string, animate: boolean): ReactNode[] {
  const parts = text.split(EMPHASIS)
  let word = 0
  return parts.flatMap((part, i) => {
    if (!part) return []
    const em = i % 2 === 1
    // 最新一句按词逐个点亮，老人能跟着读（参照 Serve Robotics 的逐字渐显）
    const words = em ? [part] : part.split(/(\s+)/)
    return words.map((w, j) => {
      if (/^\s+$/.test(w)) return w
      const delay = animate ? word++ * 0.06 : 0
      const cls = em ? 'chat__em' : undefined
      return (
        <motion.span
          key={`${i}-${j}`}
          className={cls}
          initial={animate ? { opacity: 0.15 } : false}
          animate={{ opacity: 1 }}
          transition={{ delay, duration: 0.25 }}
        >
          {w}
        </motion.span>
      )
    })
  })
}

export default function Chat({ lines }: { lines: Line[] }) {
  const shown = lines.slice(-4)
  return (
    <div className="chat">
      <AnimatePresence initial={false}>
        {shown.map((l, idx) => {
          const age = shown.length - 1 - idx
          return (
            <motion.div
              key={l.id}
              layout="position"
              className={`chat__row chat__row--${l.role}`}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: age === 0 ? 1 : age === 1 ? 0.62 : 0.32, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.6, ease: [0.43, 0.195, 0.02, 1] }}
            >
              <div className="chat__bubble">{l.role === 'ai' ? emphasize(l.text, age === 0) : l.text}</div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
