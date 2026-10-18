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

export function dayLabel(date: string): string {
  return parse(date).toFormat('ccc, LLL d')
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
