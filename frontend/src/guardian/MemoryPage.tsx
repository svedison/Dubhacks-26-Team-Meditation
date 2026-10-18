import { Pause, Play } from 'lucide-react'
import { dayLabel } from '../shared/format'
import { useGuardian } from './store'

const ANSWER_TEXT = { taken: 'Taken', skipped: 'Skipped', later: 'Later', unconfirmed: 'No answer' } as const

export default function MemoryPage() {
  const { memories, products, settings, saveMemory } = useGuardian()
  const name = settings?.elder_name ?? 'Mom'
  return (
    <section className="g-page">
      <h1 className="g-h1">Reminders</h1>
      <p className="g-lede">What TrustTag reminds {name} to take, from the label on the bottle.</p>
      {memories.length === 0 && <p className="g-note">No reminders yet. One is set up after a delivery arrives and {name} confirms how to take it.</p>}
      <ul className="g-mems">
        {memories.map((m) => {
          const p = products[m.product_id]
          const days = Math.floor(m.stock_units / Math.max(1, m.units_per_dose * m.times.length))
          return (
            <li key={m.id} className={`g-mem${m.paused ? ' is-paused' : ''}`}>
              <div className="g-mem__top">
                <div>
                  <h2 className="g-mem__name">{p?.name ?? m.product_id}</h2>
                  <p className="g-mem__dose">{m.dose_text} · {m.times.join(', ')}</p>
                </div>
                <button
                  className="g-icon-btn"
                  aria-label={m.paused ? 'Resume reminder' : 'Pause reminder'}
                  onClick={() => void saveMemory({ ...m, paused: !m.paused }).catch((e: Error) => console.error(e))}
                >
                  {m.paused ? <Play strokeWidth={2.4} /> : <Pause strokeWidth={2.4} />}
                  <span>{m.paused ? 'Resume' : 'Pause'}</span>
                </button>
              </div>
              <dl className="g-mem__facts">
                <div><dt>Started</dt><dd>{dayLabel(m.start_date)}</dd></div>
                <div><dt>Left</dt><dd>About {days} days</dd></div>
                <div><dt>Last</dt><dd>{m.log.length ? ANSWER_TEXT[m.log.at(-1)!.answer] : 'Not yet'}</dd></div>
              </dl>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
