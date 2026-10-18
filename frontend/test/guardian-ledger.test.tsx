import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GuardianProvider, useGuardian, type Ledger } from '../src/guardian/store'
import type { Memory } from '../src/shared/contracts'

class Socket {
  static CONNECTING = 0
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen?: () => void
  onclose?: () => void
  onmessage?: (e: { data: string }) => void
  constructor() { Socket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  close() { this.readyState = 3; this.onclose?.() }
}

let root: Root
let store: ReturnType<typeof useGuardian>
let current: Ledger
let visible = true
let fetchLedger: () => Promise<Response>
let fetchMock: ReturnType<typeof vi.fn>
let memories: Memory[]
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
function Probe() { const value = useGuardian(); useEffect(() => { store = value }, [value]); return <output>{value.ledger?.month_total_cents ?? 'private'}</output> }
const flush = async (fn: () => void | Promise<unknown> = () => {}) => { await act(async () => { await fn() }) }
const advance = (ms: number) => flush(() => vi.advanceTimersByTimeAsync(ms))
const orderCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/orders')).length

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('WebSocket', Socket)
  Socket.instances = []
  visible = true
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
  current = { share_level: 'default', month_total_cents: 0, orders: [] }
  memories = [{ id: 'mem_demo', product_id: 'glucosamine-usp', dose_text: 'Label dose', times: ['08:00'], start_date: '2026-10-23', end_date: null, stock_units: 89, units_per_dose: 1, paused: false, log: [] }]
  fetchLedger = async () => json(current)
  fetchMock = vi.fn(async (url, init) => {
    if (String(url).endsWith('/api/orders')) return fetchLedger()
    if (String(url).endsWith('/api/memories')) return json(memories)
    if (String(url).endsWith('/api/memories/mem_demo')) {
      const patch = JSON.parse(init.body)
      if ('id' in patch || 'product_id' in patch || 'log' in patch) return new Response('', { status: 400 })
      memories[0] = { ...memories[0], ...patch }; return json(memories[0])
    }
    if (String(url).endsWith('/api/settings')) {
      if (init?.method === 'PUT') {
        current = { share_level: JSON.parse(init.body).share_level, month_total_cents: null, orders: [] }
      }
      return json({ share_level: current.share_level })
    }
    return json([])
  })
  vi.stubGlobal('fetch', fetchMock)
  root = createRoot(document.createElement('div'))
  await flush(() => root.render(<GuardianProvider><Probe /></GuardianProvider>))
  await flush(() => Socket.instances[0].open())
})

afterEach(async () => {
  await flush(() => root.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('default sharing updates monthly total without exposing ordinary orders or requiring a WS order', async () => {
  expect(store.ledger?.month_total_cents).toBe(0)
  current = { ...current, month_total_cents: 1800 }
  await advance(5000)
  expect(store.ledger).toEqual(current)
  expect(store.ledger?.orders).toEqual([])
})

test('hidden pages pause polling and refresh immediately when visible again', async () => {
  visible = false
  await flush(() => document.dispatchEvent(new Event('visibilitychange')))
  const before = orderCalls()
  await advance(15000)
  expect(orderCalls()).toBe(before)
  current = { ...current, month_total_cents: 4200 }
  visible = true
  await flush(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(store.ledger?.month_total_cents).toBe(4200)
})

test('focus refreshes the ledger; disconnect stops polling until reconnect', async () => {
  current = { ...current, month_total_cents: 1800 }
  await flush(() => window.dispatchEvent(new Event('focus')))
  expect(store.ledger?.month_total_cents).toBe(1800)
  await flush(() => Socket.instances[0].close())
  const before = orderCalls()
  await advance(15000)
  expect(orderCalls()).toBe(before)
  current = { ...current, month_total_cents: 4200 }
  await flush(() => Socket.instances.at(-1)!.open())
  expect(store.ledger?.month_total_cents).toBe(4200)
})

test('a late open-sharing response cannot restore details after switching to minimum', async () => {
  let resolveOld!: (r: Response) => void
  fetchLedger = () => new Promise(resolve => { resolveOld = resolve })
  await flush(() => Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'order' }) }))
  fetchLedger = async () => json(current)
  await flush(() => store.saveSettings({ share_level: 'minimum' }))
  await flush(() => resolveOld(json({ share_level: 'open', month_total_cents: 1800, orders: [{ id: 'private-order' }] })))
  expect(store.ledger).toEqual({ share_level: 'minimum', month_total_cents: null, orders: [] })
})

test('slow requests do not overlap and unmount cancels future refreshes', async () => {
  fetchLedger = () => new Promise(() => {})
  await advance(5000)
  expect(orderCalls()).toBeGreaterThan(1)
  const before = orderCalls()
  await advance(5000)
  expect(orderCalls()).toBe(before)
  await flush(() => root.unmount())
  await advance(30000)
  expect(orderCalls()).toBe(before)
})

test('pausing a reminder sends only the changed field and keeps server stock/log authoritative', async () => {
  memories[0] = { ...memories[0], stock_units: 88, log: [{ at: '2026-10-23T08:00:00Z', answer: 'taken' }] }
  await flush(() => store.saveMemory('mem_demo', { paused: true }))
  const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/memories/mem_demo'))!
  expect(JSON.parse(request[1].body)).toEqual({ paused: true })
  expect(store.memories[0]).toEqual(memories[0])
  expect(store.memories[0].stock_units).toBe(88)
})

test('a failed reminder save does not pretend the reminder was paused', async () => {
  fetchMock.mockImplementationOnce(async () => new Response('', { status: 500 }))
  await flush(async () => { await expect(store.saveMemory('mem_demo', { paused: true })).rejects.toThrow() })
  expect(store.memories[0].paused).toBe(false)
})

test('overlapping sharing changes stay private until all writes settle in user order', async () => {
  const writes: { level: string; finish: () => void }[] = []
  const normalFetch = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/api/settings') && init?.method === 'PUT') {
      const level = JSON.parse(init.body).share_level
      return new Promise<Response>(resolve => writes.push({ level, finish: () => {
        current = level === 'open' ? { share_level: 'open', month_total_cents: 1800, orders: [{ id: 'private' } as never] } : { share_level: 'minimum', month_total_cents: null, orders: [] }
        resolve(json({ share_level: level }))
      } }))
    }
    return normalFetch(url, init)
  })
  let first!: Promise<void>, second!: Promise<void>
  await flush(() => { first = store.saveSettings({ share_level: 'open' }); second = store.saveSettings({ share_level: 'minimum' }) })
  expect(store.ledger).toBeNull()
  await flush(() => writes[0].finish())
  expect(store.ledger).toBeNull()
  await advance(5000)
  expect(store.ledger).toBeNull()
  await flush(() => writes[1].finish())
  await flush(() => Promise.all([first, second]))
  expect(store.ledger).toEqual({ share_level: 'minimum', month_total_cents: null, orders: [] })
})
