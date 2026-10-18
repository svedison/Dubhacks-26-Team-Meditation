import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

// 待机：和普通电子相框一样全屏轮播家庭照片，每张 5 秒，交叉淡入，慢慢推近。醒着说话时停在当前这张，不在对话中途换照片；
// 演示时钟跳到另一天时换下一张，画面本身就告诉人「过了几天」
export default function PhotoFrame({ photos, paused, day }: { photos: string[]; paused: boolean; day: string | null }) {
  const [i, setI] = useState(0)
  const [lastDay, setLastDay] = useState(day)
  if (day !== lastDay) {
    setLastDay(day)
    if (lastDay !== null) setI((n) => (n + 1) % photos.length)
  }
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
