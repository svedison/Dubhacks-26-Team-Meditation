import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../shared/config'
import type { Alert, GuardianEvent, Memory, Order, Product, Settings, ShareLevel } from '../shared/contracts'
import { useSocket, type SocketStatus } from '../shared/useSocket'

// GET /api/orders 的返回形状契约里没写，这里按 tools/mock-server 的实际返回（已写进给用户的接口建议）
export type Ledger = { share_level: ShareLevel; month_total_cents: number; orders: Order[] }

type Store = {
  status: SocketStatus
  clock: string | null
  alerts: Alert[]
  settings: Settings | null
  ledger: Ledger | null
  memories: Memory[]
  products: Record<string, Product>
  freshIds: Set<string> // 刚从 WebSocket 推来的卡片，用来做进场动画
  archive: (id: string) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  saveMemory: (m: Memory) => Promise<void>
}

const Ctx = createContext<Store | null>(null)

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(api(path))
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`)
  return (await r.json()) as T
}

async function send(path: string, method: 'POST' | 'PUT', body?: unknown) {
  const r = await fetch(api(path), { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!r.ok) throw new Error(`${method} ${path} HTTP ${r.status}`)
  return r.json() as Promise<unknown>
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [item, ...list]
  const next = list.slice()
  next[i] = item
  return next
}

export function GuardianProvider({ children }: { children: ReactNode }) {
  const [clock, setClock] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [memories, setMemories] = useState<Memory[]>([])
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())

  const loadLedger = useCallback(() => getJson<Ledger>('/api/orders').then(setLedger), [])
  const loadMemories = useCallback(() => getJson<Memory[]>('/api/memories').then(setMemories), [])

  const loadAll = useCallback(() => {
    // 后端没起来时这里会报错：页面照样渲染空状态，WebSocket 连上后会再拉一次
    Promise.all([
      getJson<Alert[]>('/api/alerts').then(setAlerts),
      getJson<Settings>('/api/settings').then(setSettings),
      getJson<Product[]>('/api/products').then((ps) => setProducts(Object.fromEntries(ps.map((p) => [p.id, p])))),
      loadLedger(),
      loadMemories(),
    ]).catch((e: Error) => console.error('[guardian] load', e.message))
  }, [loadLedger, loadMemories])

  const { status } = useSocket<GuardianEvent, never>('guardian', (e) => {
    if (e.type === 'clock') { setClock(e.now); return }
    if (e.type === 'alert') {
      const { type: _t, ...alert } = e
      setAlerts((a) => upsert(a, alert))
      setFreshIds((s) => new Set(s).add(alert.id))
      return
    }
    // 订单和 Memory 只当作「有变化」的信号，按后端过滤后的结果重新拉
    if (e.type === 'order') void loadLedger().catch((err: Error) => console.error('[guardian] ledger', err.message))
    if (e.type === 'memory') void loadMemories().catch((err: Error) => console.error('[guardian] memories', err.message))
  })

  useEffect(() => {
    if (status === 'open') loadAll()
  }, [status, loadAll])

  const archive = async (id: string) => {
    setAlerts((a) => a.map((x) => (x.id === id ? { ...x, archived: true } : x)))
    await send(`/api/alerts/${encodeURIComponent(id)}/archive`, 'POST')
  }

  const saveSettings = async (patch: Partial<Settings>) => {
    const next = (await send('/api/settings', 'PUT', patch)) as Settings
    setSettings(next)
    // 分享层级一改，账本立刻按新层级重新拉
    if ('share_level' in patch) await loadLedger()
  }

  const saveMemory = async (m: Memory) => {
    setMemories((list) => upsert(list, m))
    await send(`/api/memories/${encodeURIComponent(m.id)}`, 'PUT', m)
  }

  return (
    <Ctx.Provider value={{ status, clock, alerts, settings, ledger, memories, products, freshIds, archive, saveSettings, saveMemory }}>
      {children}
    </Ctx.Provider>
  )
}

export function useGuardian(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useGuardian outside GuardianProvider')
  return s
}
