'use client'
import MissionItem from './MissionItem'

export default function MissionList({ items, onMarkDone }: { items: any[], onMarkDone?: (id: number) => void }) {
    if (!items?.length) return <div className="rounded-xl border bg-white p-4 text-neutral-500">No missions</div>
    return (
        <div className="space-y-3">
            {items.map((m) => (
                <MissionItem key={m.id} item={m} onMarkDone={onMarkDone} />
            ))}
        </div>
    )
}