'use client'
export default function MissionItem({ item, onMarkDone }: { item: any, onMarkDone?: (id: number) => void }) {
    return (
        <div className="rounded-xl border p-3 shadow-sm">
            <div className="flex items-center justify-between">
                <div className="font-medium">{item.title}</div>
                <span className="text-xs text-neutral-500">#{item.id}</span>
            </div>
            {item.description && <div className="mt-1 text-sm text-neutral-600">{item.description}</div>}
            <div className="mt-2 flex items-center justify-between text-sm text-neutral-600">
                <div>Camera: {item.camera_id ?? '—'} · Priority: {item.priority}</div>
                {onMarkDone && item.status !== 'done' && (
                    <button className="rounded-lg bg-black px-3 py-1 text-white" onClick={() => onMarkDone(item.id)}>
                        Mark done
                    </button>
                )} 
            </div>
        </div>
    )
}