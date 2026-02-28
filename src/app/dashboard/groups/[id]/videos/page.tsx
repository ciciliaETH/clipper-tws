'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, Eye, Heart, MessageCircle, Share2, Filter, Search, SortDesc, Calendar, Hash, Video } from 'lucide-react'
import { useDebounce } from 'use-debounce'

export default function CampaignVideosPage() {
  const params = useParams()
  const campaignId = params?.id as string
  const router = useRouter()

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'all' | 'tiktok' | 'instagram' | 'youtube'>('all')
  const [hashtag, setHashtag] = useState<string>('')
  const [debouncedHashtag] = useDebounce(hashtag, 1000)
  const [sortBy, setSortBy] = useState<'newest' | 'views' | 'likes' | 'comments'>('views')
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '', end: ''
  })
  // Wait for URL params to be read before fetching
  const [ready, setReady] = useState(false)

  // Read date range from URL query params on mount (passed from groups page)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const s = sp.get('start')
    const e = sp.get('end')
    if (s && e) {
      setDateRange({ start: s, end: e })
    } else {
      const d = new Date(); d.setDate(d.getDate() - 30)
      setDateRange({ start: d.toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) })
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready || !campaignId) return
    setLoading(true)
    const url = new URL(`/api/campaigns/${campaignId}/videos`, window.location.origin)
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
  }, [ready, campaignId, dateRange, platform, debouncedHashtag])

  const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

  const sortedVideos = [...(data?.videos || [])].sort((a: any, b: any) => {
    switch (sortBy) {
      case 'views': return (b.views || 0) - (a.views || 0)
      case 'likes': return (b.likes || 0) - (a.likes || 0)
      case 'comments': return (b.comments || 0) - (a.comments || 0)
      case 'newest': default: return (b.taken_at || '').localeCompare(a.taken_at || '')
    }
  })

  const totals = data?.totals || { views: 0, likes: 0, comments: 0, shares: 0 }

  if (loading && !data) return (
    <div className="min-h-screen p-8 flex items-center justify-center">
      <div className="text-white/60 animate-pulse text-lg">Memuat video campaign...</div>
    </div>
  )
  if (error) return (
    <div className="min-h-screen p-8">
      <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200">Error: {error}</div>
      <button onClick={() => router.back()} className="mt-4 text-white/60 hover:text-white flex items-center gap-2">
        <ArrowLeft className="w-4 h-4" /> Kembali
      </button>
    </div>
  )
  if (!data) return null

  const platformColors: Record<string, string> = {
    tiktok: 'bg-black text-white border border-white/20',
    instagram: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
    youtube: 'bg-red-600 text-white',
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-[1600px] mx-auto">
      {/* Back button */}
      <button onClick={() => router.push('/dashboard/groups')} className="flex items-center gap-2 text-white/50 hover:text-white text-sm mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Kembali ke Groups
      </button>

      {/* Header: Title + Hashtags */}
      <div className="glass rounded-2xl border border-white/10 p-4 sm:p-5 mb-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              {data.campaign?.name || 'Campaign'}
            </h1>
            {(data.campaign?.required_hashtags || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(data.campaign?.required_hashtags || []).map((ht: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 text-xs border border-blue-500/20 font-medium">
                    {ht.startsWith('#') ? ht : `#${ht}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4">
        <div className="glass rounded-xl border border-white/10 p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <Video className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold text-white leading-tight truncate">{fmt(data.count)}</div>
            <div className="text-[10px] sm:text-[11px] text-white/40 uppercase tracking-wider">Videos</div>
          </div>
        </div>
        <div className="glass rounded-xl border border-white/10 p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-green-500/15 flex items-center justify-center flex-shrink-0">
            <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400" />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold text-white leading-tight truncate">{fmt(totals.views)}</div>
            <div className="text-[10px] sm:text-[11px] text-white/40 uppercase tracking-wider">Views</div>
          </div>
        </div>
        <div className="glass rounded-xl border border-white/10 p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-pink-500/15 flex items-center justify-center flex-shrink-0">
            <Heart className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-400" />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold text-white leading-tight truncate">{fmt(totals.likes)}</div>
            <div className="text-[10px] sm:text-[11px] text-white/40 uppercase tracking-wider">Likes</div>
          </div>
        </div>
        <div className="glass rounded-xl border border-white/10 p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-yellow-500/15 flex items-center justify-center flex-shrink-0">
            <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-400" />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold text-white leading-tight truncate">{fmt(totals.comments)}</div>
            <div className="text-[10px] sm:text-[11px] text-white/40 uppercase tracking-wider">Comments</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass rounded-xl border border-white/10 p-3 mb-6">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
          {/* Row 1 on mobile: Platform + Sort */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {(['all', 'tiktok', 'instagram', 'youtube'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all ${platform === p ? 'bg-white/20 text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
                >{p === 'all' ? 'Semua' : p === 'instagram' ? 'IG' : p.charAt(0).toUpperCase() + p.slice(1)}</button>
              ))}
            </div>
            {/* Sort - next to platform on mobile, end of row on desktop */}
            <div className="relative sm:hidden ml-auto">
              <SortDesc className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 transition-colors appearance-none cursor-pointer"
              >
                <option value="views">Views</option>
                <option value="likes">Likes</option>
                <option value="comments">Comments</option>
                <option value="newest">Terbaru</option>
              </select>
            </div>
          </div>

          <div className="w-px h-6 bg-white/10 hidden sm:block" />

          {/* Row 2 on mobile: Date range */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <Calendar className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-2 sm:px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 transition-colors flex-1 sm:flex-none sm:w-[130px] min-w-0"
            />
            <span className="text-white/30 text-xs">-</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-2 sm:px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 transition-colors flex-1 sm:flex-none sm:w-[130px] min-w-0"
            />
            <button
              onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 30)
                setDateRange({ start: d.toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) })
              }}
              className="px-2 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/40 hover:text-white transition-colors flex-shrink-0"
              title="Reset ke 30 hari terakhir"
            >Reset</button>
          </div>

          <div className="w-px h-6 bg-white/10 hidden sm:block" />

          {/* Row 3 on mobile: Hashtag search */}
          <div className="relative w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari hashtag..."
              value={hashtag}
              onChange={(e) => setHashtag(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 transition-colors w-full sm:w-[150px] placeholder:text-white/25"
            />
          </div>

          {/* Sort - desktop only (mobile is in row 1) */}
          <div className="relative ml-auto hidden sm:block">
            <SortDesc className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 transition-colors appearance-none cursor-pointer"
            >
              <option value="views">Views Tertinggi</option>
              <option value="likes">Likes Tertinggi</option>
              <option value="comments">Comments Tertinggi</option>
              <option value="newest">Terbaru</option>
            </select>
          </div>
        </div>
      </div>

      {/* Loading indicator */}
      {loading && <div className="text-center text-white/40 py-3 animate-pulse text-sm mb-4">Memuat...</div>}

      {/* Video grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sortedVideos.map((v: any, i: number) => (
          <a
            key={`${v.platform}-${v.id}-${i}`}
            href={v.link}
            target="_blank"
            rel="noopener noreferrer"
            className="glass rounded-xl border border-white/10 hover:border-white/25 transition-all hover:-translate-y-0.5 block group"
          >
            {/* Card header */}
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${platformColors[v.platform] || 'bg-gray-600 text-white'}`}>
                    {v.platform === 'instagram' ? 'IG' : v.platform === 'tiktok' ? 'TT' : 'YT'}
                  </span>
                  <span className="text-xs text-white/60 truncate">@{v.username}</span>
                </div>
                <span className="text-[10px] text-white/30 font-mono flex-shrink-0 ml-2">
                  {v.taken_at ? new Date(v.taken_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-'}
                </span>
              </div>
              {v.owner_name && v.owner_name !== v.username && (
                <div className="mt-1 text-[11px] text-emerald-400/80 truncate font-medium">
                  {v.owner_name}
                </div>
              )}
            </div>

            {/* Caption */}
            <div className="px-4 pb-3">
              <div className="text-white/80 text-sm leading-snug line-clamp-2 min-h-[2.5rem] group-hover:text-blue-300 transition-colors">
                {v.title || v.caption || '(No description)'}
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 border-t border-white/[0.06] bg-white/[0.02]">
              <div className="flex flex-col items-center py-2.5 gap-0.5">
                <span className="text-white text-sm font-semibold">{fmt(v.views)}</span>
                <span className="text-white/30 text-[9px] uppercase tracking-wider">Views</span>
              </div>
              <div className="flex flex-col items-center py-2.5 gap-0.5 border-x border-white/[0.06]">
                <span className="text-white text-sm font-semibold">{fmt(v.likes)}</span>
                <span className="text-white/30 text-[9px] uppercase tracking-wider">Likes</span>
              </div>
              <div className="flex flex-col items-center py-2.5 gap-0.5">
                <span className="text-white text-sm font-semibold">{fmt(v.comments)}</span>
                <span className="text-white/30 text-[9px] uppercase tracking-wider">Comments</span>
              </div>
            </div>
          </a>
        ))}
        {sortedVideos.length === 0 && !loading && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-white/40 glass rounded-2xl border border-white/5">
            <Video className="w-10 h-10 mb-3 opacity-30" />
            <div className="text-lg font-medium">Tidak ada video ditemukan</div>
            <div className="text-sm mt-1 opacity-60">Coba ubah filter tanggal atau platform.</div>
          </div>
        )}
      </div>
    </div>
  )
}
