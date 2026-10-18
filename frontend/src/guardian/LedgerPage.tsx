import { useEffect } from 'react'
import ProductCard from '../shared/ui/ProductCard'
import { dayLabel, money } from '../shared/format'
import { useGuardian } from './store'

const LEVEL_TEXT = {
  minimum: 'She chose: warnings only.',
  default: 'She chose: monthly total.',
  open: 'She chose: every order.',
} as const

// simulated_paid 必须显示 Simulated（shared-contracts.md）
const STATUS_TEXT = { paid: 'Paid', simulated_paid: 'Simulated', blocked: 'Blocked' } as const

// 后端已按分享层级过滤，这里返回什么就显示什么
export default function LedgerPage() {
  const { ledger, products, settings, loadLedger } = useGuardian()
  // 「月度总额」档后端不推每一单，打开这一页时按当前数据重新拉，总额不会停在旧的数
  useEffect(() => {
    loadLedger().catch((e: Error) => console.error('[guardian] ledger', e.message))
  }, [loadLedger])
  if (!ledger) return <section className="g-page"><h1 className="g-h1">Money</h1><p className="g-lede">Loading…</p></section>
  return (
    <section className="g-page g-ledger">
      <div className="g-ledger__head">
      <h1 className="g-h1">Money</h1>
      <p className="g-lede">{LEVEL_TEXT[ledger.share_level]}</p>
      {ledger.month_total_cents !== null && (
        <div className="g-total">
          <span className="g-total__label">This month</span>
          <span className="g-total__value">{money(ledger.month_total_cents)}</span>
          {settings && <span className="g-total__base">Usually about {money(settings.monthly_baseline_cents)}</span>}
        </div>
      )}
      </div>
      {ledger.orders.length > 0 ? (
        <ul className="g-orders">
          {ledger.orders.slice().reverse().map((o) => (
            <li key={o.id} className="g-order">
              {products[o.product_id] && <ProductCard product={products[o.product_id]} size="compact" />}
              <div className="g-order__meta">
                <span className={`g-pill g-pill--${o.status}`}>{STATUS_TEXT[o.status]}</span>
                <span>{o.status === 'blocked' ? o.block_reason : o.received ? 'Received' : `Arrives ${dayLabel(o.deliver_on)}`}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="g-note">Details stay with her.</p>
      )}
    </section>
  )
}
