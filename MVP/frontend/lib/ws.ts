'use client'
import { useEffect, useRef, useState } from 'react'

const WS = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws'

export function useWs() {
    const [socket, setSocket] = useState<WebSocket | null>(null)
    const ref = useRef<WebSocket | null>(null)

    useEffect(() => {
        const ws = new WebSocket(WS)
        ref.current = ws
        setSocket(ws)
        return () => { ws.close() }
    }, [])

    return socket
}