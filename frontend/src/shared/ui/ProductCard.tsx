import { BadgeCheck, Check, ShieldAlert } from 'lucide-react'
import type { Product, RiskKind } from '../contracts'
import { money } from '../format'
import { productImage } from '../productImages'
import './product-card.css'

const RISK_LABEL: Record<RiskKind, string> = {
  fda_fraud: 'FDA fraud warning',
  recall: 'Recalled',
  unverified: "Can't verify",
}

type Props = {
  product: Product
  size?: 'elder' | 'compact'
  done?: boolean // 开心脸出现时盖「Ordered」章
}

// 两端共用：老人端大卡、监护人端小卡是同一个组件
export default function ProductCard({ product, size = 'elder', done = false }: Props) {
  const img = productImage(product.id)
  const risky = product.risk !== null
  return (
    <article className={`pcard pcard--${size}${risky ? ' pcard--risk' : ''}${done ? ' pcard--done' : ''}`}>
      <div className="pcard__media">
        {img ? <img src={img} alt="" draggable={false} /> : <span className="pcard__mono">{product.name.slice(0, 1)}</span>}
      </div>
      <div className="pcard__body">
        {risky ? (
          <span className="pcard__badge pcard__badge--risk">
            <ShieldAlert aria-hidden strokeWidth={2.4} />
            {RISK_LABEL[product.risk!.kind]}
          </span>
        ) : (
          <span className="pcard__badge pcard__badge--ok">
            <BadgeCheck aria-hidden strokeWidth={2.4} />
            Verified{product.certification ? ` · ${product.certification}` : ''}
          </span>
        )}
        <h3 className="pcard__name">{product.name}</h3>
        <div className="pcard__price">{money(product.price_cents)}</div>
        {product.label_dose && <p className="pcard__meta">{product.label_dose}</p>}
      </div>
      {done && (
        <div className="pcard__stamp" role="status">
          <Check aria-hidden strokeWidth={3} />
          Ordered
        </div>
      )}
    </article>
  )
}
