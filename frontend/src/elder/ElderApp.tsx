import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { MicStream } from '../shared/audio/micStream'
import { api } from '../shared/config'
import type { ElderEvent, ElderOutgoing, FaceState, Settings } from '../shared/contracts'
import { clockLabel } from '../shared/format'
import { useSocket } from '../shared/useSocket'
import CardStage from './CardStage'
import Chat from './Chat'
import { playCue } from './cues'
import { elderReducer, initialView } from './elderReducer'
import Face from './face/Face'
import KeyboardFallback from './KeyboardFallback'
import PhotoFrame from './PhotoFrame'
import { Player } from './player'
import Stage from './Stage'
import './elder.css'

// Settings 里还没有家庭照片时（监护人还没上传），先放这几张示例照片
const SAMPLE_PHOTOS = ['/photos/people-baking-v2.jpg', '/photos/people-birthday-v2.jpg', '/photos/people-porch-v2.jpg', '/photos/people-park-v2.jpg']
const MOVE = { duration: 0.8, ease: [0.43, 0.195, 0.02, 1] as const }

export default function ElderApp() {
  const [live, setLive] = useState<{ mic: MicStream; player: Player } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // 必须在点击里同步启动：AudioContext、静音循环、speechSynthesis 解锁都要用户手势
  const start = () => {
    // 启动要几秒（加载语音模型），这段时间再点不重复启动
    if (live || starting) return
    setStarting(true)
    setError(null)
    // 收起 Safari 的地址栏和标签栏（iPad 上的 Safari 支持网页全屏；不支持时页面照样铺满可见区域）
    const root = document.documentElement
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen({ navigationUI: 'hide' }).catch((e: Error) => console.warn('[elder] fullscreen', e.message))
    }
    const mic = new MicStream({ mode: 'utterance', onStatus: () => {} })
    const started = mic.start()
    const player = new Player(mic.ctx!)
    player.unlock()
    started
      .then(() => setLive({ mic, player }))
      .catch((e: Error) => { console.error(e); setError(`${e.name}: ${e.message}`); setStarting(false) })
  }

  if (!live) {
    return (
      <Stage background="var(--elder-bg)">
        <img className="wake__bg" src={SAMPLE_PHOTOS[0]} alt="" draggable={false} />
        <button className={`wake${starting ? ' is-starting' : ''}`} onClick={start}>
          <span className="wake__eyes" aria-hidden><i /><i /></span>
          <span className="wake__name">Milo</span>
          <span className="wake__hint">{error ? "Mic didn't start. Tap to try again." : starting ? 'Waking up…' : 'Tap to start'}</span>
        </button>
      </Stage>
    )
  }
  return <ElderLive mic={live.mic} player={live.player} />
}

