'use client';

import { useEffect, useState } from 'react';

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
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [filterCampaign, setFilterCampaign] = useState<string>('');
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
    const urls = bulkUrls.split('\n').map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) return;
    setAdding(true);
    setMessage(null);
    let success = 0, failed = 0;
    for (const url of urls) {
      try {
        await addVideo(url);
        success++;
      } catch {
        failed++;
      }
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

  const platformIcon = (p: string) => {
    if (p === 'tiktok') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">TT</span>;
    if (p === 'instagram') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400">IG</span>;
    return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">YT</span>;
  };

  const totals = videos.reduce((acc, v) => ({
    views: acc.views + (v.views || 0),
    likes: acc.likes + (v.likes || 0),
    comments: acc.comments + (v.comments || 0),
  }), { views: 0, likes: 0, comments: 0 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Video KOL</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {refreshing ? 'Refreshing...' : 'Refresh Metrics'}
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
          {message.text}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass rounded-xl p-4 border border-white/10">
          <p className="text-white/60 text-xs">Videos</p>
          <p className="text-xl font-bold text-white">{videos.length.toLocaleString('id-ID')}</p>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <p className="text-white/60 text-xs">Views</p>
          <p className="text-xl font-bold text-emerald-400">{totals.views.toLocaleString('id-ID')}</p>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <p className="text-white/60 text-xs">Likes</p>
          <p className="text-xl font-bold text-pink-400">{totals.likes.toLocaleString('id-ID')}</p>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <p className="text-white/60 text-xs">Comments</p>
          <p className="text-xl font-bold text-blue-400">{totals.comments.toLocaleString('id-ID')}</p>
        </div>
      </div>

      {/* Add Video */}
      <div className="glass rounded-xl p-4 border border-white/10 space-y-3">
        <h2 className="text-sm font-semibold text-white">Tambah Video KOL</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={selectedCampaign}
            onChange={e => setSelectedCampaign(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
          >
            <option value="">-- Pilih Campaign (opsional) --</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            type="text"
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Paste link video TikTok / Instagram / YouTube..."
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/40"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newUrl.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {adding ? 'Adding...' : '+ Tambah'}
          </button>
          <button
            onClick={() => setShowBulk(!showBulk)}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm border border-white/10"
          >
            Bulk
          </button>
        </div>

        {showBulk && (
          <div className="space-y-2">
            <textarea
              value={bulkUrls}
              onChange={e => setBulkUrls(e.target.value)}
              rows={5}
              placeholder="Paste banyak link, 1 link per baris..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/40"
            />
            <button
              onClick={handleBulkAdd}
              disabled={adding}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {adding ? 'Adding...' : `Tambah ${bulkUrls.split('\n').filter(u => u.trim()).length} Video`}
            </button>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-white/60 text-xs">Filter Campaign:</span>
        <select
          value={filterCampaign}
          onChange={e => setFilterCampaign(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
        >
          <option value="">Semua</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Video List */}
      {loading ? (
        <p className="text-white/60">Memuat...</p>
      ) : videos.length === 0 ? (
        <div className="glass rounded-xl p-8 border border-white/10 text-center">
          <p className="text-white/60">Belum ada video KOL. Paste link video di atas untuk mulai tracking.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/60 border-b border-white/10">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Platform</th>
                <th className="px-3 py-2">Username</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2 text-right">Views</th>
                <th className="px-3 py-2 text-right">Likes</th>
                <th className="px-3 py-2 text-right">Comments</th>
                <th className="px-3 py-2">Link</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v, i) => (
                <tr key={v.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 text-white/40">{i + 1}</td>
                  <td className="px-3 py-2">{platformIcon(v.platform)}</td>
                  <td className="px-3 py-2 text-white">@{v.username}</td>
                  <td className="px-3 py-2 text-white/80 max-w-xs truncate">{v.title || '-'}</td>
                  <td className="px-3 py-2 text-right text-white font-medium">{(v.views || 0).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right text-white/80">{(v.likes || 0).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right text-white/80">{(v.comments || 0).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2">
                    <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">
                      Buka
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleDelete(v.id)} className="text-red-400 hover:text-red-300 text-xs">
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/20 font-bold">
                <td colSpan={4} className="px-3 py-2 text-right text-white">Total</td>
                <td className="px-3 py-2 text-right text-white">{totals.views.toLocaleString('id-ID')}</td>
                <td className="px-3 py-2 text-right text-white">{totals.likes.toLocaleString('id-ID')}</td>
                <td className="px-3 py-2 text-right text-white">{totals.comments.toLocaleString('id-ID')}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
