import { Check } from 'lucide-react'
import { useEffect } from 'react'
import ProductCard from '../shared/ui/ProductCard'
import VisaMark from '../shared/ui/VisaMark'
import { dayLabel, money, shortDay } from '../shared/format'
import { useGuardian } from './store'

const LEVEL_TEXT = {
  minimum: 'She chose: warnings only.',
  default: 'She chose: monthly total.',
  open: 'She chose: every order.',
} as const

// 付成功的单（演示里是模拟支付）都写 Paid；被拦下的写 Blocked
const STATUS_TEXT = { paid: 'Paid', simulated_paid: 'Paid', blocked: 'Blocked' } as const

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
          {settings && (
            // 这个月花了多少，对着她平常一个月的量：一眼看出是多还是少
            <span className="g-total__bar" aria-hidden>
              <i style={{ width: `${Math.min(100, (ledger.month_total_cents / Math.max(1, settings.monthly_baseline_cents)) * 100)}%` }} />
            </span>
          )}
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
                {/* 付成功的单写上用的哪张卡：Visa 标志加尾号；下单前 Visa 沙盒校验过这张卡就再加一个勾 */}
                {o.status !== 'blocked' && settings && (
                  <span className="g-order__card"><VisaMark height={16} /> ••{settings.card_last4}</span>
                )}
                {o.payment_check?.approved && (
                  <span className="g-order__checked"><Check aria-hidden strokeWidth={3.2} />Visa card checked</span>
                )}
                {/* 每一单前面写下单那天，两单同一个东西也分得清 */}
                <span>{shortDay(o.created_at)} · {o.status === 'blocked' ? o.block_reason : o.received ? 'Received' : `Arrives ${dayLabel(o.deliver_on)}`}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="g-note">Details stay with her.</p>
      )}
      {/* 演示里的订单走 Visa 沙盒，不真扣钱：全页只在底部说一次 */}
      <p className="g-ledger__demo"><VisaMark height={13} /> Demo build: orders are placed in the Visa sandbox, no real charge.</p>
    </section>
  )
}
