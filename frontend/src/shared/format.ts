import { DateTime } from 'luxon'

export function money(cents: number): string {
  const whole = cents % 100 === 0
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2 }).format(cents / 100)
}

// 按时间串自带的时区解析（setZone），显示的就是后端给的墙上时间："2026-10-23T08:00:00Z" → "Fri 8:00 AM"
function parse(iso: string): DateTime {
  const d = DateTime.fromISO(iso, { setZone: true })
  if (!d.isValid) throw new Error(`bad ISO time: ${iso}`)
  return d
}

export function clockLabel(now: string): string {
  return parse(now).toFormat('ccc h:mm a')
}

// 本周回顾里的时间：和演示时钟同一天写 Today，前一天写 Yesterday，再早写星期几
export function recentLabel(at: string, now: string): string {
  const d = parse(at)
  const days = parse(now).startOf('day').diff(d.startOf('day'), 'days').days
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toFormat('ccc')
  return `${day} ${d.toFormat('h:mm a')}`
}

// 最近 7 天（含今天），按演示时钟算：给用药卡画一周的圆点，下面标几号（星期的首字母有两个 S、两个 T，分不清）
export function lastSevenDays(now: string): { key: string; date: string }[] {
  const today = parse(now).startOf('day')
  return Array.from({ length: 7 }, (_, i) => {
    const d = today.minus({ days: 6 - i })
    return { key: d.toISODate()!, date: d.toFormat('d') }
  })
}

export function dayKey(at: string): string {
  return parse(at).toISODate()!
}

export function dayLabel(date: string): string {
  return parse(date).toFormat('ccc, LLL d')
}

export function shortDay(date: string): string {
  return parse(date).toFormat('LLL d')
}

export function timeAgo(iso: string, now: string | null): string {
  const t = parse(iso)
  const n = now ? parse(now) : DateTime.now()
  const min = Math.round(n.diff(t, 'minutes').minutes)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  if (min < 60 * 24) return `${Math.round(min / 60)} h ago`
  return t.toFormat('LLL d')
}

export function dayAndTime(now: string): { day: string; time: string } {
  const d = parse(now)
  return { day: d.toFormat('cccc'), time: d.toFormat('h:mm a') }
}

// 两个时间点之间相差多少小时（后一个减前一个）
export function hoursBetween(from: string, to: string): number {
  return parse(to).diff(parse(from), 'hours').hours
}

// 名字按第一个逗号或括号断成两行：「Calcium 600mg」大字，「120 tablets」「as seen on TV」小一号（只是排版换行）
export function splitName(name: string): [string, string | null] {
  const m = name.match(/^(.*?)\s*(?:,\s*|\((.*)\)\s*$)(.*)$/)
  if (!m) return [name, null]
  return [m[1], (m[2] ?? m[3]).trim() || null]
}
