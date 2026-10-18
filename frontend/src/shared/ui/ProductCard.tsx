import { Check, X } from 'lucide-react'
import type { Product, RiskKind } from '../contracts'
import { money } from '../format'
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
  done?: boolean // 开心脸出现时盖「Ordered」章
}

// 两端共用：老人端大卡、监护人端小卡是同一个组件
export default function ProductCard({ product, size = 'elder', done = false }: Props) {
  const img = productImage(product.id)
  const risk = product.risk
  return (
    <article className={`pcard pcard--${size}${risk ? ' pcard--risk' : ''}${done ? ' pcard--done' : ''}`}>
      <div className="pcard__media">
        {img ? <img src={img} alt="" draggable={false} /> : <span className="pcard__mono">{product.name.slice(0, 1)}</span>}
      </div>
      <div className="pcard__body">
        <div className={`pcard__seal${risk ? ' pcard__seal--risk' : ''}`}>
          <span className="pcard__seal-mark" aria-hidden>
            {risk ? <X strokeWidth={3.2} /> : <Check strokeWidth={3.2} />}
          </span>
          <span className="pcard__seal-text">
            <strong>{risk ? 'Not verified' : 'Verified'}</strong>
            <span>{risk ? RISK_LINE[risk.kind] : product.certification ?? "On Milo's list"}</span>
          </span>
        </div>
        <h3 className="pcard__name">{product.name}</h3>
        {!risk && <div className="pcard__price">{money(product.price_cents)}</div>}
        {!risk && size === 'compact' && product.label_dose && <p className="pcard__meta">{product.label_dose}</p>}
      </div>
      {done && (
        <div className="pcard__stamp" role="status">
          <Check aria-hidden strokeWidth={3.4} />
          Ordered
        </div>
      )}
    </article>
  )
}
