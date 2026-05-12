'use client'
import React, { useEffect, useState } from 'react'
import { getCameras } from '@/lib/api'
import VideoPlayer from '@/components/VideoPlayer'

export default function CamerasPage() {
    const [cams, setCams] = useState<any[]>([])
    useEffect(() => { getCameras().then(setCams).catch(console.error) }, [])

    return (
        <main>
            <h2 className="mb-4 text-xl font-semibold">Cameras</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {cams.map((c) => (
                    <div key={c.id} className="rounded-2xl border bg-white p-4 shadow">
                        <div className="mb-2 text-sm text-neutral-600">{c.location || '—'}</div>
                        <div className="mb-2 font-semibold">{c.name}</div>
                        {c.hls_url ? (
                            <VideoPlayer src={c.hls_url} />
                        ) : (
                            <div className="rounded bg-neutral-100 p-8 text-center text-neutral-500">No stream URL</div>
                        )}
                    </div>
                ))}
            </div>
        </main>
    )
}