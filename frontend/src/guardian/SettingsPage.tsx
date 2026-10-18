import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Settings, ShareLevel } from '../shared/contracts'
import { useGuardian } from './store'

const LEVELS: { id: ShareLevel; title: string; body: string }[] = [
  { id: 'minimum', title: 'Warnings only', body: 'Scams and fakes. Always on.' },
  { id: 'default', title: 'Monthly total', body: 'Plus one number a month.' },
  { id: 'open', title: 'Every order', body: 'Plus each thing she buys.' },
]

export default function SettingsPage() {
  const { settings, saveSettings } = useGuardian()
  const [draft, setDraft] = useState<Pick<Settings, 'card_last4' | 'card_owner' | 'monthly_baseline_cents'> | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) setDraft({ card_last4: settings.card_last4, card_owner: settings.card_owner, monthly_baseline_cents: settings.monthly_baseline_cents })
  }, [settings])

  if (!settings || !draft) return <section className="g-page"><h1 className="g-h1">Settings</h1><p className="g-lede">Loading…</p></section>
  const name = settings.elder_name

  const saveCard = () => {
    void saveSettings(draft)
      .then(() => { setSaved(true); window.setTimeout(() => setSaved(false), 1800) })
      .catch((e: Error) => console.error(e))
  }

  return (
    <section className="g-page">
      <h1 className="g-h1">Settings</h1>

      <h2 className="g-h2">What {name} shares</h2>
      <p className="g-note">She decides.</p>
      <div className="g-levels" role="radiogroup" aria-label="Share level">
        {LEVELS.map((l) => {
          const on = settings.share_level === l.id
          return (
            <button
              key={l.id}
              role="radio"
              aria-checked={on}
              className={`g-level${on ? ' is-on' : ''}`}
              onClick={() => void saveSettings({ share_level: l.id }).catch((e: Error) => console.error(e))}
            >
              <span className="g-level__dot" aria-hidden>{on && <Check strokeWidth={3} />}</span>
              <span className="g-level__text">
                <strong>{l.title}</strong>
                <span>{l.body}</span>
              </span>
            </button>
          )
        })}
      </div>

      <h2 className="g-h2">Card</h2>
      <div className="g-form">
        <label className="g-field">
          <span>Last 4 digits</span>
          <input inputMode="numeric" maxLength={4} value={draft.card_last4} onChange={(e) => setDraft({ ...draft, card_last4: e.target.value.replace(/\D/g, '') })} />
        </label>
        <div className="g-field">
          <span>Whose card</span>
          <div className="g-seg" role="radiogroup" aria-label="Whose card">
            {(['elder', 'guardian'] as const).map((o) => (
              <button key={o} role="radio" aria-checked={draft.card_owner === o} className={draft.card_owner === o ? 'is-on' : ''} onClick={() => setDraft({ ...draft, card_owner: o })}>
                {o === 'elder' ? 'Hers' : 'Mine'}
              </button>
            ))}
          </div>
        </div>
        <label className="g-field">
          <span>She spends about</span>
          <div className="g-money">
            <span>$</span>
            <input inputMode="numeric" value={Math.round(draft.monthly_baseline_cents / 100)} onChange={(e) => setDraft({ ...draft, monthly_baseline_cents: Number(e.target.value.replace(/\D/g, '') || 0) * 100 })} />
          </div>
        </label>
        <button className="g-save" onClick={saveCard}>{saved ? 'Saved' : 'Save'}</button>
      </div>

      <h2 className="g-h2">She calls it</h2>
      <div className="g-readonly">
        <span className="g-readonly__value">“{settings.wake_name}”</span>
        <span className="g-note">Only she can change it.</span>
      </div>
    </section>
  )
}
