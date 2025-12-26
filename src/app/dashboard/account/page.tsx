"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { FiLock, FiEye, FiEyeOff, FiCheckCircle, FiAlertCircle, FiUser, FiCamera, FiTrendingUp, FiUpload } from "react-icons/fi";
import { SiTiktok, SiInstagram } from "react-icons/si";
import { format, parseISO } from 'date-fns';
import { id as localeID } from 'date-fns/locale';

export default function AccountPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [profilePictureUrl, setProfilePictureUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [nextPwd, setNextPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myGroups, setMyGroups] = useState<Array<{id:string;name:string;start_date?:string|null;end_date?:string|null}>>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [tiktokUsernames, setTiktokUsernames] = useState<string[]>([]);
  const [instagramUsernames, setInstagramUsernames] = useState<string[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [newFullName, setNewFullName] = useState<string>("");

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setEmail(user.email);
      
      // Load complete profile with metrics
      const r = await fetch('/api/employee/profile', { cache: 'no-store' });
      const j = await r.json();
      if (r.ok) {
        setFullName(j.profile?.full_name || '');
        setNewFullName(j.profile?.full_name || '');
        setUsername(j.profile?.username || '');
        setProfilePictureUrl(j.profile?.profile_picture_url || '');
        setTiktokUsernames(j.profile?.tiktok_usernames || []);
        setInstagramUsernames(j.profile?.instagram_usernames || []);
        setMetrics(j.metrics);
        setMyGroups(j.groups || []);
      }
    } catch {}
  };

  const saveName = async () => {
    setSavingName(true); setError(null); setMessage(null);
    try {
      const res = await fetch('/api/employee/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: newFullName }) });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j?.error || 'Gagal menyimpan nama');
      setFullName(newFullName);
      setEditingName(false);
      setMessage('Nama berhasil diperbarui');
    } catch(e:any) {
      setError(String(e?.message||e));
    } finally { setSavingName(false); }
  }

  const strength = useMemo(() => {
    const s = nextPwd;
    let score = 0;
    if (s.length >= 6) score++;
    if (/[A-Z]/.test(s)) score++;
    if (/[a-z]/.test(s)) score++;
    if (/[0-9]/.test(s)) score++;
    if (/[^A-Za-z0-9]/.test(s)) score++;
    const labels = ["Sangat Lemah", "Lemah", "Cukup", "Bagus", "Kuat"];
    const colors = ["#ef4444", "#f59e0b", "#22c55e", "#22c55e", "#16a34a"];
    return { score, label: score ? labels[Math.min(score-1,4)] : "", color: colors[Math.min(score-1,4)] };
  }, [nextPwd]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null); setError(null);
    if (!nextPwd || nextPwd.length < 6) { setError("Password minimal 6 karakter"); return; }
    if (nextPwd !== confirm) { setError("Konfirmasi password tidak sama"); return; }
    setLoading(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password: nextPwd });
      if (updErr) throw updErr;
      setMessage("Password berhasil diubah");
      setNextPwd(""); setConfirm("");
    } catch (e: any) {
      setError(e?.message || "Gagal mengubah password");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfilePicture = async (file: File) => {
    setUploading(true);
    setMessage(null);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch('/api/employee/upload-profile-picture', {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Gagal upload gambar');
      }
      
      // Update immediately with the new URL from upload response
      setProfilePictureUrl(data.url);
      setMessage('Profile picture berhasil diperbarui');
      
      // Force reload to clear cache
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (e: any) {
      setError(e.message || 'Gagal upload profile picture');
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Ukuran file maksimal 5MB');
        return;
      }
      
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        setError('Format file harus JPEG, PNG, GIF, atau WebP');
        return;
      }
      
      handleUpdateProfilePicture(file);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-blue-500/15 border border-blue-400/20 text-blue-300">
            <FiUser size={18} />
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight bg-gradient-to-r from-blue-600 to-sky-500 dark:from-white dark:to-white/70 bg-clip-text text-transparent">Profil Saya</h1>
        </div>

        {/* Profile Picture & Basic Info */}
        <div className="glass rounded-2xl border border-white/10 mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-medium">Informasi Profil</h2>
          </div>
          <div className="p-5">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              {/* Profile Picture */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  {profilePictureUrl ? (
                    <img 
                      src={profilePictureUrl} 
                      alt="Profile" 
                      className="w-32 h-32 rounded-full object-cover border-2 border-white/20"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-sky-500 flex items-center justify-center border-2 border-white/20">
                      <FiUser size={48} className="text-white" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="absolute bottom-0 right-0 p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 border-2 border-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Upload foto profil"
                  >
                    {uploading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <FiUpload size={16} />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
                <p className="text-xs text-white/40 text-center max-w-[200px]">
                  Klik icon untuk upload foto<br/>
                  Max 5MB (JPG, PNG, GIF, WebP)
                </p>
              </div>

              {/* Basic Info */}
              <div className="flex-1">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-white/60 mb-1">Nama Lengkap</label>
                    {editingName ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white"
                          value={newFullName}
                          onChange={(e)=>setNewFullName(e.target.value)}
                          placeholder="Nama lengkap"
                        />
                        <button
                          onClick={saveName}
                          disabled={savingName || !newFullName.trim()}
                          className="px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-60"
                        >{savingName? 'Menyimpan…':'Simpan'}</button>
                        <button onClick={()=>{ setEditingName(false); setNewFullName(fullName||''); }} className="px-3 py-2 rounded-lg bg-white/10 text-white">Batal</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="text-white font-medium">{fullName || '-'}</div>
                        <button onClick={()=> setEditingName(true)} className="text-xs px-2 py-1 rounded-lg bg-white/10 text-white/80 hover:text-white">Edit</button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-white/60 mb-1">Username</label>
                    <div className="text-white">@{username || '-'}</div>
                  </div>
                  <div>
                    <label className="block text-sm text-white/60 mb-1">Email</label>
                    <div className="text-white">{email || '-'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Social Media Accounts */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <h3 className="text-white font-medium mb-3">Akun Media Sosial</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <SiTiktok className="text-white" size={16} />
                    <span className="text-sm text-white/70">TikTok</span>
                  </div>
                  {tiktokUsernames.length > 0 ? (
                    <div className="space-y-1">
                      {tiktokUsernames.map((u, i) => (
                        <div key={i} className="text-white text-sm">@{u}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-white/40 text-sm">Belum ada akun</div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <SiInstagram className="text-white" size={16} />
                    <span className="text-sm text-white/70">Instagram</span>
                  </div>
                  {instagramUsernames.length > 0 ? (
                    <div className="space-y-1">
                      {instagramUsernames.map((u, i) => (
                        <div key={i} className="text-white text-sm">@{u}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-white/40 text-sm">Belum ada akun</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Total Metrics */}
        {metrics && (
          <div className="glass rounded-2xl border border-white/10 mb-6 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
              <FiTrendingUp className="text-blue-400" />
              <h2 className="text-white font-medium">Total Performa</h2>
            </div>
            <div className="p-5">
              {/* Combined Totals */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-sky-500/10 border border-blue-400/20">
                  <div className="text-xs text-white/60 mb-1">Total Views</div>
                  <div className="text-2xl font-bold text-white">{formatNumber(metrics.total_views)}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-pink-500/10 to-rose-500/10 border border-pink-400/20">
                  <div className="text-xs text-white/60 mb-1">Total Likes</div>
                  <div className="text-2xl font-bold text-white">{formatNumber(metrics.total_likes)}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-violet-500/10 border border-purple-400/20">
                  <div className="text-xs text-white/60 mb-1">Total Comments</div>
                  <div className="text-2xl font-bold text-white">{formatNumber(metrics.total_comments)}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-400/20">
                  <div className="text-xs text-white/60 mb-1">Total Shares</div>
                  <div className="text-2xl font-bold text-white">{formatNumber(metrics.total_shares)}</div>
                </div>
              </div>

              {/* Platform Breakdown */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* TikTok */}
                <div className="p-4 rounded-xl border border-white/10 bg-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <SiTiktok className="text-white" size={20} />
                    <h3 className="text-white font-medium">TikTok</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/60">Views</span>
                      <span className="text-white font-medium">{formatNumber(metrics.tiktok_views)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Likes</span>
                      <span className="text-white font-medium">{formatNumber(metrics.tiktok_likes)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Comments</span>
                      <span className="text-white font-medium">{formatNumber(metrics.tiktok_comments)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Shares</span>
                      <span className="text-white font-medium">{formatNumber(metrics.tiktok_shares)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-white/10">
                      <span className="text-white/60">Followers</span>
                      <span className="text-white font-medium">{formatNumber(metrics.tiktok_followers)}</span>
                    </div>
                  </div>
                </div>

                {/* Instagram */}
                <div className="p-4 rounded-xl border border-white/10 bg-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <SiInstagram className="text-white" size={20} />
                    <h3 className="text-white font-medium">Instagram</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/60">Views</span>
                      <span className="text-white font-medium">{formatNumber(metrics.instagram_views)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Likes</span>
                      <span className="text-white font-medium">{formatNumber(metrics.instagram_likes)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Comments</span>
                      <span className="text-white font-medium">{formatNumber(metrics.instagram_comments)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Shares</span>
                      <span className="text-white font-medium">{formatNumber(metrics.instagram_shares)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-white/10">
                      <span className="text-white/60">Followers</span>
                      <span className="text-white font-medium">{formatNumber(metrics.instagram_followers)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {metrics.last_updated && (
                <div className="mt-4 text-xs text-white/40 text-center">
                  Terakhir diperbarui: {format(parseISO(metrics.last_updated), 'd MMM yyyy HH:mm', { locale: localeID })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Change Password */}
        <div className="glass rounded-2xl border border-white/10 mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h2 className="text-white font-medium">Ubah Password</h2>
              <p className="text-white/60 text-xs">Pastikan password kuat dan unik.</p>
            </div>
          </div>
          <div className="p-5">
            {message && (
              <div className="mb-4 flex items-center gap-2 text-green-300 bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                <FiCheckCircle /> <span>{message}</span>
              </div>
            )}
            {error && (
              <div className="mb-4 flex items-center gap-2 text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <FiAlertCircle /> <span>{error}</span>
              </div>
            )}
            <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-sm text-white/70 mb-1">Email</label>
                <input value={email} readOnly className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white opacity-70" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">Password baru</label>
                <div className="relative">
                  <input type={showNew?"text":"password"} value={nextPwd} onChange={(e)=>setNextPwd(e.target.value)} className="w-full pr-10 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white" minLength={6} placeholder="Minimal 6 karakter" />
                  <button type="button" onClick={()=>setShowNew(v=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white">
                    {showNew ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                {nextPwd && (
                  <div className="mt-2">
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full" style={{ width: `${(strength.score/5)*100}%`, background: strength.color }} />
                    </div>
                    <p className="text-xs text-white/60 mt-1">Kekuatan: <span style={{ color: strength.color }}>{strength.label}</span></p>
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-white/70 mb-1">Konfirmasi password baru</label>
                <div className="relative">
                  <input type={showConf?"text":"password"} value={confirm} onChange={(e)=>setConfirm(e.target.value)} className="w-full pr-10 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white" minLength={6} placeholder="Ulangi password baru" />
                  <button type="button" onClick={()=>setShowConf(v=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white">
                    {showConf ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                {confirm && nextPwd !== confirm && (
                  <p className="text-xs text-red-300 mt-1">Konfirmasi tidak cocok.</p>
                )}
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button type="submit" disabled={loading || !nextPwd || !confirm} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white disabled:opacity-60">
                {loading && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}<span>Ubah Password</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* My Groups */}
      <div className="glass rounded-2xl border border-white/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10"><h2 className="text-white font-medium">Group Saya</h2></div>
        <div className="p-5">
          {myGroups.length === 0 ? (
            <div className="text-white/60 text-sm">Belum tergabung ke Group manapun.</div>
          ) : (
            <ul className="space-y-2">
              {myGroups.map(g => (
                <li key={g.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-white/10 bg-white/5">
                  <div className="text-white">{g.name}</div>
                  {(g.start_date) && (
                    <div className="text-xs text-white/60">
                      {format(parseISO(g.start_date as string), 'd MMM yyyy', { locale: localeID })}
                      {g.end_date ? ` — ${format(parseISO(g.end_date as string), 'd MMM yyyy', { locale: localeID })}` : ''}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
