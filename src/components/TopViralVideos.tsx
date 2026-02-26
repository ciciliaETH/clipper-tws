'use client';

import { useEffect, useState } from 'react';

interface VideoMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  total_engagement: number;
}

interface ViralVideo {
  platform: 'tiktok' | 'instagram' | 'youtube';
  video_id: string;
  username: string;
  owner_name: string | null;
  owner_id: string;
  taken_at: string;
  link: string;
  title?: string;
  metrics: VideoMetrics;
  snapshots_count: number;
}

interface TopVideosResponse {
  videos: ViralVideo[];
  campaign_id: string;
  platform: string;
  start: string;
  end: string;
  days: number;
  total_found: number;
  showing: number;
}

interface TopViralVideosProps {
  campaignId: string;
  platform?: 'all' | 'tiktok' | 'instagram' | 'youtube';
  days?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}

export default function TopViralVideos({
  campaignId,
  platform = 'all',
  days = 30,
  limit = 10,
  startDate,
  endDate,
}: TopViralVideosProps) {
  const [data, setData] = useState<TopVideosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTopVideos = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          platform,
          days: String(days),
          limit: String(limit),
        });
        if (campaignId === 'no_campaign') {
          params.set('filter_mode', 'no_campaign');
        } else {
          params.set('campaign_id', campaignId);
        }
        if (startDate) params.set('start', startDate);
        if (endDate) params.set('end', endDate);

        const res = await fetch(`/api/leaderboard/top-videos?${params}`);

        if (!res.ok) {
          throw new Error(`Failed to fetch: ${res.status}`);
        }

        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || 'Failed to load viral videos');
      } finally {
        setLoading(false);
      }
    };

    fetchTopVideos();
  }, [campaignId, platform, days, limit, startDate, endDate]);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const getPlatformColor = (p: string) => {
    if (p === 'tiktok') return 'bg-white/10 text-white border border-white/20';
    if (p === 'youtube') return 'bg-red-500/20 text-red-300 border border-red-500/30';
    return 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
  };

  const getPlatformIcon = (p: string) => {
    if (p === 'tiktok') return '♪';
    if (p === 'youtube') return '▶';
    return '◎';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-white">Top Viral Videos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass rounded-xl border border-white/10 p-4 animate-pulse">
              <div className="h-4 bg-white/10 rounded w-3/4 mb-3"></div>
              <div className="h-3 bg-white/10 rounded w-1/2 mb-2"></div>
              <div className="h-3 bg-white/10 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-xl border border-red-500/30 p-4">
        <h2 className="text-lg font-bold text-red-300 mb-2">Error</h2>
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  if (!data || data.videos.length === 0) {
    return (
      <div className="glass rounded-xl border border-white/10 p-8 text-center">
        <p className="text-white/60">Tidak ada video ditemukan untuk campaign ini</p>
        <p className="text-white/40 text-sm mt-1">Coba ubah periode atau platform</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Top Viral Videos</h2>
        <div className="text-xs text-white/50">
          {data.showing} dari {data.total_found} video
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.videos.map((video, index) => (
          <a
            key={`${video.platform}-${video.video_id}`}
            href={video.link}
            target="_blank"
            rel="noopener noreferrer"
            className="glass rounded-xl border border-white/10 overflow-hidden hover:border-white/25 transition-all group"
          >
            <div className="p-4">
              {/* Top row: rank + platform */}
              <div className="flex items-center justify-between mb-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                  index === 0 ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
                  index === 1 ? 'bg-gray-400/20 text-gray-300 border border-gray-400/30' :
                  index === 2 ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' :
                  'bg-white/10 text-white/60 border border-white/10'
                }`}>
                  {index + 1}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getPlatformColor(video.platform)}`}>
                  {getPlatformIcon(video.platform)} {video.platform.toUpperCase()}
                </span>
              </div>

              {/* User info */}
              <div className="mb-3">
                <div className="font-semibold text-white group-hover:text-blue-300 transition-colors text-sm">
                  {video.owner_name || video.username}
                </div>
                <div className="text-xs text-white/50">@{video.username}</div>
                {video.title && (
                  <div className="text-xs text-white/40 mt-1 line-clamp-2">{video.title}</div>
                )}
              </div>

              {/* Views - main metric */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/50 text-xs">Views</span>
                <span className="font-bold text-white text-lg">{formatNumber(video.metrics.views)}</span>
              </div>

              {/* Other metrics */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-white/40">Likes</span>
                  <span className="text-white/80">{formatNumber(video.metrics.likes)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Comments</span>
                  <span className="text-white/80">{formatNumber(video.metrics.comments)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Shares</span>
                  <span className="text-white/80">{formatNumber(video.metrics.shares)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Saves</span>
                  <span className="text-white/80">{formatNumber(video.metrics.saves)}</span>
                </div>
              </div>

              {/* Engagement footer */}
              <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-white/30">{video.snapshots_count} snapshot{video.snapshots_count > 1 ? 's' : ''}</span>
                <span className="text-xs font-semibold text-blue-400">{formatNumber(video.metrics.total_engagement)} eng.</span>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* Summary */}
      <div className="glass rounded-xl border border-white/10 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-lg font-bold text-white">{formatNumber(data.videos.reduce((s, v) => s + v.metrics.views, 0))}</div>
            <div className="text-[10px] text-white/40">Total Views</div>
          </div>
          <div>
            <div className="text-lg font-bold text-pink-400">{formatNumber(data.videos.reduce((s, v) => s + v.metrics.likes, 0))}</div>
            <div className="text-[10px] text-white/40">Total Likes</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-400">{formatNumber(data.videos.reduce((s, v) => s + v.metrics.shares, 0))}</div>
            <div className="text-[10px] text-white/40">Total Shares</div>
          </div>
          <div>
            <div className="text-lg font-bold text-purple-400">{formatNumber(data.videos.reduce((s, v) => s + v.metrics.total_engagement, 0))}</div>
            <div className="text-[10px] text-white/40">Total Engagement</div>
          </div>
        </div>
      </div>
    </div>
  );
}
