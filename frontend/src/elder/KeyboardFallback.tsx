import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'

// 键盘兜底：连点左下角三次弹出输入框，发 utterance {source: "keyboard"}。奶奶看不到这个入口
export default function KeyboardFallback({ name, onSend }: { name: string; onSend: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const taps = useRef<number[]>([])

  const tap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < 900), now]
    if (taps.current.length >= 3) {
      taps.current = []
      setOpen(true)
    }
  }

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
    setOpen(false)
  }

  return (
    <>
      <div className="kb-hotspot" onPointerDown={tap} aria-hidden />
      <AnimatePresence>
        {open && (
          <motion.form
            className="kb-sheet"
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onSubmit={(e) => { e.preventDefault(); submit() }}
          >
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Type what ${name} says`}
              aria-label={`Type what ${name} says`}
              enterKeyHint="send"
            />
            <button type="submit">Send</button>
            <button type="button" className="kb-sheet__close" onClick={() => setOpen(false)}>Close</button>
          </motion.form>
        )}
      </AnimatePresence>
    </>
  )
}
