const API = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'

export async function getCameras() {
    const r = await fetch(`${API}/cameras`, { cache: 'no-store' })
    if (!r.ok) throw new Error('Failed to load cameras')
    return r.json()
}

export async function getMissions() {
    const r = await fetch(`${API}/missions`, { cache: 'no-store' })
    if (!r.ok) throw new Error('Failed to load missions')
    return r.json()
}

export async function patchMission(id: number, body: any) {
    const r = await fetch(`${API}/missions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error('Failed to patch mission')
    return r.json()
}