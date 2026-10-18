import { Check } from 'lucide-react'
import VisaMark from '../shared/ui/VisaMark'
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
  const [saveError, setSaveError] = useState(false)

  // 只在卡片这几项从后端变了时才重置草稿：点分享级别保存回来，卡片区没保存的修改还在
  const last4 = settings?.card_last4
  const owner = settings?.card_owner
  const baseline = settings?.monthly_baseline_cents
  useEffect(() => {
    if (last4 !== undefined && owner !== undefined && baseline !== undefined) setDraft({ card_last4: last4, card_owner: owner, monthly_baseline_cents: baseline })
  }, [last4, owner, baseline])

  if (!settings || !draft) return <section className="g-page"><h1 className="g-h1">Settings</h1><p className="g-lede">Loading…</p></section>

  // 后端只收 4 位数字的卡尾号（shared-contracts.md），不满 4 位时不让保存
  const cardOk = /^\d{4}$/.test(draft.card_last4)
  // 没改过就是描边的空按钮，改了才变成实心，不和上面的分享选项抢眼
  const dirty = draft.card_last4 !== settings.card_last4 || draft.card_owner !== settings.card_owner || draft.monthly_baseline_cents !== settings.monthly_baseline_cents
  const saveCard = () => {
    setSaveError(false)
    void saveSettings(draft)
      .then(() => { setSaved(true); window.setTimeout(() => setSaved(false), 1800) })
      .catch((e: Error) => { console.error(e); setSaveError(true) })
  }

  return (
    <section className="g-page g-settings">
      <h1 className="g-h1">Settings</h1>

      <div className="g-settings__share">
      <h2 className="g-h2">What she shares</h2>
      <p className="g-note">Choose this with her.</p>
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
      </div>

      <div className="g-settings__card">
      <h2 className="g-h2">Card</h2>
      <div className="g-form">
        {/* 她付钱用的那张卡：Visa 蓝底、白色 Visa 标志、尾号，输入尾号时卡面跟着变 */}
        <div className="g-visa-card" aria-label={`Visa card ending ${draft.card_last4}`}>
          <VisaMark height={36} color="#ffffff" />
          <span className="g-visa-card__chip" aria-hidden />
          <span className="g-visa-card__num">•••• {draft.card_last4.padEnd(4, '·')}</span>
          <span className="g-visa-card__owner">{draft.card_owner === 'elder' ? 'Hers' : 'Mine'}</span>
        </div>
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
          <span>Monthly spend</span>
          <div className="g-money">
            <span>$</span>
            <input inputMode="numeric" value={Math.round(draft.monthly_baseline_cents / 100)} onChange={(e) => setDraft({ ...draft, monthly_baseline_cents: Number(e.target.value.replace(/\D/g, '') || 0) * 100 })} />
          </div>
        </label>
        <button className={`g-save${dirty ? ' is-dirty' : ''}${saved ? ' is-saved' : ''}`} onClick={saveCard} disabled={!cardOk || !dirty}>
          {saved ? <><Check aria-hidden strokeWidth={3} /> Saved</> : 'Save'}
        </button>
        {saveError && <p className="g-error">Didn't save. Try again.</p>}
      </div>

      </div>

      <div className="g-settings__name">
      <h2 className="g-h2">She calls it</h2>
      <div className="g-readonly">
        <span className="g-readonly__value">“{settings.wake_name}”</span>
        <span className="g-note">Only she can change it.</span>
      </div>
      </div>
    </section>
  )
}
