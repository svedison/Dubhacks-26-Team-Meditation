import ProductCard from '../shared/ui/ProductCard'
import { dayLabel, money } from '../shared/format'
import { useGuardian } from './store'

const LEVEL_TEXT = {
  minimum: 'Mom shares only warnings and unusual patterns.',
  default: 'Mom shares a monthly total, no item details.',
  open: 'Mom shares every order.',
} as const

const STATUS_TEXT = { paid: 'Paid', simulated_paid: 'Paid', blocked: 'Blocked' } as const

// 后端已按分享层级过滤，这里返回什么就显示什么
export default function LedgerPage() {
  const { ledger, products, settings } = useGuardian()
  if (!ledger) return <section className="g-page"><h1 className="g-h1">Spending</h1><p className="g-lede">Loading…</p></section>
  const name = settings?.elder_name ?? 'Mom'
  return (
    <section className="g-page">
      <h1 className="g-h1">Spending</h1>
      <p className="g-lede">{LEVEL_TEXT[ledger.share_level].replace('Mom', name)}</p>
      <div className="g-total">
        <span className="g-total__label">This month</span>
        <span className="g-total__value">{money(ledger.month_total_cents)}</span>
        {settings && <span className="g-total__base">Usually about {money(settings.monthly_baseline_cents)}</span>}
      </div>
      {ledger.orders.length > 0 ? (
        <ul className="g-orders">
          {ledger.orders.slice().reverse().map((o) => (
            <li key={o.id} className="g-order">
              {products[o.product_id] && <ProductCard product={products[o.product_id]} size="compact" />}
              <div className="g-order__meta">
                <span className={`g-pill g-pill--${o.status}`}>{STATUS_TEXT[o.status]}</span>
                <span>{o.received ? 'Received' : `Arrives ${dayLabel(o.deliver_on)}`}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="g-note">Order details stay with {name}. You can change what she shares in Settings, together with her.</p>
      )}
    </section>
  )
}
