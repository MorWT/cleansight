export default function StatCard({ title, value, hint }: { title: string, value: string | number, hint?: string }) {
    return (
        <div className="rounded-2xl border bg-white p-5 shadow">
            <div className="text-sm text-neutral-500">{title}</div>
            <div className="mt-1 text-3xl font-semibold">{value}</div>
            {hint && <div className="mt-2 text-xs text-neutral-500">{hint}</div>}
        </div>
    )
}