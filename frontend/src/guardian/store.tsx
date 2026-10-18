import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../shared/config'
import type { Alert, GuardianEvent, Memory, Order, Product, Settings, ShareLevel } from '../shared/contracts'
import { useSocket, type SocketStatus } from '../shared/useSocket'

// GET /api/orders 的返回形状见 shared-contracts.md「订单与设置响应细节」：minimum 档总额为 null
export type Ledger = { share_level: ShareLevel; month_total_cents: number | null; orders: Order[] }

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
  saveMemory: (id: string, patch: Partial<Omit<Memory, 'id' | 'product_id' | 'log'>>) => Promise<void>
}

const Ctx = createContext<Store | null>(null)

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(api(path), { signal })
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

  const ledgerRequest = useRef<AbortController | null>(null)
  const changingSharing = useRef(0)
  const settingsQueue = useRef(Promise.resolve())
  const cancelLedger = useCallback(() => {
    ledgerRequest.current?.abort()
    ledgerRequest.current = null
  }, [])
  const loadLedger = useCallback(async (replace = true) => {
    if (changingSharing.current || (!replace && ledgerRequest.current)) return
    cancelLedger()
    const request = new AbortController()
    ledgerRequest.current = request
    // A stalled request must not block later refreshes indefinitely.
    const timeout = window.setTimeout(() => {
      request.abort()
      if (ledgerRequest.current === request) ledgerRequest.current = null
    }, 10000)
    try {
      const next = await getJson<Ledger>('/api/orders', request.signal)
      if (!request.signal.aborted && ledgerRequest.current === request) setLedger(next)
    } catch (error) {
      if (!request.signal.aborted) throw error
    } finally {
      window.clearTimeout(timeout)
      if (ledgerRequest.current === request) ledgerRequest.current = null
    }
  }, [cancelLedger])
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
    if (status !== 'open') return
    loadAll()
    // Default sharing deliberately has no ordinary-order WS event. Refresh the
    // filtered REST ledger without changing what the family is allowed to see.
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void loadLedger(false).catch((e: Error) => console.error('[guardian] ledger', e.message))
      }
    }
    const interval = window.setInterval(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      cancelLedger()
    }
  }, [status, loadAll, loadLedger, cancelLedger])

  const archive = async (id: string) => {
    setAlerts((a) => a.map((x) => (x.id === id ? { ...x, archived: true } : x)))
    await send(`/api/alerts/${encodeURIComponent(id)}/archive`, 'POST')
  }

  const saveSettings = async (patch: Partial<Settings>) => {
    const changesSharing = 'share_level' in patch
    if (changesSharing) {
      changingSharing.current++
      cancelLedger()
      setLedger(null)
    }
    // Keep writes in click order, and keep the ledger hidden while any newer
    // sharing choice is queued. An earlier save must not reopen its details.
    const saved = settingsQueue.current.then(async () => {
      try {
        const next = (await send('/api/settings', 'PUT', patch)) as Settings
        setSettings(next)
      } finally {
        if (changesSharing) {
          changingSharing.current--
          // Also recover the existing permitted ledger if saving failed.
          if (!changingSharing.current) await loadLedger()
        }
      }
    })
    settingsQueue.current = saved.catch(() => {})
    await saved
  }

  const saveMemory: Store['saveMemory'] = async (id, patch) => {
    const saved = await send(`/api/memories/${encodeURIComponent(id)}`, 'PUT', patch) as Memory
    setMemories((list) => upsert(list, saved))
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
