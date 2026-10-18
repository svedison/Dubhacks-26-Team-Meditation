// 默认和页面同源（开发时由 Vite 代理到后端，部署时由后端直接托管这些页面）。
// 页面和后端不同源时，构建前设 VITE_BACKEND_URL，例如 https://trusttag.example.com
const BACKEND = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export function api(path: string): string {
  return `${BACKEND}${path}`
}

export function wsUrl(role: 'elder' | 'guardian'): string {
  const base = BACKEND || window.location.origin
  return `${base.replace(/^http/, 'ws')}/ws?role=${role}`
}
