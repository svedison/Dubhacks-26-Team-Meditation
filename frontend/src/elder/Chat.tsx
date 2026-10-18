import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
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

// 按一句一行的排法估算高度，从 44px 往下试，选放得进字幕区的最大字号（Nunito 粗体平均字宽约 0.52 字号）；档位收窄，各幕字号看起来一致。
// 估算只是起点：排出来以后还会实际量一次（见 useFitToBox）
const SIZES = [44, 40, 36]
// 后端会把说明书原文整段念出来（两百多个字符）：实际放不下时继续往下降，最小到这个字号
const MIN_SIZE = 28
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

// 排版以后实际量：字幕区里正在显示的几行加起来比字幕区高，就把 AI 那段的字号每次降 2px，直到放下或到最小字号。
// 卡片进场时字幕列会在 0.6 秒里变窄，宽度变化时重新量；React 下次写入新的估算字号时也从估算值重新开始
function useFitToBox(box: React.RefObject<HTMLDivElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => {
      const target = el.querySelector<HTMLElement>('[data-fit]')
      if (!target) return
      // 正在退场的旧行被 popLayout 改成绝对定位，不占位置，不算
      const rows = [...el.querySelectorAll<HTMLElement>('[data-live]')].filter((r) => getComputedStyle(r).position !== 'absolute')
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0
      const used = () => rows.reduce((h, r) => h + r.offsetHeight, 0) + gap * (rows.length - 1)
      let size = Number(target.dataset.fit)
      target.style.fontSize = `${size}px`
      while (used() > el.clientHeight && size > MIN_SIZE) {
        size -= 2
        target.style.fontSize = `${size}px`
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [box, key])
}

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
  // 按说话的先后从上往下排：她先开口的在上面，Milo 先问的在上面、她的回答在下面
  const shown = visible(lines)
  // 上面还有奶奶那一句时，给它留出约两行的高度
  const room = shown.length > 1 ? height - 110 : height
  const box = useRef<HTMLDivElement>(null)
  // 屏上最多一条 Milo 的话（回答在下，或者提问在上、她的回答在下）：字号只调这一条
  const ai = shown.find((l) => l.role === 'ai')
  const fitSize0 = ai ? fitSize(ai.text, width, room) : 0
  useFitToBox(box, `${shown.map((l) => l.id).join(',')}|${width}|${height}|${fitSize0}`)
  return (
    <div className="chat" ref={box}>
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((l) => (
          <motion.div
            key={l.id}
            layout="position"
            className={`chat__row chat__row--${l.role}`}
            data-live
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
              <div
                className="chat__bubble"
                style={l.role === 'ai' ? { fontSize: fitSize(l.text, width, room) } : undefined}
                data-fit={l === ai ? fitSize0 : undefined}
              >
                {l.role === 'ai' ? speak(l.text) : l.text}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
