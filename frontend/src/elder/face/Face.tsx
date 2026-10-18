import { animate, motionValue, type MotionValue } from 'motion/react'
import { useEffect, useId, useMemo, useRef } from 'react'
import type { FaceState } from '../../shared/contracts'
import { EYE_FILL, FACE_PARAMS, type FaceParams, type ParamKey, PARAM_KEYS } from './faceParams'

// 一张只有眼睛的脸。手法参照 ESP-VoCat、小智 otto 表情和 Anki Vector（见本地参照笔记）：
// 实心暖白眼睛，不画瞳孔；情绪全部靠眼睛轮廓（上眼皮切角、下边削成弯月）+ 眉毛 + 腮红 + 嘴。
// 所有尺寸以 E（一只眼睛的中性高度）为单位，全屏和缩到左上角共用一套参数。

const E = 200
const W = 1000
const H = 660
const CY = H * 0.45
const GAP = 1.35 * E // 两眼中心距
const MOUTH_Y = CY + 0.95 * E
const SPRING = { type: 'spring' as const, stiffness: 240, damping: 24, mass: 1 }

type Props = {
  state: FaceState
  talking: boolean // 正在播放语音：任何表情下都让嘴跟着声音动
  level: () => number // 0..1，嘴型跟着它动
}

type EyeRefs = {
  eye: SVGEllipseElement | null
  lid: SVGPolygonElement | null
  bot: SVGEllipseElement | null
  brow: SVGRectElement | null
  blush: SVGRectElement | null
  spark: SVGPathElement | null
}

