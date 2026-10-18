// 字段逐个对照 .plans/shared-contracts.md，不在这里加任何契约之外的字段

export type RiskKind = 'fda_fraud' | 'recall' | 'unverified'

export type Product = {
  id: string
  name: string
  price_cents: number
  category: string
  certification: string | null
  aliases: string[]
  label_dose: string | null
  units: number
  units_per_dose: number
  risk: null | { kind: RiskKind; alternative_id: string }
  image_url?: string | null // 门店正面图（QFC 商品）；没有时老人端按 id 用本地图
}

export type Order = {
  id: string
  product_id: string
  price_cents: number
  status: 'paid' | 'simulated_paid' | 'blocked'
  block_reason: string | null
  created_at: string
  deliver_on: string
  received: boolean
}

export type MemoryAnswer = 'taken' | 'skipped' | 'later' | 'unconfirmed'

export type Memory = {
  id: string
  product_id: string
  dose_text: string
  times: string[]
  start_date: string
  end_date: string | null
  stock_units: number
  units_per_dose: number
  paused: boolean
  log: { at: string; answer: MemoryAnswer }[]
}

export type AlertLevel = 'red' | 'yellow' | 'normal'

export type Alert = {
  id: string
  level: AlertLevel
  rule: number | null
  title: string
  body: string
  grandma_note: string | null
  created_at: string
  archived: boolean
}

export type ShareLevel = 'minimum' | 'default' | 'open'

export type Settings = {
  elder_name: string
  address: string
  phone: string
  card_last4: string
  card_owner: 'elder' | 'guardian'
  monthly_baseline_cents: number
  share_level: ShareLevel
  wake_name: string
  photos: string[]
}

export type FaceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'worried' | 'alert'

// 后端 → 老人端
export type ElderEvent =
  | { type: 'state'; state: FaceState }
  | { type: 'transcript'; role: 'grandma' | 'ai'; text: string }
  | { type: 'speak'; text: string; audio_url: string | null }
  | { type: 'card'; product: Product; alternative?: Product }
  | ({ type: 'order' } & Order)
  | { type: 'clock'; now: string }
  | { type: 'ask'; text: string; audio_url: string | null; kind: 'received' | 'dose_confirm' | 'reminder' }

// 老人端 → 后端
export type ElderOutgoing =
  | { type: 'utterance'; text: string; source: 'voice' | 'keyboard' }
  | { type: 'spoke' }

// 后端 → 监护人端（载荷是对象本身，字段和 type 平铺在同一层）
export type GuardianEvent =
  | ({ type: 'alert' } & Alert)
  | ({ type: 'order' } & Order)
  | ({ type: 'memory' } & Memory)
  | { type: 'clock'; now: string }
