'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Group = { id: string; name: string; description?: string | null }

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/groups?kind=groups', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Gagal memuat groups')
      setGroups(json.data || [])
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat groups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/groups?kind=groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Gagal membuat group')
      setName('')
      setDescription('')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Gagal membuat group')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <h1 className="text-xl font-semibold text-white/90 mb-4">Groups</h1>

      <form onSubmit={createGroup} className="glass rounded-xl border border-white/10 p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white flex-1"
            placeholder="Nama group (contoh: Group A)"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white flex-1"
            placeholder="Deskripsi (opsional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <button disabled={creating} className="px-4 py-2 rounded bg-white/10 border border-white/10 text-white hover:bg-white/15">
            {creating ? 'Membuat…' : 'Buat Group'}
          </button>
        </div>
      </form>

      {error && (
        <div className="glass rounded-xl border border-red-400/30 p-3 text-red-200 mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-white/70">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="text-white/60">Belum ada group.</div>
      ) : (
        <div className="grid gap-3">
          {groups.map(g => (
            <Link key={g.id} href={`/groups/${g.id}`} className="glass rounded-xl border border-white/10 p-4 text-white hover:bg-white/5">
              <div className="font-medium">{g.name}</div>
              {g.description && <div className="text-white/60 text-sm">{g.description}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
