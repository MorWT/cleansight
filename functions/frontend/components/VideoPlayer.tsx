'use client'
import React, { useEffect, useRef } from 'react'
import Hls from 'hls.js'

export default function VideoPlayer({ src }: { src: string }) {
    const ref = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        const video = ref.current
        if (!video) return

        if (video.canPlayType('application/vnd.apple.mpegURL')) {
            video.src = src
        } else if (Hls.isSupported()) {
            const hls = new Hls()
            hls.loadSource(src)
            hls.attachMedia(video)
            return () => hls.destroy()
        }
    }, [src])

    return (
        <video ref={ref} className="aspect-video w-full rounded-lg bg-black" controls muted playsInline />
    )
}