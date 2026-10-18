import type { ElderEvent, FaceState, Product } from '../shared/contracts'

// ask：这句是设备主动提的问题（后端 ask 事件），她回答时问题要留在屏上
export type Line = { id: number; role: 'grandma' | 'ai'; text: string; ask?: boolean }

export type CardView = { product: Product; alternative?: Product; done: boolean }

export type ElderView = {
  face: FaceState
  awake: boolean // 从待机醒来以后为 true，回到 idle 清空
  conversing: boolean // 醒来后收到第一条字幕起为 true：脸缩到左上角
  lines: Line[]
  card: CardView | null
  clock: string | null
}

export const initialView: ElderView = { face: 'idle', awake: false, conversing: false, lines: [], card: null, clock: null }

let nextId = 1

function addLine(v: ElderView, role: Line['role'], text: string, ask = false): ElderView {
  const last = v.lines.at(-1)
  if (last && last.role === role && last.text === text) {
    // 同一句先作为字幕到、再作为 ask 到：只补上「是提问」这个标记
    return ask && !last.ask ? { ...v, lines: [...v.lines.slice(0, -1), { ...last, ask: true }] } : v
  }
  // 卡片已经完成（开心脸盖过章）以后奶奶又开口，说明换了话题，收起卡片
  const card = role === 'grandma' && v.card?.done ? null : v.card
  return { ...v, awake: true, conversing: true, card, lines: [...v.lines, { id: nextId++, role, text, ask }].slice(-12) }
}

// 只做渲染层面的状态整理：所有判断（唤醒、等级、过滤）都在后端
export function elderReducer(v: ElderView, e: ElderEvent | { type: 'socket_down' }): ElderView {
  switch (e.type) {
    case 'socket_down':
      return { ...initialView, clock: v.clock }
    case 'state':
      if (e.state === 'idle') return { ...initialView, clock: v.clock }
      return {
        ...v,
        face: e.state,
        awake: true,
        card: e.state === 'happy' && v.card ? { ...v.card, done: true } : v.card,
      }
    case 'transcript':
      return addLine(v, e.role, e.text)
    case 'ask':
      // 设备主动开口是新话题：已经下过单的卡片收起来
      return addLine(v.card?.done ? { ...v, card: null } : v, 'ai', e.text, true)
    case 'card':
      return { ...v, awake: true, conversing: true, card: { product: e.product, alternative: e.alternative, done: false } }
    case 'clock':
      return { ...v, clock: e.now }
    case 'speak':
      return v
    default:
      // 契约之外的事件（比如后端的 connected）不影响画面
      return v
  }
}
