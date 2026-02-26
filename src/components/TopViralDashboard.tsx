'use client'

import { useState, useEffect } from 'react'
import { ExternalLink, TrendingUp, Eye, Heart, MessageCircle, Share2 } from 'lucide-react'

interface Video {
  platform: 'tiktok' | 'instagram' | 'youtube'
  video_id: string
  username: string
  owner_name: string
  owner_id: string | null
  taken_at: string
  link: string
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
    saves: number
    total_engagement: number
  }
  snapshots_count: number
}

interface TopViralDashboardProps {
  campaignId?: string
  days?: number
  limit?: number
}

export default function TopViralDashboard({ campaignId, days = 30, limit = 5 }: TopViralDashboardProps) {
  const [videos, setVideos] = useState<Video[]>([])
  const [totalPosts, setTotalPosts] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'all'|'tiktok'|'instagram'|'youtube'>('all')

  // Range selector: 'calendar' = bulan ini, 'days' = X hari terakhir
  const [rangeMode, setRangeMode] = useState<'calendar' | 'days'>('calendar')
  const [selectedDays, setSelectedDays] = useState<number>(days)

  // Campaign filter: 'all' = semua video, 'no_campaign' = tanpa hashtag, or campaign id
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [filterMode, setFilterMode] = useState<string>('all') // 'all' | 'no_campaign' | campaign_id

  useEffect(() => {
    const loadCampaigns = async () => {
      try {
        const r = await fetch('/api/campaigns/public')
        const j = await r.json()
        if (r.ok && Array.isArray(j)) setCampaigns(j)
      } catch {}
    }
    loadCampaigns()
  }, [])

  useEffect(() => {
    const fetchVideos = async () => {
      setLoading(true)
      setError(null)

      try {
        const url = new URL('/api/leaderboard/top-videos', window.location.origin)
        // Campaign filter
        if (filterMode === 'no_campaign') {
          url.searchParams.set('filter_mode', 'no_campaign')
        } else if (filterMode !== 'all') {
          url.searchParams.set('campaign_id', filterMode)
        }
        if (campaignId) url.searchParams.set('campaign_id', campaignId)
        url.searchParams.set('limit', String(limit))
        url.searchParams.set('platform', platform)
        if (rangeMode === 'calendar') {
          url.searchParams.set('mode', 'calendar')
          url.searchParams.set('days', String(selectedDays))
        } else {
          url.searchParams.set('days', String(selectedDays))
        }
        const res = await fetch(url.toString())

        if (!res.ok) {
          throw new Error('Failed to fetch top videos')
        }

        const data = await res.json()
        setVideos(data.videos || [])
        setTotalPosts(data.total_found || 0)
      } catch (err: any) {
        setError(err.message || 'Error loading videos')
      } finally {
        setLoading(false)
      }
    }

    fetchVideos()
  }, [campaignId, limit, rangeMode, selectedDays, platform, filterMode])

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  if (loading) {
    return (
      <div className="glass p-6 rounded-2xl">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp className="w-6 h-6 text-pink-500" />
          <h2 className="text-xl font-bold text-white">Top {limit} Video FYP</h2>
          <span className="text-sm text-white/60">(bulan ini)</span>
        </div>
        
        <div className="space-y-4">
          {[...Array(limit)].map((_, i) => (
            <div key={i} className="glass-card p-4 rounded-xl animate-pulse">
              <div className="flex gap-4">
                <div className="w-24 h-24 bg-white/10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-3/4" />
                  <div className="h-3 bg-white/10 rounded w-1/2" />
                  <div className="h-3 bg-white/10 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="glass p-6 rounded-2xl border border-red-500/30">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-6 h-6 text-red-500" />
          <h2 className="text-xl font-bold text-white">Top {limit} Video FYP</h2>
        </div>
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    )
  }

  if (videos.length === 0) {
    return (
      <div className="glass p-6 rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-6 h-6 text-white/60" />
          <h2 className="text-xl font-bold text-white">Top {limit} Video FYP</h2>
          <span className="text-sm text-white/60">(bulan ini)</span>
        </div>
        <p className="text-white/60 text-sm">Belum ada data video</p>
      </div>
    )
  }

  return (
    <div className="glass p-6 rounded-2xl">
      <div className="flex items-center justify-between gap-3 mb-6">
        <TrendingUp className="w-6 h-6 text-pink-500" />
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Top {limit} Video FYP</h2>
          <span className="text-sm text-white/60">
            {rangeMode === 'calendar' ? '(bulan ini)' : `(${selectedDays} hari terakhir)`}
          </span>
        </div>
        {/* Platform + Range controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-3">
            {(['all','tiktok','instagram','youtube'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${platform===p ? 'bg-white/20 text-white border-white/30' : 'bg-white/10 text-white/80 border-white/10 hover:bg-white/15'}`}
              >{p==='all'?'ALL': p==='tiktok'?'TikTok': p==='instagram'?'Instagram':'YouTube'}</button>
            ))}
          </div>
          <button
            onClick={() => { setRangeMode('days'); setSelectedDays(7); }}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${rangeMode==='days' && selectedDays===7 ? 'bg-white/20 text-white border-white/30' : 'bg-white/10 text-white/80 border-white/10 hover:bg-white/15'}`}
          >7 hari</button>
          <button
            onClick={() => { setRangeMode('days'); setSelectedDays(30); }}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${rangeMode==='days' && selectedDays===30 ? 'bg-white/20 text-white border-white/30' : 'bg-white/10 text-white/80 border-white/10 hover:bg-white/15'}`}
          >30 hari</button>
          <button
            onClick={() => setRangeMode('calendar')}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${rangeMode==='calendar' ? 'bg-white/20 text-white border-white/30' : 'bg-white/10 text-white/80 border-white/10 hover:bg-white/15'}`}
          >Bulan ini</button>
          {/* Campaign hashtag filter */}
          {campaigns.length > 0 && (
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs bg-white/10 border border-white/20 text-white appearance-none cursor-pointer hover:bg-white/15 focus:outline-none focus:ring-1 focus:ring-white/30 ml-2"
            >
              <option value="all" className="bg-gray-900 text-white">Semua</option>
              {campaigns.map((c: any) => (
                <option key={c.id} value={c.id} className="bg-gray-900 text-white">{c.name}</option>
              ))}
              <option value="no_campaign" className="bg-gray-900 text-white">Semua No Campaign</option>
            </select>
          )}
        </div>
      </div>
      {/* Hashtag badges */}
      {filterMode !== 'all' && filterMode !== 'no_campaign' && (() => {
        const camp = campaigns.find((c: any) => String(c.id) === filterMode);
        if (!camp?.required_hashtags?.length) return null;
        return (
          <div className="flex items-center gap-1.5 mb-4 ml-9">
            <span className="text-white/40 text-xs">Hashtag:</span>
            {camp.required_hashtags.map((tag: string) => (
              <span key={tag} className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-medium">{tag}</span>
            ))}
          </div>
        );
      })()}
      {filterMode === 'no_campaign' && (
        <div className="flex items-center gap-1.5 mb-4 ml-9">
          <span className="text-white/40 text-xs">Filter:</span>
          <span className="px-2 py-0.5 rounded-full bg-orange-500/20 border border-orange-500/30 text-orange-300 text-[10px] font-medium">Video tanpa hashtag campaign</span>
        </div>
      )}

      <div className="space-y-4">
        {videos.map((video, index) => (
          <div
            key={`${video.platform}-${video.video_id}`}
            className="glass-card p-4 rounded-xl hover:bg-white/10 transition-all group"
          >
            <div className="flex gap-4">
              {/* Rank Badge */}
              <div className="flex-shrink-0">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold ${
                    index === 0
                      ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-yellow-900'
                      : index === 1
                      ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800'
                      : index === 2
                      ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-orange-900'
                      : 'bg-gradient-to-br from-blue-500 to-purple-600 text-white'
                  }`}
                >
                  #{index + 1}
                </div>
              </div>

              {/* Video Info */}
              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          video.platform === 'tiktok'
                            ? 'bg-black text-white'
                            : video.platform === 'instagram'
                              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                              : 'bg-red-600 text-white'
                        }`}
                      >
                        {video.platform === 'tiktok' ? '🎵 TikTok' : video.platform === 'instagram' ? '📸 Instagram' : '▶️ YouTube'}
                      </span>
                    </div>
                    <h3 className="text-white font-semibold truncate">{video.owner_name}</h3>
                    <p className="text-white/60 text-sm truncate">@{video.username}</p>
                  </div>

                  {/* Link Button */}
                  <a
                    href={video.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-all text-white text-sm font-medium group-hover:scale-105"
                  >
                    <span>Lihat</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-blue-400" />
                    <div>
                      <p className="text-xs text-white/60">Views</p>
                      <p className="text-white font-semibold">{formatNumber(video.metrics.views)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-red-400" />
                    <div>
                      <p className="text-xs text-white/60">Likes</p>
                      <p className="text-white font-semibold">{formatNumber(video.metrics.likes)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-green-400" />
                    <div>
                      <p className="text-xs text-white/60">Comments</p>
                      <p className="text-white font-semibold">{formatNumber(video.metrics.comments)}</p>
                    </div>
                  </div>

                  {video.platform === 'tiktok' && (
                    <div className="flex items-center gap-2">
                      <Share2 className="w-4 h-4 text-purple-400" />
                      <div>
                        <p className="text-xs text-white/60">Shares</p>
                        <p className="text-white font-semibold">{formatNumber(video.metrics.shares)}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Post Date */}
                <div className="mt-2 text-xs text-white/50">
                  Posted: {new Date(video.taken_at).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary Footer */}
      <div className="mt-6 pt-4 border-t border-white/10">
        <div className="text-center text-sm text-white/60">
          <p>
            Total Posts: <span className="text-white font-semibold">{totalPosts}</span>
            {' • '}
            Total engagement: <span className="text-white font-semibold">
              {formatNumber(videos.reduce((sum, v) => sum + v.metrics.total_engagement, 0))}
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
