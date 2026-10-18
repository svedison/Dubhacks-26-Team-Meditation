import { Pause, Play } from 'lucide-react'
import { shortDay, splitName } from '../shared/format'
import { useGuardian } from './store'

const ANSWER_TEXT = { taken: 'Taken', skipped: 'Skipped', later: 'Later', unconfirmed: 'No answer' } as const

export default function MemoryPage() {
  const { memories, products, saveMemory } = useGuardian()
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
                <div><dt>Left</dt><dd>{days} days</dd></div>
                <div><dt>Last dose</dt><dd>{m.log.length ? ANSWER_TEXT[m.log.at(-1)!.answer] : 'Not yet'}</dd></div>
              </dl>
              <button
                  className="g-icon-btn"
                  aria-label={m.paused ? 'Resume reminder' : 'Pause reminder'}
                  onClick={() => void saveMemory({ ...m, paused: !m.paused }).catch((e: Error) => console.error(e))}
                >
                  {m.paused ? <Play strokeWidth={2.4} /> : <Pause strokeWidth={2.4} />}
                  <span>{m.paused ? 'Resume' : 'Pause'}</span>
                </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
