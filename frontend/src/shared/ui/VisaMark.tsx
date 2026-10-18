import { siVisa } from 'simple-icons'

// Visa 官方字标（simple-icons 收录的图形），默认用 Visa 标准蓝；放在深色底上时传 color 换成白色
export default function VisaMark({ height = 16, color = `#${siVisa.hex}`, className }: { height?: number; color?: string; className?: string }) {
  // 图形在 24×24 的画布里横向铺满、上下留白：只截有字的那一条（y 8.124 起，高 7.751），宽高比约 3.1 : 1
  return (
    <svg className={className} viewBox="0 8.124 24 7.751" height={height} width={height * (24 / 7.751)} role="img" aria-label="Visa">
      <path d={siVisa.path} fill={color} />
    </svg>
  )
}
