import { Home, Pill, ReceiptText, Settings as SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import AlertCard from '../shared/ui/AlertCard'
import { clockLabel } from '../shared/format'
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
  const { status, clock } = useGuardian()
  return (
    <header className="g-top">
      <div className="g-top__brand">
        <span className="g-top__eyes" aria-hidden><i /><i /></span>
        <span>Milo</span>
      </div>
      <div className="g-top__right">
        {clock && <span className="g-top__clock">Demo · {clockLabel(clock)}</span>}
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
  return (
    <section className="g-page">
      <h1 className="g-h1">{red.length ? `Call ${name} today` : 'All good'}</h1>
      <p className="g-lede">{red.length ? 'Milo noticed something.' : 'Nothing needs you right now.'}</p>
      <div className="g-stack">
        <AnimatePresence initial={false}>
          {[...red, ...rest].map((a) => (
            <AlertCard key={a.id} alert={a} now={clock} phone={settings?.phone ?? null} fresh={freshIds.has(a.id)} onArchive={(id) => void archive(id).catch((e: Error) => console.error(e))} />
          ))}
        </AnimatePresence>
        {open.length === 0 && (
          <div className="g-empty">
            <span className="g-empty__eyes" aria-hidden><i /><i /></span>
            <p>If Milo needs you, it shows here.</p>
          </div>
        )}
      </div>
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
