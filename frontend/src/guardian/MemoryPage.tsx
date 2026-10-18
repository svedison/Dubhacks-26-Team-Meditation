import { Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { dayKey, lastSevenDays, shortDay, splitName } from '../shared/format'
import { useGuardian } from './store'

const ANSWER_TEXT = { taken: 'Taken', skipped: 'Skipped', later: 'Later', unconfirmed: 'No answer' } as const

export default function MemoryPage() {
  const { memories, products, saveMemory, clock } = useGuardian()
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const toggle = async (id: string, paused: boolean) => {
    setSaving(id)
    setSaveError(null)
    try { await saveMemory(id, { paused }) }
    catch { setSaveError(id) }
    finally { setSaving(null) }
  }
  const week = lastSevenDays(clock ?? new Date().toISOString())
  return (
    <section className="g-page g-pills">
      <h1 className="g-h1">Pills</h1>
      <p className="g-lede">Milo reminds her each day.</p>
      {memories.length === 0 && (
        <div className="g-empty">
          <span className="g-empty__eyes" aria-hidden><i /><i /></span>
          <p>Starts when a new bottle arrives.</p>
        </div>
      )}
      <ul className="g-mems">
        {memories.map((m) => {
          const p = products[m.product_id]
          const [name, size] = splitName(p?.name ?? m.product_id)
          const days = Math.floor(m.stock_units / Math.max(1, m.units_per_dose * m.times.length))
          return (
            <li key={m.id} className={`g-mem${m.paused ? ' is-paused' : ''}`}>
              <div className="g-mem__top">
                <h2 className="g-mem__name">
                  {name}
                  {size && <span className="g-mem__size">{size}</span>}
                </h2>
                <p className="g-mem__dose">{m.dose_text} · {m.times.join(', ')}</p>
              </div>
              <dl className="g-mem__facts">
                <div><dt>Since</dt><dd>{shortDay(m.start_date)}</dd></div>
                <div><dt>Left</dt><dd>{days} {days === 1 ? 'day' : 'days'}</dd></div>
                <div><dt>Last dose</dt><dd>{m.log.length ? ANSWER_TEXT[m.log.at(-1)!.answer] : 'Not yet'}</dd></div>
              </dl>
              {/* 最近 7 天：吃了是实心，没吃或说晚点是空心圈，还没有记录是浅灰；开始吃之前的日子是虚线圈，今天外面加一圈 */}
              <ol className="g-mem__week" aria-label="Last 7 days">
                {week.map((d) => {
                  const answers = m.log.filter((l) => dayKey(l.at) === d.key).map((l) => l.answer)
                  const cls = answers.includes('taken') ? 'is-taken' : answers.length ? 'is-missed' : d.key < m.start_date ? 'is-before' : ''
                  return (
                    <li key={d.key} className={cls} aria-label={`${d.key}: ${cls ? (cls === 'is-taken' ? ANSWER_TEXT.taken : ANSWER_TEXT[answers.at(-1)!]) : 'no record'}`}>
                      <i aria-hidden />
                      <span aria-hidden>{d.date}</span>
                    </li>
                  )
                })}
              </ol>
              <button
                  className="g-icon-btn"
                  aria-label={m.paused ? 'Resume reminder' : 'Pause reminder'}
                  disabled={saving !== null}
                  onClick={() => void toggle(m.id, !m.paused)}
                >
                  {m.paused ? <Play strokeWidth={2.4} /> : <Pause strokeWidth={2.4} />}
                  <span>{saving === m.id ? 'Saving…' : m.paused ? 'Resume' : 'Pause'}</span>
                </button>
              {saveError === m.id && <p className="g-error" role="alert">Didn't save. Try again.</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
