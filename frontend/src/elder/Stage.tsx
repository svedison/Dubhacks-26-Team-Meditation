import { useEffect, useState, type ReactNode } from 'react'

// 按 iPad mini 横屏的 CSS 尺寸 1133×744 设计，整体等比缩放进当前窗口，Safari 有没有地址栏都不变形
export const STAGE_W = 1133
export const STAGE_H = 744

export default function Stage({ children, background }: { children: ReactNode; background: string }) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <div className="stage-shell" style={{ background }}>
      <div className="stage" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
