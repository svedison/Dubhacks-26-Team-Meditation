import { Home, Pill, ReceiptText, Settings as SettingsIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { NavLink, Route, Routes } from 'react-router-dom'
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
          <Routes>
            <Route index element={<HomePage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Routes>
        </main>
        <TabBar />
      </div>
    </GuardianProvider>
  )
}

function TopBar() {
  const { status, clock, settings } = useGuardian()
  return (
    <header className="g-top">
      <div className="g-top__brand">
        <span className="g-top__eyes" aria-hidden><i /><i /></span>
        <span>TrustTag</span>
      </div>
      <div className="g-top__right">
        {clock && <span className="g-top__clock">Demo clock · {clockLabel(clock)}</span>}
        <span className={`g-live g-live--${status}`}>{status === 'open' ? `${settings?.elder_name ?? 'Mom'}'s frame is on` : 'Reconnecting…'}</span>
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
      <h1 className="g-h1">{red.length ? 'One thing needs you today' : `All calm at ${name}'s`}</h1>
      <p className="g-lede">
        {red.length ? 'TrustTag stopped something and told her first. A quick call helps.' : 'Nothing needs you right now. Reminders and deliveries show up here.'}
      </p>
      <div className="g-stack">
        <AnimatePresence initial={false}>
          {[...red, ...rest].map((a) => (
            <AlertCard key={a.id} alert={a} now={clock} phone={settings?.phone ?? null} fresh={freshIds.has(a.id)} onArchive={(id) => void archive(id).catch((e: Error) => console.error(e))} />
          ))}
        </AnimatePresence>
        {open.length === 0 && (
          <div className="g-empty">
            <span className="g-empty__eyes" aria-hidden><i /><i /></span>
            <p>All quiet. You will see a card here within seconds if anything comes up.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function TabBar() {
  const tabs = [
    { to: '/guardian', label: 'Home', icon: Home, end: true },
    { to: '/guardian/ledger', label: 'Spending', icon: ReceiptText, end: false },
    { to: '/guardian/memory', label: 'Reminders', icon: Pill, end: false },
    { to: '/guardian/settings', label: 'Settings', icon: SettingsIcon, end: false },
  ]
  return (
    <nav className="g-tabs" aria-label="Sections">
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `g-tab${isActive ? ' is-active' : ''}`}>
          <Icon aria-hidden strokeWidth={2.2} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