export default function Face({ state, talking, level }: Props) {
  const mv = useMemo(
    () => Object.fromEntries(PARAM_KEYS.map((k) => [k, motionValue(FACE_PARAMS.listening[k])])) as Record<ParamKey, MotionValue<number>>,
    [],
  )
  const refs = useRef<[EyeRefs, EyeRefs]>([
    { eye: null, lid: null, bot: null, brow: null, blush: null, spark: null },
    { eye: null, lid: null, bot: null, brow: null, blush: null, spark: null },
  ])
  const mouth = useRef<SVGRectElement | null>(null)
  const uid = useId().replace(/:/g, '')
  const blink = useRef({ start: -10, next: 2.5, double: false })
  const mouthOpen = useRef(0)
  const levelRef = useRef(level)
  levelRef.current = level
  const talk = useMemo(() => motionValue(0), [])

  useEffect(() => {
    const c = animate(talk, talking ? 1 : 0, { duration: 0.2 })
    return () => c.stop()
  }, [talking, talk])

  // 换表情：担心和警报借一次眨眼，在闭眼那一帧换形状（参照 otto）
  useEffect(() => {
    const target: FaceParams = FACE_PARAMS[state]
    const viaBlink = state === 'worried' || state === 'alert'
    const delay = viaBlink ? 0.07 : 0
    if (viaBlink) blink.current.start = performance.now() / 1000
    const controls = PARAM_KEYS.map((k) => animate(mv[k], target[k], { ...SPRING, delay }))
    return () => controls.forEach((c) => c.stop())
  }, [state, mv])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = performance.now() / 1000
      const p = Object.fromEntries(PARAM_KEYS.map((k) => [k, mv[k].get()])) as FaceParams

      // 随机眨眼：间隔 blinkMin..blinkMax 秒，偶尔连眨两下；合 70ms、停 30ms、睁 90ms
      const b = blink.current
      if (t > b.next) {
        b.start = t
        b.double = Math.random() < 0.2
        b.next = t + p.blinkMin + Math.random() * (p.blinkMax - p.blinkMin)
      }
      const blinkAt = (s: number) => {
        const d = t - s
        if (d < 0 || d > 0.19) return 0
        if (d < 0.07) return d / 0.07
        if (d < 0.1) return 1
        return 1 - (d - 0.1) / 0.09
      }
      const closed = Math.max(blinkAt(b.start), b.double ? blinkAt(b.start + 0.28) : 0)

      // 叠加的循环小动作：思考时绕小椭圆转圈，开心时上下晃，其余时候极轻的漂移
      const orbitX = p.orbit * 0.08 * E * Math.cos((2 * Math.PI * t) / 2.4)
      const orbitY = p.orbit * 0.04 * E * Math.sin((2 * Math.PI * t) / 2.4)
      const bounce = p.bounce * 0.06 * E * Math.sin((2 * Math.PI * t) / 1.6)
      const drift = p.drift * 0.012 * E
      const driftX = drift * Math.sin(t * 0.53) + drift * 0.5 * Math.sin(t * 1.7)
      const driftY = drift * 0.6 * Math.sin(t * 0.71 + 1)

      // 嘴：张开 40ms 跟上，合拢 120ms 回落
      const target = Math.min(1, levelRef.current())
      const k = target > mouthOpen.current ? 0.55 : 0.14
      mouthOpen.current += (target - mouthOpen.current) * k
      const tk = talk.get()
      const open = mouthOpen.current * Math.max(p.mouthTalk, tk)
      const mouthShown = Math.max(p.mouth, tk)

      for (const side of [0, 1] as const) {
        const r = refs.current[side]
        const dir = side === 0 ? -1 : 1 // 左眼在左
        const cx = W / 2 + (dir * GAP) / 2 + orbitX + driftX
        const cy = CY + p.dy * E + orbitY + bounce + driftY
        const rx = p.rx * E
        const ry = Math.max(0.025 * E, p.ry * E * (1 - 0.96 * closed))
        r.eye?.setAttribute('cx', `${cx}`)
        r.eye?.setAttribute('cy', `${cy}`)
        r.eye?.setAttribute('rx', `${rx}`)
        r.eye?.setAttribute('ry', `${ry}`)

        // 上眼皮：一条穿过 (cx, cy + lidY·E) 的斜线，以上全遮掉。lidA > 0 表示内侧高、外侧低
        const ly = cy + p.lidY * E
        // 左眼内侧在右（x 增大），右眼内侧在左；SVG 的 y 向下，所以内侧高 = 内侧 y 小
        const slope = dir * Math.tan((p.lidA * Math.PI) / 180)
        const x0 = cx - 1.5 * E
        const x1 = cx + 1.5 * E
        const y0 = ly + slope * (x0 - cx)
        const y1 = ly + slope * (x1 - cx)
        r.lid?.setAttribute('points', `${x0},${y0} ${x1},${y1} ${x1},${cy - 3 * E} ${x0},${cy - 3 * E}`)

        // 下边削成弯月：一个椭圆从下往上咬进眼睛
        r.bot?.setAttribute('cx', `${cx}`)
        r.bot?.setAttribute('cy', `${cy + p.bot * E + 0.62 * E}`)

        // 眉毛：圆头短棒，angle > 0 表示内侧抬高
        const bw = 0.9 * E
        const bh = 0.1 * E
        const bx = cx - bw / 2
        const by = cy - p.ry * E - p.browGap * E - bh / 2
        r.brow?.setAttribute('x', `${bx}`)
        r.brow?.setAttribute('y', `${by - (1 - p.brow) * 0.5 * E}`)
        r.brow?.setAttribute('opacity', `${p.brow}`)
        r.brow?.setAttribute('transform', `rotate(${p.browA * dir} ${cx} ${by + bh / 2})`)

        // 腮红：眼睛外下方的粉色横条（尺寸按 VoCat 产品图量的），从下面滑进来
        const blw = 0.65 * E
        const blh = 0.25 * E
        r.blush?.setAttribute('x', `${cx + dir * 0.35 * E - blw / 2}`)
        r.blush?.setAttribute('y', `${cy + 0.45 * E - blh / 2 + (1 - p.blush) * 0.4 * E}`)
        r.blush?.setAttribute('opacity', `${p.blush * 0.9}`)

        // 小星点：开心时在弯月外上角一闪一闪
        const twinkle = 0.75 + 0.25 * Math.sin(t * 5 + side * 1.7)
        const sx = cx + dir * 0.62 * E
        const sy = cy - 0.5 * E
        r.spark?.setAttribute('transform', `translate(${sx} ${sy}) scale(${p.blush * twinkle * 0.09 * E})`)
        r.spark?.setAttribute('opacity', `${p.blush}`)
      }

      if (mouth.current) {
        const mw = (p.mouthW - 0.1 * open) * E
        const mh = (p.mouthH + 0.3 * open) * E
        const my = MOUTH_Y + p.dy * E + bounce
        mouth.current.setAttribute('x', `${W / 2 - mw / 2 + driftX}`)
        mouth.current.setAttribute('y', `${my - mh / 2}`)
        mouth.current.setAttribute('width', `${mw}`)
        mouth.current.setAttribute('height', `${mh}`)
        mouth.current.setAttribute('rx', `${Math.min(mw, mh) / 2}`)
        mouth.current.setAttribute('opacity', `${mouthShown}`)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mv])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        {/* 眼睛外圈的柔光（借 VoCat 渲染图） */}
        <filter id={`eye-glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={0.05 * E} result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.45 0" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {[0, 1].map((side) => (
          <mask id={`eye-mask-${uid}-${side}`} key={side} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
            <rect x="0" y="0" width={W} height={H} fill="white" />
            <polygon ref={(el) => { refs.current[side as 0 | 1].lid = el }} fill="black" />
            <ellipse ref={(el) => { refs.current[side as 0 | 1].bot = el }} rx={0.78 * E} ry={0.62 * E} fill="black" />
          </mask>
        ))}
      </defs>
      {[0, 1].map((side) => (
        <g key={side}>
          <rect ref={(el) => { refs.current[side as 0 | 1].blush = el }} width={0.65 * E} height={0.25 * E} rx={0.125 * E} fill="var(--face-blush)" opacity="0" />
          <g filter={`url(#eye-glow-${uid})`}>
            <g mask={`url(#eye-mask-${uid}-${side})`}>
              <ellipse ref={(el) => { refs.current[side as 0 | 1].eye = el }} fill={EYE_FILL} />
            </g>
          </g>
          <path ref={(el) => { refs.current[side as 0 | 1].spark = el }} d="M0,-1 C0.12,-0.12 0.12,-0.12 1,0 C0.12,0.12 0.12,0.12 0,1 C-0.12,0.12 -0.12,0.12 -1,0 C-0.12,-0.12 -0.12,-0.12 0,-1 Z" fill="var(--face-spark)" opacity="0" />
          <rect ref={(el) => { refs.current[side as 0 | 1].brow = el }} width={0.9 * E} height={0.1 * E} rx={0.05 * E} fill={EYE_FILL} opacity="0" />
        </g>
      ))}
      <rect ref={mouth} fill={EYE_FILL} opacity="0" />
    </svg>
  )
}
