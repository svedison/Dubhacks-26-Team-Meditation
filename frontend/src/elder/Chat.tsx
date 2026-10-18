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
          initial={{ opacity: 0.35 }}
          animate={{ opacity: 1 }}
          transition={{ delay: counter.word++ * 0.06, duration: 0.25 }}
        >
          {w}
        </motion.span>
      )
    })
  })
}

// 按一句一行的排法估算高度，从 44px 往下试，选放得进字幕区的最大字号（Nunito 粗体平均字宽约 0.52 字号）；档位收窄，各幕字号看起来一致
const SIZES = [44, 40, 36]
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

// 屏幕上只留一问一答：AI 回答时，上面留着她刚说的那句；她在回答设备主动提的问题（ask）时，问题留在上面、她的回答在下面
// （剂量、时间这些要她确认的内容不会被她一句「Okay」顶掉）；其他时候她开口就是新话题，只留她这一句，上一轮的话先退场
function visible(lines: Line[]): Line[] {
  const last = lines.at(-1)
  if (!last) return []
  const prev = lines.at(-2)
  if (last.role === 'grandma') return prev?.ask ? [prev, last] : [last]
  if (last.text.length > 110) return [last]
  return prev && prev.role === 'grandma' ? [prev, last] : [last]
}

type Props = { lines: Line[]; width: number; height: number; headline: boolean }

// 诈骗时（整屏红、没有商品卡）：AI 那段话的第一句单独放大成标题，其余照常；文字还是后端的原话
function HeadlineThenRest({ text, width, height }: { text: string; width: number; height: number }) {
  const [head, ...rest] = sentences(text)
  const counter = { word: 0 }
  return (
    <>
      <span className="chat__headline">{emphasize(head, counter)}</span>
      {rest.length > 0 && (
        <span className="chat__rest" style={{ fontSize: fitSize(rest.join(' '), width, height - 190) }}>
          {rest.map((sent, i) => <span key={i} className="chat__sent">{emphasize(sent, counter)}</span>)}
        </span>
      )}
    </>
  )
}

export default function Chat({ lines, width, height, headline }: Props) {
  // 她的话永远在上面一行、Milo 的字幕在下面：位置固定，不会一会儿在上一会儿在下
  const shown = visible(lines).sort((a, b) => (a.role === b.role ? 0 : a.role === 'grandma' ? -1 : 1))
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
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            // 旧的一句先退场；奶奶那句随后出；AI 那句等它站稳再进来，任何时候两段字都不会叠在一起
            transition={{ duration: 0.45, delay: l.role === 'ai' ? 0.35 : 0.18, ease: [0.43, 0.195, 0.02, 1] }}
          >
            {l.role === 'ai' && headline && l === shown.at(-1) ? (
              <div className="chat__bubble chat__bubble--headline">
                <HeadlineThenRest text={l.text} width={width} height={room} />
              </div>
            ) : (
              <div className="chat__bubble" style={l.role === 'ai' ? { fontSize: fitSize(l.text, width, room) } : undefined}>
                {l.role === 'ai' ? speak(l.text) : l.text}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
