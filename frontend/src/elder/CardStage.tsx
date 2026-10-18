import { AnimatePresence, motion } from 'motion/react'
import ProductCard from '../shared/ui/ProductCard'
import type { CardView } from './elderReducer'

// 商品卡片：单张居中；有替代品时左边有风险的、右边替代品，并排
export default function CardStage({ card, cardLast4 }: { card: CardView | null; cardLast4: string | null }) {
  const key = card ? `${card.product.id}-${card.alternative?.id ?? ''}` : 'none'
  return (
    <AnimatePresence mode="wait">
      {card && (
        <motion.div
          key={key}
          className={`card-stage${card.alternative ? ' card-stage--pair' : ''}`}
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          // 字幕列从宽变窄要 0.6 秒，卡片等它让出位置再进来，不压住奶奶那句话
          animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: 0.45, type: 'spring', stiffness: 220, damping: 26 } }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        >
          {card.alternative ? (
            <>
              <div className="card-stage__slot">
                <ProductCard product={card.product} tag="Skip this" />
              </div>
              <motion.div
                className="card-stage__slot"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.8, type: 'spring', stiffness: 200, damping: 24 }}
              >
                <ProductCard product={card.alternative} orderStatus={card.orderStatus} tag="Try this" cardLast4={cardLast4} />
              </motion.div>
            </>
          ) : (
            <div className="card-stage__slot">
              <ProductCard product={card.product} orderStatus={card.orderStatus} cardLast4={cardLast4} quantity={card.quantity} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
