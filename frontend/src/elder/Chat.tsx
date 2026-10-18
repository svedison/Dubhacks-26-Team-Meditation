import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Line } from './elderReducer'

// 价格、星期、钟点在 AI 的话里加粗变金色并加下划线（同一字体同一字号，只是排版，不做任何判断）
const EMPHASIS = /(\$\d[\d,]*(?:\.\d{2})?|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|tomorrow|tonight)\b|\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b|\b(?:at )?eight\b)/g

// 一句一行：AI 的一段话按句号、问号、感叹号拆开，句与句之间留空隙，不挤成一大段
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“$])/).filter(Boolean)
}

function speak(text: string): ReactNode[] {
  const counter = { word: 0 }
  return sentences(text).map((sent, i) => (
    <span key={i} className="chat__sent">{emphasize(sent, counter)}</span>
  ))
}

function emphasize(text: string, counter: { word: number }): ReactNode[] {
  const parts = text.split(EMPHASIS)
  return parts.flatMap((part, i) => {
    if (!part) return []
    const em = i % 2 === 1
    // 新的一句按词逐个点亮，老人能跟着读（参照 Serve Robotics 的逐字渐显）
    const words = em ? [part] : part.split(/(\s+)/)
    return words.map((w, j) => {
      if (/^\s+$/.test(w)) return w
      return (
        <motion.span
          key={`${i}-${j}`}
          className={em ? 'chat__em' : undefined}
          initial={{ opacity: 0.12 }}
          animate={{ opacity: 1 }}
          transition={{ delay: counter.word++ * 0.06, duration: 0.25 }}
        >
          {w}
        </motion.span>
      )
    })
  })
}

// 句子越长字越小，保证一屏放得下：短句 52px，中等 46px，长句 40px
function sizeClass(text: string) {
  if (text.length <= 64) return 'chat__bubble--l'
  if (text.length <= 120) return 'chat__bubble--m'
  return 'chat__bubble--s'
}

// 屏幕上只留两句：最新一句，以及它前面紧挨着的另一方的一句；AI 这句太长时只留它自己
function visible(lines: Line[]): Line[] {
  const last = lines.at(-1)
  if (!last) return []
  if (last.role === 'ai' && last.text.length > 110) return [last]
  const prev = lines.at(-2)
  return prev && prev.role !== last.role ? [prev, last] : [last]
}

export default function Chat({ lines }: { lines: Line[] }) {
  return (
    <div className="chat">
      <AnimatePresence initial={false} mode="popLayout">
        {visible(lines).map((l) => (
          <motion.div
            key={l.id}
            layout="position"
            className={`chat__row chat__row--${l.role}`}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.6, delay: 0.12, ease: [0.43, 0.195, 0.02, 1] }}
          >
            <div className={`chat__bubble ${l.role === 'ai' ? sizeClass(l.text) : ''}`}>{l.role === 'ai' ? speak(l.text) : l.text}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
