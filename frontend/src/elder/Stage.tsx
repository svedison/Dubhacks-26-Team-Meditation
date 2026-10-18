import { useEffect, useState, type ReactNode } from 'react'

// 按 iPad mini 横屏的 CSS 尺寸设计（高 744）。画布高度固定 744，宽度跟着窗口比例变，整体等比缩放铺满窗口，
// 不留黑边；版面元素都按左右边贴靠，宽度在 1000 以上都成立
export const STAGE_H = 744
const MIN_W = 1000

export default function Stage({ children, background }: { children: ReactNode; background: string }) {
  const [box, setBox] = useState({ scale: 1, w: 1133, h: STAGE_H })
  useEffect(() => {
    const fit = () => {
      const scale = Math.min(window.innerWidth / MIN_W, window.innerHeight / STAGE_H)
      setBox({ scale, w: window.innerWidth / scale, h: window.innerHeight / scale })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <div className="stage-shell" style={{ background }}>
      <div className="stage" style={{ width: box.w, height: box.h, transform: `translate(-50%, -50%) scale(${box.scale})` }}>
        {children}
      </div>
    </div>
  )
}
