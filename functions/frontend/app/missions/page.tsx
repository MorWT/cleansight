'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { getMissions, patchMission } from '@/lib/api'
import { useWs } from '@/lib/ws'
import MissionList from '@/components/MissionList'

export default function MissionsPage() {
    const [missions, setMissions] = useState<any[]>([])
    const ws = useWs()

    const refresh = () => getMissions().then(setMissions)
    useEffect(() => { refresh() }, [])

    useEffect(() => {
        if (!ws) return
        const onMsg = (e: MessageEvent) => {
            try {
                const msg = JSON.parse(e.data)
                if (msg.type === 'mission_created' || msg.type === 'mission_updated') {
                    refresh()
                }
            } catch {}
        }
        ws.addEventListener('message', onMsg)
        return () => ws.removeEventListener('message', onMsg)
    }, [ws])

    const todo = useMemo(() => missions.filter(m => m.status === 'todo' || m.status === 'in_progress'), [missions])
    const done = useMemo(() => missions.filter(m => m.status === 'done'), [missions])

    const markDone = async (id: number) => {
        await patchMission(id, { status: 'done' });
        await refresh();
    }

    return (
        <main className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <section>
                <h2 className="mb-3 text-lg font-semibold">To‑Do / In‑Progress</h2>
                <MissionList items={todo} onMarkDone={markDone} />
            </section>
            <section>
                <h2 className="mb-3 text-lg font-semibold">Done</h2>
                <MissionList items={done} />
            </section>
        </main>
    )
}