import React from 'react'
import StatCard from '@/components/StatCard'
import LiveStream from '@/components/LiveStream'
import DetectionResult from '@/components/DetectionResult'

export default async function DashboardPage() {
    return (
        <main>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
                <img
                    src="/logo.png"
                    alt="Project Logo"
                    style={{ width: 240, height: 'auto', display: 'block' }}
                />
            </div>
            <LiveStream />
            <DetectionResult />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <StatCard title="Active Cameras" value="—" hint="See Cameras tab" />
                <StatCard title="Open Missions" value="—" hint="See Missions tab" />
                <StatCard title="Avg. Response (min)" value="—" hint="Wire to analytics later" />
            </div>
        </main>
    )
}