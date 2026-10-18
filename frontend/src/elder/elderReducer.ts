import type { ElderEvent, FaceState, Order, Product } from '../shared/contracts'

// ask：这句是设备主动提的问题（后端 ask 事件），她回答时问题要留在屏上
export type Line = { id: number; role: 'grandma' | 'ai'; text: string; ask?: boolean }

// answered：卡片出来以后她开过口（用来判断换话题时该不该收卡）。盖章只认后端的 order 事件：报价、拒单（"Okay, I won't
// order it"）都是开心脸，开心脸本身不代表下单成功；orderStatus 为 simulated_paid 时卡片标 Simulated order
export type CardView = { product: Product; alternative?: Product; done: boolean; answered: boolean; orderStatus?: Order['status']; paymentCheck?: Order['payment_check'] }

export type ElderView = {
  face: FaceState
  awake: boolean // 从待机醒来以后为 true，回到 idle 清空
  conversing: boolean // 醒来后收到第一条字幕起为 true：脸缩到左上角
  lines: Line[]
  card: CardView | null
  clock: string | null
  // 后端还在待机时收到的她的话：不显示、不唤醒；后端紧接着醒来（她说的是「Milo, …」）才补成第一行字幕
  heardWhileIdle: { text: string; at: number } | null
  // 这一轮（从她上一句话算起）后端有没有发过商品卡
  cardThisTurn: boolean
}

export const initialView: ElderView = { face: 'idle', awake: false, conversing: false, lines: [], card: null, clock: null, heardWhileIdle: null, cardThisTurn: false }

// 后端醒来时先发她那句字幕、紧跟着发状态，两者间隔是毫秒级；超过这个时间的待机字幕是旧闲聊
const WAKE_WINDOW_MS = 2500

let nextId = 1

function addLine(v: ElderView, role: Line['role'], text: string, ask = false): ElderView {
  const last = v.lines.at(-1)
  if (last && last.role === role && last.text === text) {
    // 同一句先作为字幕到、再作为 ask 到：只补上「是提问」这个标记
    return ask && !last.ask ? { ...v, lines: [...v.lines.slice(0, -1), { ...last, ask: true }] } : v
  }
  let card = v.card
  let cardThisTurn = v.cardThisTurn
  if (role === 'grandma') {
    // 卡片已经完成（开心脸盖过章）以后她又开口，说明换了话题，收起卡片；没完成的卡片记下「她回答过了」
    card = card?.done ? null : card && { ...card, answered: true }
    cardThisTurn = false
  } else if (card && !card.done && !cardThisTurn) {
    // 新的一轮回答没有带商品卡，上一张没成交的卡片已经不是在说的东西了，收起来
    card = null
  }
  return { ...v, awake: true, conversing: true, card, cardThisTurn, lines: [...v.lines, { id: nextId++, role, text, ask }].slice(-12) }
}

// 只做渲染层面的状态整理：所有判断（唤醒、等级、过滤）都在后端
export function elderReducer(v: ElderView, e: ElderEvent | { type: 'socket_down' }): ElderView {
  switch (e.type) {
    case 'socket_down':
      return { ...initialView, clock: v.clock }
    case 'state': {
      if (e.state === 'idle') return { ...initialView, clock: v.clock }
      const fresh = v.heardWhileIdle && v.face === 'idle' && Date.now() - v.heardWhileIdle.at < WAKE_WINDOW_MS
      const woke = fresh ? addLine(v, 'grandma', v.heardWhileIdle!.text) : v
      return {
        ...woke,
        face: e.state,
        awake: true,
        heardWhileIdle: null,
      }
    }
    case 'transcript':
      // 待机时麦克风听到的闲聊（没有叫 Milo，后端也没醒）：先记着不显示，相框保持照片
      if (v.face === 'idle' && e.role === 'grandma') return { ...v, heardWhileIdle: { text: e.text, at: Date.now() } }
      return addLine(v, e.role, e.text)
    case 'ask':
      // 设备主动开口是新话题：已经下过单的卡片收起来
      return addLine(v.card?.done ? { ...v, card: null, heardWhileIdle: null } : { ...v, heardWhileIdle: null }, 'ai', e.text, true)
    case 'card':
      return { ...v, awake: true, conversing: true, cardThisTurn: true, card: { product: e.product, alternative: e.alternative, done: false, answered: false } }
    case 'order': {
      // 后端只在明确确认且下单成功后发 order：这才是盖章的依据
      if (!v.card || (e.status !== 'paid' && e.status !== 'simulated_paid')) return v
      const product = v.card.alternative?.id === e.product_id ? v.card.alternative
        : v.card.product.id === e.product_id ? v.card.product : null
      return product ? { ...v, card: { product, done: true, answered: true, orderStatus: e.status, paymentCheck: e.payment_check ?? null } } : v
    }
    case 'clock':
      return { ...v, clock: e.now }
    case 'speak':
      return v
    default:
      // 契约之外的事件（比如后端的 connected）不影响画面
      return v
  }
}
