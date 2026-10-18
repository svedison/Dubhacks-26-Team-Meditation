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

// 按一句一行的排法估算高度，从 52px 往下试，选放得进字幕区的最大字号（Nunito 粗体平均字宽约 0.52 字号）
const SIZES = [52, 46, 40, 34]
function fitSize(text: string, width: number, height: number): number {
  const inner = width - 60
  for (const size of SIZES) {
    const perLine = Math.floor(inner / (size * 0.52))
    const sents = sentences(text)
    const lines = sents.reduce((n, s) => n + Math.ceil(s.length / perLine), 0)
    const h = lines * size * 1.22 + (sents.length - 1) * size * 0.35 + 38
    if (h <= height) return size
  }
  return SIZES[SIZES.length - 1]
}

// 屏幕上只留两句：最新一句，以及它前面紧挨着的另一方的一句；AI 这句太长时只留它自己
function visible(lines: Line[]): Line[] {
  const last = lines.at(-1)
  if (!last) return []
  if (last.role === 'ai' && last.text.length > 110) return [last]
  const prev = lines.at(-2)
  return prev && prev.role !== last.role ? [prev, last] : [last]
}

type Props = { lines: Line[]; width: number; height: number }

export default function Chat({ lines, width, height }: Props) {
  const shown = visible(lines)
  // 上面还有奶奶那一句时，给它留出约两行的高度
  const room = shown.length > 1 ? height - 110 : height
  return (
    <div className="chat">
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((l) => (
          <motion.div
            key={l.id}
            layout="position"
            className={`chat__row chat__row--${l.role}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            // 奶奶那句先出；AI 那句等它站稳再进来，两句不会同时动
            transition={{ duration: 0.45, delay: l.role === 'ai' ? 0.3 : 0.1, ease: [0.43, 0.195, 0.02, 1] }}
          >
            <div className="chat__bubble" style={l.role === 'ai' ? { fontSize: fitSize(l.text, width, room) } : undefined}>
              {l.role === 'ai' ? speak(l.text) : l.text}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
