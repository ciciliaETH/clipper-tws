'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type Participant = { id: string; tiktok_username: string; created_at: string }
type Row = { username: string; followers: number; views: number; likes: number; comments: number; shares: number; saves: number; posts: number; total: number; last_refreshed?: string }

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string
  const [participants, setParticipants] = useState<Participant[]>([])
  const [leaderboard, setLeaderboard] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [usernamesText, setUsernamesText] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [count, setCount] = useState(50)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [pRes, lRes] = await Promise.all([
        fetch(`/api/groups/${id}/participants`, { cache: 'no-store' }),
        fetch(`/api/groups/${id}/leaderboard?top=100`, { cache: 'no-store' })
      ])
      const pJson = await pRes.json(); const lJson = await lRes.json()
      if (!pRes.ok) throw new Error(pJson?.error || 'Gagal memuat participants')
      if (!lRes.ok) throw new Error(lJson?.error || 'Gagal memuat leaderboard')
      setParticipants(pJson.data || [])
      setLeaderboard(lJson.data || [])
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat data')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  const addParticipants = async (e: React.FormEvent) => {
    e.preventDefault()
    const list = usernamesText
      .split(/[\s,;\n\r]+/)
      .map(s => s.trim())
      .filter(Boolean)
    if (!list.length) return
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`/api/groups/${id}/participants`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: list })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Gagal menambah peserta')
      setUsernamesText('')
      await load()
    } catch (e: any) { setError(e?.message || 'Gagal menambah peserta') }
    finally { setAdding(false) }
  }

  const doRefresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const body: any = { count }
      if (start) body.start = start
      if (end) body.end = end
      const res = await fetch(`/api/groups/${id}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Gagal refresh data')
      await load()
    } catch (e: any) { setError(e?.message || 'Gagal refresh data') }
    finally { setRefreshing(false) }
  }

  const format = (n:number) => new Intl.NumberFormat('id-ID').format(Math.round(n||0))

  const totals = useMemo(() => {
    const t = leaderboard.reduce((acc, cur) => ({
      views: acc.views + cur.views,
      likes: acc.likes + cur.likes,
      comments: acc.comments + cur.comments,
      shares: acc.shares + cur.shares,
      saves: acc.saves + cur.saves,
    }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 })
    return t
  }, [leaderboard])

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-white/90">Group Detail</h1>
        <div className="text-white/60 text-sm">ID: {id}</div>
      </div>

      {error && (
        <div className="glass rounded-xl border border-red-400/30 p-3 text-red-200 mb-4">{error}</div>
      )}

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="glass rounded-xl border border-white/10 p-4">
          <div className="font-medium text-white mb-2">Tambah Peserta</div>
          <form onSubmit={addParticipants} className="flex flex-col gap-3">
            <textarea
              className="min-h-[100px] px-3 py-2 rounded bg-white/5 border border-white/10 text-white"
              placeholder="Masukkan username TikTok, pisahkan dengan spasi, koma, atau baris baru"
              value={usernamesText}
              onChange={e=> setUsernamesText(e.target.value)}
            />
            <div className="flex gap-3">
              <button disabled={adding} className="px-4 py-2 rounded bg-white/10 border border-white/10 text-white hover:bg-white/15">
                {adding ? 'Menyimpan…' : 'Tambah'}
              </button>
            </div>
          </form>
          <div className="mt-4 text-white/70 text-sm">Total peserta: {participants.length}</div>
        </div>

        <div className="glass rounded-xl border border-white/10 p-4">
          <div className="font-medium text-white mb-2">Perbarui Data (ambil dari API eksternal)</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <input type="date" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white" value={start} onChange={e=> setStart(e.target.value)} placeholder="Start (YYYY-MM-DD)" />
            <input type="date" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white" value={end} onChange={e=> setEnd(e.target.value)} placeholder="End (YYYY-MM-DD)" />
            <input type="number" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white" value={count} onChange={e=> setCount(parseInt(e.target.value||'50',10))} min={1} max={200} />
          </div>
          <button onClick={doRefresh} disabled={refreshing} className="mt-3 px-4 py-2 rounded bg-white/10 border border-white/10 text-white hover:bg-white/15">
            {refreshing ? 'Memproses…' : 'Perbarui Data'}
          </button>
          <div className="mt-2 text-white/60 text-xs">Sumber: 202.10.44.90 + TikWM. Frontend hanya baca dari database.</div>
        </div>
      </div>

      <div className="glass rounded-xl border border-white/10 p-4 overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium text-white">Leaderboard</div>
          <div className="text-white/70 text-sm">Totals — Views: {format(totals.views)} · Likes: {format(totals.likes)} · Comments: {format(totals.comments)} · Shares: {format(totals.shares)} · Saves: {format(totals.saves)}</div>
        </div>
        {loading ? (
          <div className="text-white/70">Loading…</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-white/60 bg-white/5">
                <th className="py-3 px-4">#</th>
                <th className="py-3 px-4">Username</th>
                <th className="py-3 px-4">Followers</th>
                <th className="py-3 px-4">Views</th>
                <th className="py-3 px-4">Likes</th>
                <th className="py-3 px-4">Comments</th>
                <th className="py-3 px-4">Shares</th>
                <th className="py-3 px-4">Saves</th>
                <th className="py-3 px-4">Posts</th>
                <th className="py-3 px-4">Total</th>
                <th className="py-3 px-4">Updated</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr><td colSpan={11} className="py-4 px-4 text-white/60">Belum ada data. Tambahkan peserta lalu klik Perbarui Data.</td></tr>
              ) : (
                leaderboard.map((r, i) => (
                  <tr key={r.username} className="border-t border-white/10 hover:bg-white/5">
                    <td className="py-2 px-4 text-white/60">{i+1}</td>
                    <td className="py-2 px-4 text-white/90">@{r.username}</td>
                    <td className="py-2 px-4 text-white/80">{format(r.followers)}</td>
                    <td className="py-2 px-4 text-white/80">{format(r.views)}</td>
                    <td className="py-2 px-4 text-white/80">{format(r.likes)}</td>
                    <td className="py-2 px-4 text-white/80">{format(r.comments)}</td>
                    <td className="py-2 px-4 text-white/80">{format(r.shares)}</td>
                    <td className="py-2 px-4 text-white/80">{format(r.saves)}</td>
                    <td className="py-2 px-4 text-white/80">{format(r.posts)}</td>
                    <td className="py-2 px-4 text-white/90 font-medium">{format(r.total)}</td>
                    <td className="py-2 px-4 text-white/60 text-xs">{r.last_refreshed ? new Date(r.last_refreshed).toLocaleString('id-ID') : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
