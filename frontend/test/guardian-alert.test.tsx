import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import AlertCard from '../src/shared/ui/AlertCard'
import type { Alert } from '../src/shared/contracts'

test('archive failure keeps the warning visible and offers a usable retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  const alert: Alert = { id: 'alert_scam', level: 'red', rule: 7, title: 'Check this request', body: 'Gift card request', grandma_note: null, created_at: '2026-10-17T18:00:00Z', archived: false }
  let reject!: (error: Error) => void
  const save = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
  try {
    await act(async () => root.render(<AlertCard alert={alert} now={null} phone={null} fresh={false} onArchive={save} />))
    const button = host.querySelector('button')!
    await act(async () => button.click())
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Saving')
    await act(async () => { reject(new Error('HTTP 503')) })
    expect(host.querySelector('h2')?.textContent).toBe('Check this request')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Didn't save")
    expect(button.disabled).toBe(false)
    save.mockResolvedValueOnce()
    await act(async () => button.click())
    expect(save).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