function ElderLive({ mic, player }: { mic: MicStream; player: Player }) {
  const [view, dispatch] = useReducer(elderReducer, initialView)
  const [playing, setPlaying] = useState(false)
  const [photos, setPhotos] = useState<string[]>(SAMPLE_PHOTOS)
  const [wakeName, setWakeName] = useState<string | null>(null)
  const [elderName, setElderName] = useState('Grandma')
  const lastFace = useRef<FaceState>('idle')
  const [emotion, setEmotion] = useState<FaceState | null>(null)
  const [fullHold, setFullHold] = useState(false)
  const clearEmotionAfterTalk = useRef(false)
  const pendingIdle = useRef(false)
  const emotionAt = useRef(0)
  const emotionTimer = useRef<number | undefined>(undefined)

  // 开心、担心、警报至少保持 3 秒：后端常在说完话以后才发结果状态，紧接着就切回在听，不保持的话只会闪一下
  const clearEmotion = () => {
    window.clearTimeout(emotionTimer.current)
    const left = 3000 - (Date.now() - emotionAt.current)
    if (left <= 0) setEmotion(null)
    else emotionTimer.current = window.setTimeout(() => setEmotion(null), left)
  }

  // 从待机醒来（或设备主动开口）：全屏大眼睛至少停 1 秒，再缩到左上角
  const holdFullScreen = () => {
    setFullHold(true)
    window.setTimeout(() => setFullHold(false), 1000)
  }

  const { status, send } = useSocket<ElderEvent, ElderOutgoing>('elder', (e) => {
    if (e.type === 'state' && e.state === 'idle' && player.playing) {
      // 还在说的话说完再回待机
      pendingIdle.current = true
      lastFace.current = 'idle'
      return
    }
    if (e.type === 'state' || e.type === 'ask' || e.type === 'transcript') pendingIdle.current = false
    if (e.type === 'ask' && lastFace.current === 'idle') holdFullScreen()
    dispatch(e)
    if (e.type === 'speak' || e.type === 'ask') player.enqueue({ text: e.text, audio_url: e.audio_url })
    if (e.type === 'state' && e.state !== lastFace.current) {
      if (lastFace.current === 'idle') holdFullScreen()
      lastFace.current = e.state
      playCue(mic.ctx!, e.state)
      // 开心、担心、警报在接下来说话时保持，直到下一次在听、在想或待机
      if (e.state === 'happy' || e.state === 'worried' || e.state === 'alert') {
        clearEmotionAfterTalk.current = false
        window.clearTimeout(emotionTimer.current)
        emotionAt.current = Date.now()
        setEmotion(e.state)
      } else if (e.state === 'idle') {
        clearEmotionAfterTalk.current = false
        clearEmotion()
      } else if (e.state !== 'speaking') {
        // AI 还在说就先不换脸，说完再换
        if (player.playing) clearEmotionAfterTalk.current = true
        else clearEmotion()
      }
    }
  })

  useEffect(() => {
    if (status === 'down') {
      // 后端断开：停掉正在说的话，脸直接回到照片待机
      pendingIdle.current = false
      clearEmotionAfterTalk.current = false
      player.stop()
      lastFace.current = 'idle'
      setEmotion(null)
      dispatch({ type: 'socket_down' })
    }
  }, [status, player])

  useEffect(() => {
    let release: number | undefined
    player.onDone = () => send({ type: 'spoke' })
    player.onBusy = (busy) => {
      setPlaying(busy)
      if (!busy && clearEmotionAfterTalk.current) {
        clearEmotionAfterTalk.current = false
        clearEmotion()
      }
      if (!busy && pendingIdle.current) {
        pendingIdle.current = false
        setEmotion(null)
        dispatch({ type: 'state', state: 'idle' })
      }
      window.clearTimeout(release)
      // 设备自己说话时不上传麦克风，说完再等 300 ms 余音
      if (busy) mic.hold(true)
      else release = window.setTimeout(() => mic.hold(false), 300)
    }
  }, [player, mic, send])

  useEffect(() => {
    fetch(api('/api/settings'))
      .then((r) => (r.ok ? (r.json() as Promise<Settings>) : Promise.reject(new Error(`settings HTTP ${r.status}`))))
      .then((s) => {
        if (s.photos.length) setPhotos(s.photos)
        setWakeName(s.wake_name)
        setElderName(s.elder_name)
      })
      .catch((e: Error) => console.error('[elder] settings', e.message))
  }, [])

  const base: FaceState = view.face === 'idle' && playing ? 'speaking' : view.face
  const face: FaceState = emotion && (base === 'speaking' || base === 'listening') ? emotion : base
  const showFace = view.awake || playing
  const corner = view.conversing && !fullHold
  const pair = !!view.card?.alternative
  const layoutCls = view.card ? (pair ? 'is-pair' : 'is-single') : 'is-solo'

  return (
    <Stage background="var(--elder-bg)">
      {/* 照片层一直在后台轮播：待机时铺满；醒来后虚化压暗留在背景里，提醒这是家人的相框 */}
      <motion.div
        className="layer"
        initial={false}
        animate={{ opacity: showFace ? 0.16 : 1, filter: showFace ? 'blur(36px)' : 'blur(0px)' }}
        transition={{ duration: showFace ? 0.5 : 0.8 }}
      >
        <PhotoFrame photos={photos} />
      </motion.div>
      {/* 警报：深酒红，中间亮四周暗；进出都慢慢来，不闪 */}
      <motion.div className="layer alert-wash" initial={false} animate={{ opacity: face === 'alert' ? 1 : 0 }} transition={{ duration: 1.1, ease: [0.43, 0.195, 0.02, 1] }} />
      <div className="mat" aria-hidden />

      <AnimatePresence>
        {showFace && (
          <motion.div
            key="face"
            layout
            className={`face-box ${corner ? 'face-box--corner' : 'face-box--full'}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ layout: MOVE, opacity: { duration: 0.4 } }}
          >
            <Face state={face} talking={playing} level={() => player.level()} />
          </motion.div>
        )}
      </AnimatePresence>

      {corner && (
        <motion.div layout="position" className={`talk ${layoutCls}`} transition={{ layout: MOVE }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Chat lines={view.lines} />
        </motion.div>
      )}
      {corner && (
        <div className={`cards ${layoutCls}`}>
          <CardStage card={view.card} />
        </div>
      )}

      {view.clock && showFace && (
        <div className="clock" aria-label="Demo clock">
          <span className="clock__label">Demo clock</span>
          <span className="clock__time">{clockLabel(view.clock)}</span>
        </div>
      )}
      <AnimatePresence>
        {!showFace && (
          <motion.div key="strip" className="wake-strip" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.5 }}>
            {wakeName && <span className="wake-strip__say">Say “{wakeName}”</span>}
            {view.clock && <span className="wake-strip__clock">Demo clock · {clockLabel(view.clock)}</span>}
          </motion.div>
        )}
      </AnimatePresence>
      {status === 'down' && <div className="conn" title="Backend offline" />}
      <KeyboardFallback name={elderName} onSend={(text) => send({ type: 'utterance', text, source: 'keyboard' })} />
    </Stage>
  )
}
