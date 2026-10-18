import { ChevronDown, Home, Pill, ReceiptText, Settings as SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import AlertCard from '../shared/ui/AlertCard'
import { clockLabel, hoursBetween, recentLabel } from '../shared/format'
import { SAMPLE_PHOTOS } from '../shared/samplePhotos'
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
        // 旧页面直接让位、新页面淡入，切标签时中间不闪一下空白
        exit={{ opacity: 0, transition: { duration: 0 } }}
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
  const { alerts, clock, loaded, settings, freshIds, archive } = useGuardian()
  // 新的在上：推送来的和拉取来的卡片排序一致，重连后卡片不换位置
  const open = alerts.filter((a) => !a.archived).sort((x, y) => hoursBetween(x.created_at, y.created_at))
  // 红卡置顶，其余按时间；级别只按后端给的，前端不重新判断
  const red = open.filter((a) => a.level === 'red')
  const rest = open.filter((a) => a.level !== 'red')
  const yellow = rest.some((a) => a.level === 'yellow')
  const name = settings?.elder_name ?? 'Mom'
  // 页面刚打开时已有的记录不播进场动画；数据拉完以后新收进「This week」的那一行才亮一下
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!loaded) return
    const t = window.setTimeout(() => setSettled(true), 600)
    return () => window.clearTimeout(t)
  }, [loaded])
  return (
    // 电脑宽度时分两栏：左边是要处理的卡，右边是她那边的相框和本周回顾
    <section className="g-page g-home">
      <FrameNow photo={settings?.photos[0] ?? SAMPLE_PHOTOS[0]} worried={red.length > 0} />
      <div className="g-home__main">
      {/* 有红卡：叫你打电话；有别的卡（黄卡或普通提醒）：Take a look；什么都没有才是 All good */}
      <h1 className="g-h1">{red.length ? `Call ${name} today` : open.length ? 'Take a look' : 'All good'}</h1>
      {/* 只有普通卡（比如提醒设好了）时不说「没有要你管的」，免得和下面那张卡对不上 */}
      {(red.length > 0 || yellow || open.length === 0) && (
        <p className="g-lede">{red.length || yellow ? 'Milo noticed something.' : 'Nothing needs you right now.'}</p>
      )}
      <div className="g-stack">
        {/* 收走的卡片高度慢慢收起，下面的内容跟着平滑上移，不叠字也不跳 */}
        <AnimatePresence initial={false}>
          {[...red, ...rest].map((a) => (
            <AlertCard key={a.id} alert={a} now={clock} phone={settings?.phone ?? null} fresh={freshIds.has(a.id)} onArchive={archive} />
          ))}
        </AnimatePresence>
      </div>
      </div>
      <ThisWeek animateIn={settled} />
    </section>
  )
}

// 首页顶上一小块「她那边的相框此刻」：和相框里同一张家庭照片、同一双眼睛。平时眼睛闭成两条线、轻轻呼吸，
// 和相框待机时一样；有没处理的红色警报时照片压上一层酒红，眼睛睁开、是担心的样子
function FrameNow({ photo, worried }: { photo: string; worried: boolean }) {
  return (
    <div className={`g-frame${worried ? ' is-worried' : ''}`} aria-hidden>
      <img className="g-frame__photo" src={photo} alt="" draggable={false} />
      <span className="g-frame__eyes"><i /><i /></span>
    </div>
  )
}

// 本周回顾：最近 7 天（按演示时钟）点过 Got it 的卡，收成灰色的一行，时间倒序
// 这一块是在页面打开以后才出现的（第一次点 Got it）：等上面的卡片收完再淡入，不会压在卡片下沿。
// 要不要淡入只看出现那一刻；页面刚打开时就在的，之后也不会再淡一次
function WeekSection({ enter, children }: { enter: boolean; children: ReactNode }) {
  const [fade] = useState(enter)
  return <section className={`g-week${fade ? ' g-week--enter' : ''}`} aria-label="This week">{children}</section>
}

function ThisWeek({ animateIn }: { animateIn: boolean }) {
  const { alerts, clock } = useGuardian()
  const now = clock ?? new Date().toISOString()
  const week = alerts.filter((a) => hoursBetween(a.created_at, now) <= 24 * 7)
  // 新的在上
  const seen = week.filter((a) => a.archived).sort((x, y) => hoursBetween(x.created_at, y.created_at))
  const [openId, setOpenId] = useState<string | null>(null)
  if (week.length > 0 && seen.length === 0) return null
  return (
    <WeekSection enter={animateIn}>
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
    </WeekSection>
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
