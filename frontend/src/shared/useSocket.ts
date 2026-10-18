import { useEffect, useRef, useState } from 'react'
import { wsUrl } from './config'

export type SocketStatus = 'connecting' | 'open' | 'down'

// 连 /ws?role=…，断了就每 2 秒重连一次；状态交给页面决定怎么显示（老人端断线时脸回待机）
export function useSocket<In, Out>(role: 'elder' | 'guardian', onMessage: (msg: In) => void) {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const handler = useRef(onMessage)
  handler.current = onMessage

  useEffect(() => {
    let closed = false
    let timer: number | undefined

    const connect = () => {
      setStatus('connecting')
      const ws = new WebSocket(wsUrl(role))
      wsRef.current = ws
      ws.onopen = () => setStatus('open')
      ws.onmessage = (e) => handler.current(JSON.parse(e.data as string) as In)
      ws.onclose = () => {
        // 只清自己：旧连接晚到的 close 不能把新连接的引用清掉
        if (wsRef.current === ws) wsRef.current = null
        if (closed) return
        setStatus('down')
        timer = window.setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(timer)
      const ws = wsRef.current
      if (!ws) return
      // 还在握手时直接 close 浏览器会报警告：等它连上再关
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close()
      else ws.close()
    }
  }, [role])

  const send = (msg: Out) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[ws] not open, dropped', msg)
      return false
    }
    ws.send(JSON.stringify(msg))
    return true
  }

  return { status, send }
}
