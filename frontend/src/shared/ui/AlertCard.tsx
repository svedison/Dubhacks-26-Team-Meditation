import { Check, Phone, Pill } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type Ref } from 'react'
import type { Alert } from '../contracts'
import { timeAgo } from '../format'
import './alert-card.css'

type Props = {
  alert: Alert
  now: string | null
  phone: string | null
  fresh: boolean
  // 等后端确认再收卡：失败时卡片留在原处并提示重试
  onArchive: (id: string) => Promise<void>
  // AnimatePresence 的 popLayout 要拿到卡片本身的 DOM 才能让退场的卡片不占位
  ref?: Ref<HTMLElement>
}

const NO_NOTE = "Grandma didn't want to explain this one"

// 等级只按后端给的 level 渲染：red 置顶、中性深色、带 Call 和 Got it；yellow 普通卡无电话；normal 普通卡
export default function AlertCard({ alert, now, phone, fresh, onArchive, ref }: Props) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const archive = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(false)
    try { await onArchive(alert.id) }
    catch { setSaveError(true) }
    finally { setSaving(false) }
  }
  const level = alert.level
  const showNote = level !== 'normal'
  return (
    <motion.article
      ref={ref}
      layout
      className={`acard acard--${level}`}
      initial={fresh ? { opacity: 0, y: -28, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // 点 Got it 后卡片往上收走；「This week」里同时亮起新的一行，看得出它去了哪里
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginBottom: -14, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } }}
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
      {/* 普通卡（比如用药提醒设好了）也能收进本周回顾，不会一直挂在首页 */}
      <div className="acard__actions">
        {level === 'red' && phone && (
          <a className="btn btn--call" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
            <Phone aria-hidden strokeWidth={2.4} /> Call
          </a>
        )}
        <button className="btn btn--ghost" disabled={saving} onClick={() => void archive()}>
          <Check aria-hidden strokeWidth={2.6} /> {saving ? 'Saving…' : 'Got it'}
        </button>
      </div>
      {saveError && <p className="acard__error" role="alert">Didn't save. Try again.</p>}
    </motion.article>
  )
}
