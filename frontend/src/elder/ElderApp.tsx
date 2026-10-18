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

  // 必须在点击里同步启动：AudioContext、静音循环、speechSynthesis 解锁都要用户手势
  const start = () => {
    if (live) return
    const mic = new MicStream({ uploadAll: false, onStatus: () => {} })
    const started = mic.start()
    const player = new Player(mic.ctx!)
    player.unlock()
    started.then(() => setLive({ mic, player })).catch((e: Error) => { console.error(e); setError(`${e.name}: ${e.message}`) })
  }

  if (!live) {
    return (
      <Stage background="var(--elder-bg)">
        <button className="wake" onClick={start}>
          <span className="wake__eyes" aria-hidden><i /><i /></span>
          <span className="wake__name">TrustTag</span>
          <span className="wake__hint">{error ? `Microphone didn't start. ${error}` : 'Tap anywhere to start listening'}</span>
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
  const lastFace = useRef<FaceState>('idle')
  const [emotion, setEmotion] = useState<FaceState | null>(null)
  const [fullHold, setFullHold] = useState(false)
  const clearEmotionAfterTalk = useRef(false)

  const { status, send } = useSocket<ElderEvent, ElderOutgoing>('elder', (e) => {
    dispatch(e)
    if (e.type === 'speak' || e.type === 'ask') player.enqueue({ text: e.text, audio_url: e.audio_url })
    if (e.type === 'state' && e.state !== lastFace.current) {
      // 从待机醒来：全屏大眼睛至少停 1 秒，再缩到左上角
      if (lastFace.current === 'idle') {
        setFullHold(true)
        window.setTimeout(() => setFullHold(false), 1000)
      }
      lastFace.current = e.state
      playCue(mic.ctx!, e.state)
      // 开心、担心、警报在接下来说话时保持，直到下一次在听、在想或待机
      if (e.state === 'happy' || e.state === 'worried' || e.state === 'alert') {
        clearEmotionAfterTalk.current = false
        setEmotion(e.state)
      } else if (e.state !== 'speaking') {
        // AI 还在说就先不换脸，说完再换
        if (player.playing) clearEmotionAfterTalk.current = true
        else setEmotion(null)
      }
    }
  })

  useEffect(() => {
    if (status === 'down') {
      lastFace.current = 'idle'
      setEmotion(null)
      dispatch({ type: 'socket_down' })
    }
  }, [status])

  useEffect(() => {
    let release: number | undefined
    player.onDone = () => send({ type: 'spoke' })
    player.onBusy = (busy) => {
      setPlaying(busy)
      if (!busy && clearEmotionAfterTalk.current) {
        clearEmotionAfterTalk.current = false
        setEmotion(null)
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
      .then((s) => { if (s.photos.length) setPhotos(s.photos) })
      .catch((e: Error) => console.error('[elder] settings', e.message))
  }, [])

  const base: FaceState = view.face === 'idle' && playing ? 'speaking' : view.face
  const face: FaceState = base === 'speaking' && emotion ? emotion : base
  const showFace = view.awake || playing
  const corner = view.conversing && !fullHold
  const pair = !!view.card?.alternative
  const layoutCls = view.card ? (pair ? 'is-pair' : 'is-single') : 'is-solo'

  return (
    <Stage background={face === 'alert' ? 'var(--elder-bg-alert)' : 'var(--elder-bg)'}>
      <AnimatePresence>
        {!showFace && (
          <motion.div key="photos" className="layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <PhotoFrame photos={photos} />
          </motion.div>
        )}
      </AnimatePresence>

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

      {view.clock && (
        <div className="clock" aria-label="Demo clock">
          <span className="clock__label">Demo clock</span>
          <span className="clock__time">{clockLabel(view.clock)}</span>
        </div>
      )}
      {status === 'down' && <div className="conn" title="Backend offline" />}
      <KeyboardFallback onSend={(text) => send({ type: 'utterance', text, source: 'keyboard' })} />
    </Stage>
  )
}
