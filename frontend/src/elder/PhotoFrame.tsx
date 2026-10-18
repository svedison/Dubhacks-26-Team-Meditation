import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

// 待机：和普通电子相框一样全屏轮播家庭照片，每张 5 秒，交叉淡入，慢慢推近。醒着说话时停在当前这张，不在对话中途换照片
export default function PhotoFrame({ photos, paused }: { photos: string[]; paused: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (photos.length < 2 || paused) return
    const t = setInterval(() => setI((n) => (n + 1) % photos.length), 5000)
    return () => clearInterval(t)
  }, [photos.length, paused])
  const src = photos[i % photos.length]
  return (
    <div className="photo-frame">
      <AnimatePresence initial={false}>
        <motion.img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className="photo-frame__img"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1.12 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1.2, ease: 'easeInOut' }, scale: { duration: 6.5, ease: 'linear' } }}
        />
      </AnimatePresence>
    </div>
  )
}
