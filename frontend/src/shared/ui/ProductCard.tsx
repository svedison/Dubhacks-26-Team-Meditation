import { Check, Pill, X } from 'lucide-react'
import type { Order, Product, RiskKind } from '../contracts'
import { money, splitName } from '../format'
import { productImage } from '../productImages'
import VisaMark from './VisaMark'
import './product-card.css'

// 有风险时不显示价格（划掉的价格在购物界面里会被读成「打折」），换成一句很短的原因
const RISK_LINE: Record<RiskKind, string> = {
  fda_fraud: 'On FDA fraud list',
  recall: 'Recalled',
  unverified: "Not on Milo's list",
}

// 超过这个长度的名字，和大号价格并排时每行只放得下一两个词
const LONG_TITLE = 18

type Props = {
  product: Product
  size?: 'elder' | 'compact'
  orderStatus?: Order['status'] // 只有后端确认下单成功（paid 或 simulated_paid）才盖章
  tag?: string // 并排时卡片顶部的小标签（Skip this / Try this）
  cardLast4?: string | null // 下单成功后卡片底部那条 Visa 支付条显示的卡尾号
  visaChecked?: boolean // 下单前 Visa 沙盒校验过这张卡：支付条里多一行说明
}

// 两端共用：老人端大卡、监护人端小卡是同一个组件
export default function ProductCard({ product, size = 'elder', orderStatus, tag, cardLast4, visaChecked }: Props) {
  const done = orderStatus === 'paid' || orderStatus === 'simulated_paid'
  const img = product.image_url ?? productImage(product.id)
  const risk = product.risk
  const [title, sub] = splitName(product.name)
  // 商品目录里的真实商品名常有四五十个字符：名字长时价格挪到名字下面，名字独占一整行宽度
  const long = title.length > LONG_TITLE
  return (
    <article className={`pcard pcard--${size}${risk ? ' pcard--risk' : ''}${done ? ' pcard--done' : ''}${long ? ' pcard--long' : ''}`}>
      {tag && <span className="pcard__tag">{tag}</span>}
      {/* 商店的商品照片是白底包装图，整张放进来不裁；我们自己出的场景图铺满 */}
      <div className={`pcard__media${product.image_url ? ' pcard__media--photo' : ''}`}>
        {img ? <img src={img} alt="" draggable={false} /> : <span className="pcard__mono">{title.slice(0, 1)}</span>}
        {done && (
          <div className="pcard__stamp" role="status">
            <Check aria-hidden strokeWidth={3.4} />
            Ordered
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
        {/* 后端确认下单以后，章盖下去，紧接着从卡片底部滑出这条：用哪张卡付的 */}
        {done && cardLast4 && (
          <div className="pcard__pay">
            <VisaMark height={30} />
            <span className="pcard__pay-text">
              <span className="pcard__pay-num">•••• {cardLast4}</span>
              {visaChecked && <span className="pcard__pay-note">Card checked with Visa</span>}
            </span>
            <span className="pcard__pay-ok" aria-hidden><Check strokeWidth={3.4} /></span>
          </div>
        )}
      </div>
    </article>
  )
}
