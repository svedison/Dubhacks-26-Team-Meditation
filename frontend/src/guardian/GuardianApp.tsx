import { ChevronDown, Home, Pill, ReceiptText, Settings as SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import AlertCard from '../shared/ui/AlertCard'
import { clockLabel, hoursBetween, recentLabel } from '../shared/format'
import LedgerPage from './LedgerPage'
import MemoryPage from './MemoryPage'
import SettingsPage from './SettingsPage'
import { GuardianProvider, useGuardian } from './store'
import './guardian.css'

export default function GuardianApp() {
  return (
    <GuardianProvider>
      <div className="g-app">
        <TopBar />
        <main className="g-main">
          <Pages />
        </main>
        <TabBar />
      </div>
    </GuardianProvider>
  )
}

// 切标签时内容淡入加轻微上移，不再硬切
function Pages() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.1 } }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <Routes location={location}>
          <Route index element={<HomePage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

function TopBar() {
  const { status, clock, alerts } = useGuardian()
  // 页头这双眼睛和相框里是同一双：有没处理的红色警报时是担心的样子，平时慢慢眨眼
  const worried = alerts.some((a) => a.level === 'red' && !a.archived)
  return (
    <header className="g-top">
      <div className="g-top__brand">
        <span className={`g-top__eyes${worried ? ' is-worried' : ''}`} aria-hidden><i /><i /></span>
        <span>Milo</span>
      </div>
      <div className="g-top__right">
        {clock && <span className="g-top__clock">{clockLabel(clock)}</span>}
        <span className={`g-live g-live--${status}`}>{status === 'open' ? 'Milo is on' : 'Reconnecting…'}</span>
      </div>
    </header>
  )
}

function HomePage() {
  const { alerts, clock, settings, freshIds, archive } = useGuardian()
  const open = alerts.filter((a) => !a.archived)
  // 红卡置顶，其余按后端给的顺序；前端不重新判断级别
  const red = open.filter((a) => a.level === 'red')
  const rest = open.filter((a) => a.level !== 'red')
  const name = settings?.elder_name ?? 'Mom'
  // 页面刚打开时已有的记录不播进场动画；之后新收进「This week」的那一行要亮一下
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), 600)
    return () => window.clearTimeout(t)
  }, [])
  return (
    // 电脑宽度时分两栏：左边是要处理的卡，右边是本周回顾
    <section className="g-page g-home">
      <div className="g-home__main">
      <h1 className="g-h1">{red.length ? `Call ${name} today` : 'All good'}</h1>
      <p className="g-lede">{red.length ? 'Milo noticed something.' : 'Nothing needs you right now.'}</p>
      <div className="g-stack">
        {/* 收走的卡片不再占位，下面的内容直接到位，不会等它消失后再往上跳 */}
        <AnimatePresence initial={false} mode="popLayout">
          {[...red, ...rest].map((a) => (
            <AlertCard key={a.id} alert={a} now={clock} phone={settings?.phone ?? null} fresh={freshIds.has(a.id)} onArchive={(id) => void archive(id).catch((e: Error) => console.error(e))} />
          ))}
        </AnimatePresence>
        {open.length === 0 && (
          <motion.div className="g-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.3 }}>
            <span className="g-empty__eyes" aria-hidden><i /><i /></span>
            <p>If Milo needs you, it shows here.</p>
          </motion.div>
        )}
      </div>
      </div>
      <ThisWeek animateIn={settled} />
    </section>
  )
}

// 本周回顾：最近 7 天（按演示时钟）点过 Got it 的卡，收成灰色的一行，时间倒序
function ThisWeek({ animateIn }: { animateIn: boolean }) {
  const { alerts, clock } = useGuardian()
  const now = clock ?? new Date().toISOString()
  const week = alerts.filter((a) => hoursBetween(a.created_at, now) <= 24 * 7)
  const seen = week.filter((a) => a.archived).sort((x, y) => hoursBetween(y.created_at, x.created_at))
  const [openId, setOpenId] = useState<string | null>(null)
  if (week.length > 0 && seen.length === 0) return null
  return (
    <section className="g-week" aria-label="This week">
      <h2 className="g-h2">This week</h2>
      {seen.length === 0 ? (
        <p className="g-note">Quiet week so far.</p>
      ) : (
        <ul className="g-week__list">
          <AnimatePresence initial={animateIn}>
            {seen.map((a) => (
              <motion.li
                key={a.id}
                layout
                className={`g-week__row g-week__row--${a.level}`}
                // 刚收进来的一行先亮一下暖色底，再慢慢退回灰色
                initial={{ opacity: 0, y: -8, backgroundColor: '#f6dca8' }}
                animate={{ opacity: 1, y: 0, backgroundColor: '#efe7dc' }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1], backgroundColor: { delay: 0.3, duration: 1.4 } }}
              >
                {/* 点开看当时那张卡上写了什么 */}
                <button className="g-week__btn" aria-expanded={openId === a.id} onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                  <span className="g-week__dot" aria-hidden />
                  <span className="g-week__title">{a.title}</span>
                  <time className="g-week__time">{recentLabel(a.created_at, now)}</time>
                  <span className="g-week__seen">Seen</span>
                  <ChevronDown className="g-week__chev" aria-hidden strokeWidth={2.6} />
                </button>
                <AnimatePresence initial={false}>
                  {openId === a.id && (
                    <motion.div
                      className="g-week__more"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    >
                      <p>{a.body}</p>
                      {a.grandma_note && <p className="g-week__note">“{a.grandma_note}”</p>}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}

function TabBar() {
  const tabs = [
    { to: '/guardian', label: 'Home', icon: Home, end: true },
    { to: '/guardian/ledger', label: 'Money', icon: ReceiptText, end: false },
    { to: '/guardian/memory', label: 'Pills', icon: Pill, end: false },
    { to: '/guardian/settings', label: 'Settings', icon: SettingsIcon, end: false },
  ]
  return (
    <nav className="g-tabs" aria-label="Sections">
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `g-tab${isActive ? ' is-active' : ''}`}>
          {({ isActive }) => (
            <>
              {/* 选中的底色在标签之间滑过去 */}
              {isActive && <motion.span layoutId="g-tab-pill" className="g-tab__pill" transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }} />}
              <Icon aria-hidden strokeWidth={2.2} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
