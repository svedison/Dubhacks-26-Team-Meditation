import { Pause, Play } from 'lucide-react'
import { dayKey, lastSevenDays, shortDay, splitName } from '../shared/format'
import { useGuardian } from './store'

const ANSWER_TEXT = { taken: 'Taken', skipped: 'Skipped', later: 'Later', unconfirmed: 'No answer' } as const

export default function MemoryPage() {
  const { memories, products, saveMemory, clock } = useGuardian()
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
                <div><dt>Left</dt><dd>{days} days</dd></div>
                <div><dt>Last dose</dt><dd>{m.log.length ? ANSWER_TEXT[m.log.at(-1)!.answer] : 'Not yet'}</dd></div>
              </dl>
              {/* 最近 7 天：吃了是实心，没吃或说晚点是空心圈，还没有记录是浅灰 */}
              <ol className="g-mem__week" aria-label="Last 7 days">
                {week.map((d) => {
                  const answers = m.log.filter((l) => dayKey(l.at) === d.key).map((l) => l.answer)
                  const cls = answers.includes('taken') ? 'is-taken' : answers.length ? 'is-missed' : ''
                  return (
                    <li key={d.key} className={cls} aria-label={`${d.key}: ${cls ? (cls === 'is-taken' ? ANSWER_TEXT.taken : ANSWER_TEXT[answers.at(-1)!]) : 'no record'}`}>
                      <i aria-hidden />
                      <span aria-hidden>{d.letter}</span>
                    </li>
                  )
                })}
              </ol>
              <button
                  className="g-icon-btn"
                  aria-label={m.paused ? 'Resume reminder' : 'Pause reminder'}
                  onClick={() => void saveMemory(m.id, { paused: !m.paused }).catch((e: Error) => console.error(e))}
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
