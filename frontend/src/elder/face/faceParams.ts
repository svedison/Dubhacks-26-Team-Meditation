import type { FaceState } from '../../shared/contracts'

export const EYE_FILL = 'var(--face-eye)'

// 每种表情就是一组参数（单位 E = 一只眼睛的中性高度），状态切换时逐项弹簧插值
export type FaceParams = {
  rx: number // 眼睛半宽
  ry: number // 眼睛半高
  dy: number // 整体上下偏移
  lidY: number // 上眼皮线相对眼心的位置，-1 表示不遮
  lidA: number // 上眼皮角度（度），> 0 内侧高外侧低（担心），< 0 内侧低（严肃）
  bot: number // 下边咬口：0 时咬到眼心，0.6 以上不咬
  brow: number // 眉毛显隐 0..1
  browA: number // 眉毛角度，> 0 内侧抬高
  browGap: number // 眉毛离眼睛上缘的距离
  blush: number // 腮红显隐
  mouth: number // 嘴显隐
  mouthW: number
  mouthH: number
  mouthTalk: number // 嘴随音量张合的幅度
  orbit: number // 思考时转圈
  bounce: number // 开心时上下晃
  drift: number // 待机微动
  blinkMin: number // 眨眼间隔（秒）
  blinkMax: number
}

export type ParamKey = keyof FaceParams

const base: FaceParams = {
  rx: 0.5, ry: 0.5, dy: 0, lidY: -1, lidA: 0, bot: 0.7, brow: 0, browA: 0, browGap: 0.3, blush: 0,
  mouth: 0, mouthW: 0.45, mouthH: 0.06, mouthTalk: 0, orbit: 0, bounce: 0, drift: 1, blinkMin: 3, blinkMax: 6,
}

export const FACE_PARAMS: Record<FaceState, FaceParams> = {
  // 待机时整张脸不显示（轮播照片），这里给一个合眼的形状，供醒来时从一条线睁开
  idle: { ...base, ry: 0.03, drift: 0, blinkMin: 99, blinkMax: 99 },
  // 在听：拉成竖胶囊（借小智月球车的竖胶囊眼），微动降到最小，眨眼间隔拉长
  listening: { ...base, rx: 0.5, ry: 0.6, drift: 0.4, blinkMin: 4, blinkMax: 8 },
  // 在想：眼睛略扁、往上看，绕小椭圆转圈
  thinking: { ...base, rx: 0.5, ry: 0.45, dy: -0.15, orbit: 1, drift: 0 },
  // 在说：眼睛略扁，嘴跟声音动
  speaking: { ...base, rx: 0.5, ry: 0.47, mouth: 1, mouthTalk: 1 },
  // 开心：下半部分咬成弯月，上下晃，腮红滑进来，外上角两颗小星点
  happy: { ...base, rx: 0.52, ry: 0.52, dy: -0.04, bot: -0.02, blush: 1, bounce: 1, drift: 0 },
  // 担心：眼睛小一点，上眼皮内高外低，眉毛内侧上挑，往下沉一点
  worried: { ...base, rx: 0.45, ry: 0.4, dy: 0.05, lidY: -0.22, lidA: 15, brow: 1, browA: 20, browGap: 0.3, blinkMin: 3, blinkMax: 5 },
  // 警报：睁圆，眉毛平中带一点内侧上扬（「我替你着急」，不是「我在怪你」），嘴一条平线；不笑不晃
  alert: { ...base, rx: 0.5, ry: 0.52, lidY: -0.36, lidA: 0, brow: 1, browA: 10, browGap: 0.24, mouth: 1, mouthW: 0.34, mouthH: 0.05, drift: 0, blinkMin: 5, blinkMax: 8 },
}

export const PARAM_KEYS = Object.keys(base) as ParamKey[]
