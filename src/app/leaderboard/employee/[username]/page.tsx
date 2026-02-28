'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useDebounce } from 'use-debounce'

export default function EmployeeVideosPage() {
  const params = useParams()
  const username = params.username as string
  const router = useRouter()

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'all' | 'tiktok' | 'instagram' | 'youtube'>('all')
  const [hashtag, setHashtag] = useState<string>('')
  const [debouncedHashtag] = useDebounce(hashtag, 1000)

  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '',
    end: ''
  })

  useEffect(() => {
    if (!username) return

    setLoading(true)
    const url = new URL(`/api/leaderboard/employee/${username}/videos`, window.location.origin)
    if (dateRange.start) url.searchParams.set('start', dateRange.start)
    if (dateRange.end) url.searchParams.set('end', dateRange.end)
    url.searchParams.set('platform', platform)
    if (debouncedHashtag) url.searchParams.set('hashtag', debouncedHashtag)

    fetch(url.toString())
      .then(res => res.json())
      .then(json => {
        if (json.error) throw new Error(json.error)
        setData(json)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [username, dateRange, platform, debouncedHashtag])

  const format = (n: number) => new Intl.NumberFormat('id-ID').format(n)

  const totals = data?.videos?.reduce((acc: any, cur: any) => ({
    views: acc.views + (cur.views || 0),
    likes: acc.likes + (cur.likes || 0),
    comments: acc.comments + (cur.comments || 0),
    shares: acc.shares + (cur.shares || 0),
  }), { views: 0, likes: 0, comments: 0, shares: 0 }) || { views: 0, likes: 0, comments: 0, shares: 0 }

  if (loading && !data) return (
    <div className="min-h-screen p-8 flex items-center justify-center">
      <div className="text-white/60 animate-pulse">Memuat data video {decodeURIComponent(username || '')}...</div>
    </div>
  )
  if (error) return (
    <div className="min-h-screen p-8">
      <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200">
        Error: {error}
      </div>
      <button onClick={() => router.back()} className="mt-4 text-white/60 hover:text-white flex items-center gap-2">
        <ArrowLeft className="w-4 h-4" /> Kembali
      </button>
    </div>
  )
  if (!data) return null

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mb-8">
        <button onClick={() => router.push('/leaderboard')} className="flex items-center gap-2 text-white/60 hover:text-white mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Kembali ke Leaderboard
        </button>

        <div className="glass p-4 sm:p-6 rounded-2xl border border-white/10 space-y-4">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white mb-2">
              {data.fullName || decodeURIComponent(username)}
            </h1>
            <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-white/60">
              <div className="px-2 sm:px-3 py-1 rounded-full bg-white/5 border border-white/10">
                Videos: <span className="text-white font-medium">{data.count}</span>
              </div>
              <div className="px-2 sm:px-3 py-1 rounded-full bg-white/5 border border-white/10">
                Total Views: <span className="text-white font-medium">{format(totals.views)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 bg-white/5 p-2 rounded-xl border border-white/10">
            {/* Platform buttons */}
            <div className="flex items-center gap-1">
              {(['all', 'youtube', 'instagram', 'tiktok'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`px-2 sm:px-2.5 py-1.5 rounded-lg text-xs border transition ${platform === p ? 'bg-white/20 text-white border-white/30' : 'bg-white/10 text-white/80 border-white/10 hover:bg-white/15'}`}
                >{p === 'all' ? 'ALL' : p === 'instagram' ? 'IG' : p === 'youtube' ? 'YT' : 'TT'}</button>
              ))}
            </div>
            {/* Date range */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider ml-1 mb-1 block">Dari</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="bg-black/20 border border-white/10 rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-white focus:outline-none focus:border-white/30 transition-colors w-full"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider ml-1 mb-1 block">Sampai</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="bg-black/20 border border-white/10 rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-white focus:outline-none focus:border-white/30 transition-colors w-full"
                />
              </div>
              <button
                onClick={() => setDateRange({ start: '', end: '' })}
                className="px-3 py-1.5 text-xs sm:text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 hover:text-white transition-colors flex-shrink-0"
                title="Reset Filter"
              >
                Reset
              </button>
            </div>
            {/* Hashtag search */}
            <div>
              <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider ml-1 mb-1 block">Cari Hashtag</label>
              <input
                type="text"
                placeholder="#hashtag"
                value={hashtag}
                onChange={(e) => setHashtag(e.target.value)}
                className="bg-black/20 border border-white/10 rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-white focus:outline-none focus:border-white/30 transition-colors w-full sm:w-auto"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {data.videos.map((v: any, i: number) => (
          <div key={`${v.platform}-${v.id}-${i}`} className="glass p-4 rounded-xl border border-white/10 hover:border-white/30 transition-all hover:-translate-y-1">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider ${v.platform === 'tiktok' ? 'bg-black text-white border border-white/20' : v.platform === 'instagram' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' : 'bg-red-600 text-white'}`}>
                  {v.platform}
                </span>
                <span className="text-xs text-white/70 font-medium">@{v.username}</span>
              </div>
              <span className="text-xs text-white/40 font-mono">
                {v.taken_at ? new Date(v.taken_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}
              </span>
            </div>

            <a href={v.link} target="_blank" rel="noopener noreferrer" className="block mb-4 group">
              <div className="text-white/90 font-medium line-clamp-2 min-h-[2.5rem] text-sm group-hover:text-blue-400 transition-colors" title={v.title || v.caption}>
                {v.title || v.caption || '(No description)'}
              </div>
              <div className="mt-2 text-xs text-blue-400/80 group-hover:text-blue-400 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Buka di {v.platform === 'tiktok' ? 'TikTok' : v.platform === 'instagram' ? 'Instagram' : 'YouTube'}
              </div>
            </a>

            <div className="grid grid-cols-3 gap-2 text-center text-sm border-t border-white/10 pt-3 bg-white/[0.02] rounded-lg pb-1 -mx-2 px-2">
              <div className="flex flex-col">
                <span className="text-white font-semibold">{format(v.views)}</span>
                <span className="text-white/40 text-[10px] uppercase tracking-wider">Views</span>
              </div>
              <div className="flex flex-col">
                <span className="text-white font-semibold">{format(v.likes)}</span>
                <span className="text-white/40 text-[10px] uppercase tracking-wider">Likes</span>
              </div>
              <div className="flex flex-col">
                <span className="text-white font-semibold">{format(v.comments)}</span>
                <span className="text-white/40 text-[10px] uppercase tracking-wider">Comms</span>
              </div>
            </div>
          </div>
        ))}
        {data.videos.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-white/40 glass rounded-2xl border border-white/5">
            <div className="text-lg">Tidak ada video ditemukan</div>
            <div className="text-sm mt-2 opacity-60">Pastikan username benar atau data telah tersinkronisasi.</div>
          </div>
        )}
      </div>
    </div>
  )
}
