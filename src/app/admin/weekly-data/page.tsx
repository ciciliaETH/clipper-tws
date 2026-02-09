'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

interface WeeklyData {
  id: number;
  week_label: string;
  start_date: string;
  end_date: string;
  year: number;
  month: number;
  week_num: number;
  campaign_id?: string;
  group_name?: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  notes?: string;
}

interface Campaign {
  id: string;
  name: string;
}

export default function WeeklyDataInput() {
  const [existingData, setExistingData] = useState<WeeklyData[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    week_label: '',
    start_date: '',
    end_date: '',
    campaign_id: '',
    group_name: '',
    platform: 'TIKTOK',
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    notes: ''
  });

  // Load existing data and campaigns
  useEffect(() => {
    loadData();
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    try {
      const res = await fetch('/api/campaigns');
      const json = await res.json();
      if (json.data) {
        setCampaigns(json.data);
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/weekly-data?year=2025');
      const json = await res.json();
      if (json.data) {
        setExistingData(json.data);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.week_label || !formData.start_date || !formData.end_date || !formData.platform) {
      alert('Mohon lengkapi Week Label, Start Date, End Date, dan Platform');
      return;
    }

    // Calculate year from start_date
    const year = new Date(formData.start_date).getFullYear();

    setLoading(true);
    try {
      const res = await fetch('/api/admin/weekly-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, year })
      });

      const json = await res.json();

      if (res.ok) {
        alert('Data berhasil disimpan!');
        setFormData({
          week_label: '',
          start_date: '',
          end_date: '',
          campaign_id: '',
          group_name: '',
          platform: 'TIKTOK',
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          notes: ''
        });
        loadData();
      } else {
        alert(`Error: ${json.error || 'Failed to save data'}`);
      }
    } catch (error) {
      console.error('Error submitting:', error);
      alert('Error submitting data');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Hapus data ini?')) return;

    try {
      const res = await fetch(`/api/admin/weekly-data?id=${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        alert('Data berhasil dihapus!');
        loadData();
      } else {
        const json = await res.json();
        alert(`Error: ${json.error || 'Failed to delete'}`);
      }
    } catch (error) {
      console.error('Error deleting:', error);
      alert('Error deleting data');
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <span>📊</span> Input Data Mingguan
        </h1>

        {/* Form */}
        <div className="glass rounded-2xl p-6 border border-white/10 mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Week Label */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Week Label <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.week_label}
                onChange={(e) => setFormData({ ...formData, week_label: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                placeholder="W1 Agustus"
                required
              />
              <p className="text-xs text-white/50 mt-1">Format: W1 Agustus, W2 Agustus, dst.</p>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Start Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  End Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  required
                />
              </div>
            </div>

            {/* Campaign & Group */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Campaign (Opsional)
                </label>
                <select
                  value={formData.campaign_id}
                  onChange={(e) => setFormData({ ...formData, campaign_id: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                >
                  <option value="">Semua Campaign</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Group Name (Opsional)
                </label>
                <input
                  type="text"
                  value={formData.group_name}
                  onChange={(e) => setFormData({ ...formData, group_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  placeholder="Nama grup/tim"
                />
              </div>
            </div>

            {/* Platform */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Platform <span className="text-red-400">*</span>
              </label>
              <select
                value={formData.platform}
                onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                required
              >
                <option value="TIKTOK">TikTok</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="YOUTUBE">YouTube</option>
              </select>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Views</label>
                <input
                  type="number"
                  value={formData.views}
                  onChange={(e) => setFormData({ ...formData, views: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Likes</label>
                <input
                  type="number"
                  value={formData.likes}
                  onChange={(e) => setFormData({ ...formData, likes: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Comments</label>
                <input
                  type="number"
                  value={formData.comments}
                  onChange={(e) => setFormData({ ...formData, comments: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Shares</label>
                <input
                  type="number"
                  value={formData.shares}
                  onChange={(e) => setFormData({ ...formData, shares: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Saves</label>
                <input
                  type="number"
                  value={formData.saves}
                  onChange={(e) => setFormData({ ...formData, saves: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white"
                  min="0"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Catatan (Opsional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white resize-none"
                rows={3}
                placeholder="Tambahkan catatan jika perlu..."
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full md:w-auto px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Menyimpan...' : '💾 Simpan Data'}
            </button>
          </form>
        </div>

        {/* Data Table */}
        <div className="glass rounded-2xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-4">
            Data Tersimpan ({existingData.length})
          </h2>

          {loading ? (
            <div className="text-center text-white/60 py-8">Loading...</div>
          ) : existingData.length === 0 ? (
            <div className="text-center text-white/60 py-8">
              Belum ada data. Silakan input data di form di atas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-2 text-white/70 font-medium">Week</th>
                    <th className="text-left py-3 px-2 text-white/70 font-medium">Periode</th>
                    <th className="text-left py-3 px-2 text-white/70 font-medium">Platform</th>
                    <th className="text-right py-3 px-2 text-white/70 font-medium">Views</th>
                    <th className="text-right py-3 px-2 text-white/70 font-medium">Likes</th>
                    <th className="text-right py-3 px-2 text-white/70 font-medium">Comments</th>
                    <th className="text-center py-3 px-2 text-white/70 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {existingData.map((item) => (
                    <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-2 text-white/80">
                        {item.week_label}
                      </td>
                      <td className="py-3 px-2 text-white/80">
                        {format(new Date(item.start_date), 'dd MMM yyyy')} - {format(new Date(item.end_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-3 px-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          item.platform === 'TIKTOK' ? 'bg-cyan-500/20 text-cyan-300' :
                          item.platform === 'YOUTUBE' ? 'bg-red-500/20 text-red-300' :
                          'bg-pink-500/20 text-pink-300'
                        }`}>
                          {item.platform}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-white/80 text-right">
                        {item.views.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-2 text-white/80 text-right">
                        {item.likes.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-2 text-white/80 text-right">
                        {item.comments.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-2 text-center">
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-red-400 hover:text-red-300 text-xs"
                        >
                          🗑️ Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
