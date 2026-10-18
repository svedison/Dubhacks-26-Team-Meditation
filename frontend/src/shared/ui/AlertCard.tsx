import { Check, Phone, Pill } from 'lucide-react'
import { motion } from 'motion/react'
import type { Alert } from '../contracts'
import { timeAgo } from '../format'
import './alert-card.css'

type Props = {
  alert: Alert
  now: string | null
  phone: string | null
  fresh: boolean
  onArchive: (id: string) => void
}

const NO_NOTE = "Grandma didn't want to explain this one"

// 等级只按后端给的 level 渲染：red 置顶、中性深色、带 Call 和 Got it；yellow 普通卡无电话；normal 普通卡
export default function AlertCard({ alert, now, phone, fresh, onArchive }: Props) {
  const level = alert.level
  const showNote = level !== 'normal'
  return (
    <motion.article
      layout
      className={`acard acard--${level}`}
      initial={fresh ? { opacity: 0, y: -28, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // 点 Got it 后卡片往上收走；「This week」里同时亮起新的一行，看得出它去了哪里
      exit={{ opacity: 0, y: -16, scale: 0.96, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
    >
      <header className="acard__head">
        {level === 'red' && <span className="acard__chip">Call today</span>}
        {level === 'yellow' && <span className="acard__chip acard__chip--soft">Take a look</span>}
        {level === 'normal' && <span className="acard__icon" aria-hidden><Pill strokeWidth={2.2} /></span>}
        <time className="acard__time">{timeAgo(alert.created_at, now)}</time>
      </header>
      <h2 className="acard__title">{alert.title}</h2>
      <p className="acard__body">{alert.body}</p>
      {showNote && (
        <blockquote className={`acard__note${alert.grandma_note ? '' : ' acard__note--empty'}`}>
          <span className="acard__note-label">Her words</span>
          <p>{alert.grandma_note ? `“${alert.grandma_note}”` : NO_NOTE}</p>
        </blockquote>
      )}
      {level !== 'normal' && (
        <div className="acard__actions">
          {level === 'red' && phone && (
            <a className="btn btn--call" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
              <Phone aria-hidden strokeWidth={2.4} /> Call
            </a>
          )}
          <button className="btn btn--ghost" onClick={() => onArchive(alert.id)}>
            <Check aria-hidden strokeWidth={2.6} /> Got it
          </button>
        </div>
      )}
    </motion.article>
  )
}
