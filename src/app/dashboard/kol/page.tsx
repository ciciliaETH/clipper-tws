'use client';

import { useEffect, useMemo, useState } from 'react';

interface KolVideo {
  id: string;
  campaign_id: string | null;
  platform: string;
  video_url: string;
  video_id: string;
  username: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  added_at: string;
  last_updated: string;
}

interface Campaign {
  id: string;
  name: string;
}

export default function KolPage() {
  const [videos, setVideos] = useState<KolVideo[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [bulkUrls, setBulkUrls] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [filterCampaign, setFilterCampaign] = useState<string>('');
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'tiktok' | 'instagram' | 'youtube'>('all');
  const [sortBy, setSortBy] = useState<'views' | 'likes' | 'comments'>('views');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadVideos = async () => {
    setLoading(true);
    try {
      const url = filterCampaign ? `/api/kol-videos?campaign_id=${filterCampaign}` : '/api/kol-videos';
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setVideos(Array.isArray(data) ? data : []);
    } catch { setVideos([]); }
    setLoading(false);
  };

  const loadCampaigns = async () => {
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      const data = await res.json();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => { loadCampaigns(); }, []);
  useEffect(() => { loadVideos(); }, [filterCampaign]);

  const addVideo = async (url: string) => {
    const res = await fetch('/api/kol-videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: url.trim(), campaign_id: selectedCampaign || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add video');
    return data;
  };

  const handleAdd = async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    setMessage(null);
    try {
      await addVideo(newUrl);
      setNewUrl('');
      setMessage({ type: 'success', text: 'Video berhasil ditambahkan!' });
      loadVideos();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    }
    setAdding(false);
  };

  const handleBulkAdd = async () => {
    const urls = bulkUrls.split(/[\n,]+/).map(u => u.trim()).filter(u => u && u.startsWith('http'));
    if (urls.length === 0) return;
    setAdding(true);
    setMessage(null);
    let success = 0, failed = 0;
    for (const url of urls) {
      try { await addVideo(url); success++; } catch { failed++; }
    }
    setBulkUrls('');
    setShowBulk(false);
    setMessage({ type: 'success', text: `${success} video ditambahkan, ${failed} gagal` });
    loadVideos();
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus video KOL ini?')) return;
    await fetch(`/api/kol-videos?id=${id}`, { method: 'DELETE' });
    loadVideos();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/kol-videos/refresh', { method: 'POST' });
      const data = await res.json();
      setMessage({ type: 'success', text: `${data.updated}/${data.total} video di-update` });
      loadVideos();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    }
    setRefreshing(false);
  };

  const platformBadge = (p: string) => {
    if (p === 'tiktok') return <span className="inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">TT</span>;
    if (p === 'instagram') return <span className="inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400">IG</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">YT</span>;
  };

  // Filtered + sorted videos
  const displayVideos = useMemo(() => {
    let filtered = videos;
    if (filterPlatform !== 'all') filtered = filtered.filter(v => v.platform === filterPlatform);
    return [...filtered].sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }, [videos, filterPlatform, sortBy]);

  const totals = displayVideos.reduce((acc, v) => ({
    views: acc.views + (v.views || 0),
    likes: acc.likes + (v.likes || 0),
    comments: acc.comments + (v.comments || 0),
  }), { views: 0, likes: 0, comments: 0 });

  const exportCSV = () => {
    if (displayVideos.length === 0) return;
    const headers = ['No', 'Platform', 'Username', 'Title', 'Views', 'Likes', 'Comments', 'Shares', 'Link'];
    const rows = displayVideos.map((v, i) => [
      i + 1, v.platform, '@' + v.username, `"${(v.title || '').replace(/"/g, '""')}"`,
      v.views || 0, v.likes || 0, v.comments || 0, v.shares || 0, v.video_url
    ]);
    const totalRow = ['', '', '', 'TOTAL', totals.views, totals.likes, totals.comments, '', ''];
    const csv = [headers, ...rows, totalRow].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kol-videos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const formatDate = (d: string) => {
    if (!d) return '';
    try {
      const date = new Date(d);
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } catch { return ''; }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass rounded-2xl p-4 sm:p-6 border border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Video KOL</h1>
            <p className="text-white/50 text-xs sm:text-sm mt-1">Key Opinion Leader Video Tracking</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 sm:px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-medium flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              <span className="hidden sm:inline">Tambah Video</span><span className="sm:hidden">Tambah</span>
            </button>
            <button
              onClick={exportCSV}
              disabled={displayVideos.length === 0}
              className="px-3 sm:px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-medium flex items-center gap-1.5 border border-white/10 disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" /></svg>
              CSV
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 sm:px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {message && (
          <div className={`p-3 rounded-lg text-sm mb-4 ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
            {message.text}
          </div>
        )}
      </div>

      {/* Stats Cards - matching Groups style */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
        <div className="glass rounded-xl p-3 sm:p-5 border border-white/10 flex items-center gap-3 sm:gap-4">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg shrink-0 bg-blue-500/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-bold text-white">{displayVideos.length.toLocaleString('id-ID')}</p>
            <p className="text-white/50 text-xs uppercase tracking-wider">Videos</p>
          </div>
        </div>
        <div className="glass rounded-xl p-3 sm:p-5 border border-white/10 flex items-center gap-3 sm:gap-4">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg shrink-0 bg-emerald-500/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-bold text-emerald-400">{totals.views.toLocaleString('id-ID')}</p>
            <p className="text-white/50 text-xs uppercase tracking-wider">Views</p>
          </div>
        </div>
        <div className="glass rounded-xl p-3 sm:p-5 border border-white/10 flex items-center gap-3 sm:gap-4">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg shrink-0 bg-pink-500/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-bold text-pink-400">{totals.likes.toLocaleString('id-ID')}</p>
            <p className="text-white/50 text-xs uppercase tracking-wider">Likes</p>
          </div>
        </div>
        <div className="glass rounded-xl p-3 sm:p-5 border border-white/10 flex items-center gap-3 sm:gap-4">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg shrink-0 bg-blue-500/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          </div>
          <div>
            <p className="text-lg sm:text-2xl font-bold text-blue-400">{totals.comments.toLocaleString('id-ID')}</p>
            <p className="text-white/50 text-xs uppercase tracking-wider">Comments</p>
          </div>
        </div>
      </div>

      {/* Add Video Form (collapsible) */}
      {showAddForm && (
        <div className="glass rounded-xl p-3 sm:p-4 border border-white/10 space-y-3">
          <h2 className="text-sm font-semibold text-white">Tambah Video KOL</h2>
          <div className="flex flex-col gap-2">
            <select value={selectedCampaign} onChange={e => setSelectedCampaign(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0f1729] border border-white/10 text-white text-sm [&>option]:bg-[#0f1729] [&>option]:text-white">
              <option value="">-- Campaign (opsional) --</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="text" value={newUrl} onChange={e => setNewUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Paste link video TikTok / Instagram / YouTube..."
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/40" />
            <button onClick={handleAdd} disabled={adding || !newUrl.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap">
              {adding ? 'Adding...' : '+ Tambah'}
            </button>
            <button onClick={() => setShowBulk(!showBulk)}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm border border-white/10">Bulk</button>
          </div>
          {showBulk && (
            <div className="space-y-2">
              <textarea value={bulkUrls} onChange={e => setBulkUrls(e.target.value)} rows={5}
                placeholder="Paste banyak link, pisahkan dengan koma atau enter..."
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/40" />
              <button onClick={handleBulkAdd} disabled={adding}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50">
                {adding ? 'Adding...' : `Tambah ${bulkUrls.split(/[\n,]+/).filter(u => u.trim().startsWith('http')).length} Video`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filters Bar - matching Groups style */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          {(['all', 'tiktok', 'instagram', 'youtube'] as const).map(p => (
            <button key={p} onClick={() => setFilterPlatform(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${filterPlatform === p ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
              {p === 'all' ? 'Semua' : p === 'tiktok' ? 'Tiktok' : p === 'instagram' ? 'IG' : 'Youtube'}
            </button>
          ))}
          {campaigns.length > 1 && (
            <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}
              className="ml-2 px-3 py-1.5 rounded-lg bg-[#0f1729] border border-white/10 text-white text-sm [&>option]:bg-[#0f1729] [&>option]:text-white">
              <option value="">Semua Campaign</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg bg-[#0f1729] border border-white/10 text-white text-sm [&>option]:bg-[#0f1729] [&>option]:text-white">
            <option value="views">Views Tertinggi</option>
            <option value="likes">Likes Tertinggi</option>
            <option value="comments">Comments Tertinggi</option>
          </select>
        </div>
      </div>

      {/* Video Grid - matching Groups card style */}
      {loading ? (
        <p className="text-white/60">Memuat...</p>
      ) : displayVideos.length === 0 ? (
        <div className="glass rounded-xl p-8 border border-white/10 text-center">
          <p className="text-white/60">Belum ada video KOL. Klik "Tambah Video" untuk mulai tracking.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {displayVideos.map((v) => (
            <a key={v.id} href={v.video_url} target="_blank" rel="noopener noreferrer"
              className="glass rounded-xl border border-white/10 hover:border-white/20 transition group relative">
              <div className="p-4 space-y-3">
                {/* Header: platform + username + date */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {platformBadge(v.platform)}
                    <span className="text-white text-sm font-medium truncate">@{v.username}</span>
                  </div>
                  <span className="text-white/40 text-xs shrink-0">{formatDate(v.added_at)}</span>
                </div>

                {/* Title */}
                <p className="text-white/80 text-sm line-clamp-2 min-h-[2.5rem]">
                  {v.title || '-'}
                </p>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
                  <div className="text-center">
                    <p className="text-white font-bold text-sm">{(v.views || 0).toLocaleString('id-ID')}</p>
                    <p className="text-white/40 text-[10px] uppercase">Views</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-bold text-sm">{(v.likes || 0).toLocaleString('id-ID')}</p>
                    <p className="text-white/40 text-[10px] uppercase">Likes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-bold text-sm">{(v.comments || 0).toLocaleString('id-ID')}</p>
                    <p className="text-white/40 text-[10px] uppercase">Comments</p>
                  </div>
                </div>
              </div>

              {/* Delete button (top-right corner on hover) */}
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(v.id); }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/40 opacity-0 group-hover:opacity-100 transition"
                title="Hapus"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
