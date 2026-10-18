import { Check, Pill, X } from 'lucide-react'
import type { Order, Product, RiskKind } from '../contracts'
import { money, splitName } from '../format'
import { productImage } from '../productImages'
import './product-card.css'

// 有风险时不显示价格（划掉的价格在购物界面里会被读成「打折」），换成一句很短的原因
const RISK_LINE: Record<RiskKind, string> = {
  fda_fraud: 'On FDA fraud list',
  recall: 'Recalled',
  unverified: "Not on Milo's list",
}

type Props = {
  product: Product
  size?: 'elder' | 'compact'
  orderStatus?: Order['status'] // 只有后端确认的订单状态才显示成功章
  paymentCheck?: Order['payment_check'] // Visa 沙盒卡校验通过时章下多一行
  tag?: string // 并排时卡片顶部的小标签（Skip this / Try this）
}

// 两端共用：老人端大卡、监护人端小卡是同一个组件
export default function ProductCard({ product, size = 'elder', orderStatus, paymentCheck, tag }: Props) {
  const done = orderStatus === 'paid' || orderStatus === 'simulated_paid'
  const img = product.image_url ?? productImage(product.id)
  const risk = product.risk
  const [title, sub] = splitName(product.name)
  return (
    <article className={`pcard pcard--${size}${risk ? ' pcard--risk' : ''}${done ? ' pcard--done' : ''}`}>
      {tag && <span className="pcard__tag">{tag}</span>}
      <div className="pcard__media">
        {img ? <img src={img} alt="" draggable={false} /> : <span className="pcard__mono">{title.slice(0, 1)}</span>}
        {done && (
          <div className="pcard__stamp" role="status">
            <Check aria-hidden strokeWidth={3.4} />
            <span className="pcard__stamp-text">
              Ordered
              {/* 老人端不说 simulated：状态仍在数据里，监护人端 Money 页底部注明一次。卡校验通过时加一行 */}
              {paymentCheck?.approved && <small className="pcard__visa">Card checked with Visa</small>}
            </span>
          </div>
        )}
      </div>
      <div className="pcard__body">
        <div className="pcard__head">
          <h3 className="pcard__name">
            <span className="pcard__title">{title}</span>
            {sub && <span className="pcard__sub">{sub}</span>}
          </h3>
          {!risk && <div className="pcard__price">{money(product.price_cents)}</div>}
        </div>
        <ul className="pcard__points">
          <li className={`pcard__point ${risk ? 'is-risk' : 'is-ok'}`}>
            <span className="pcard__mark" aria-hidden>{risk ? <X strokeWidth={3.2} /> : <Check strokeWidth={3.2} />}</span>
            <span className="pcard__point-text">
              <strong>{risk ? 'Not verified' : 'Verified'}</strong>
              <span>{risk ? RISK_LINE[risk.kind] : product.certification ?? "On Milo's list"}</span>
            </span>
          </li>
          {!risk && product.label_dose && (
            <li className="pcard__point is-dose">
              <span className="pcard__mark" aria-hidden><Pill strokeWidth={2.6} /></span>
              <span className="pcard__point-text"><span>{product.label_dose}</span></span>
            </li>
          )}
        </ul>
      </div>
    </article>
  )
}
