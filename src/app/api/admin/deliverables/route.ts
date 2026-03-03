import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  // Auth: admin only
  const supabaseSSR = await createSSR();
  const { data: { user } } = await supabaseSSR.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: me } = await supabaseSSR.from('users').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin' && me?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const url = new URL(req.url);
  const start = url.searchParams.get('start') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10);

  // Fetch all employees with role 'karyawan'
  const { data: employees } = await supa
    .from('users')
    .select('id, full_name, tiktok_username, instagram_username, youtube_channel_id, extra_instagram_usernames')
    .eq('role', 'karyawan')
    .order('full_name', { ascending: true });

  if (!employees?.length) return NextResponse.json({ data: [] });

  const empIds = employees.map(e => e.id);

  // Resolve all TikTok usernames per employee (additive)
  const { data: ttAliases } = await supa.from('user_tiktok_usernames').select('user_id, tiktok_username').in('user_id', empIds);
  const empTT = new Map<string, Set<string>>();
  for (const e of employees) {
    const set = new Set<string>();
    if (e.tiktok_username) set.add(String(e.tiktok_username).replace(/^@+/, '').toLowerCase());
    empTT.set(e.id, set);
  }
  for (const r of ttAliases || []) {
    const u = String(r.tiktok_username || '').replace(/^@+/, '').toLowerCase();
    if (u) { const set = empTT.get(r.user_id) || new Set(); set.add(u); empTT.set(r.user_id, set); }
  }

  // Resolve all Instagram usernames per employee (additive)
  const { data: igAliases } = await supa.from('user_instagram_usernames').select('user_id, instagram_username').in('user_id', empIds);
  const empIG = new Map<string, Set<string>>();
  for (const e of employees) {
    const set = new Set<string>();
    if (e.instagram_username) set.add(String(e.instagram_username).replace(/^@+/, '').toLowerCase());
    if (Array.isArray((e as any).extra_instagram_usernames)) {
      for (const u of (e as any).extra_instagram_usernames) if (u) set.add(String(u).replace(/^@+/, '').toLowerCase());
    }
    empIG.set(e.id, set);
  }
  for (const r of igAliases || []) {
    const u = String(r.instagram_username || '').replace(/^@+/, '').toLowerCase();
    if (u) { const set = empIG.get(r.user_id) || new Set(); set.add(u); empIG.set(r.user_id, set); }
  }

  // Resolve all YouTube channels per employee (additive)
  const { data: ytAliases } = await supa.from('user_youtube_channels').select('user_id, youtube_channel_id').in('user_id', empIds);
  const empYT = new Map<string, Set<string>>();
  for (const e of employees) {
    const set = new Set<string>();
    if (e.youtube_channel_id) set.add(String(e.youtube_channel_id).trim());
    empYT.set(e.id, set);
  }
  for (const r of ytAliases || []) {
    const ch = String(r.youtube_channel_id || '').trim();
    if (ch) { const set = empYT.get(r.user_id) || new Set(); set.add(ch); empYT.set(r.user_id, set); }
  }

  // Collect all usernames we need to query
  const allTT = new Set<string>();
  const allIG = new Set<string>();
  const allYT = new Set<string>();
  for (const s of empTT.values()) for (const u of s) allTT.add(u);
  for (const s of empIG.values()) for (const u of s) allIG.add(u);
  for (const s of empYT.values()) for (const u of s) allYT.add(u);

  // Fetch TikTok posts (dedupe by video_id)
  const ttPostsByUsername = new Map<string, number>();
  if (allTT.size > 0) {
    const { data: ttPosts } = await supa
      .from('tiktok_posts_daily')
      .select('video_id, username')
      .in('username', Array.from(allTT))
      .gte('taken_at', start + 'T00:00:00Z')
      .lte('taken_at', end + 'T23:59:59Z')
      .limit(50000);
    const seen = new Set<string>();
    for (const r of ttPosts || []) {
      const vid = String(r.video_id || '');
      if (!vid || seen.has(vid)) continue;
      seen.add(vid);
      const u = String(r.username || '').toLowerCase();
      ttPostsByUsername.set(u, (ttPostsByUsername.get(u) || 0) + 1);
    }
  }

  // Fetch Instagram posts (dedupe by id/code)
  const igPostsByUsername = new Map<string, number>();
  if (allIG.size > 0) {
    const { data: igPosts } = await supa
      .from('instagram_posts_daily')
      .select('id, code, username')
      .in('username', Array.from(allIG))
      .gte('taken_at', start + 'T00:00:00Z')
      .lte('taken_at', end + 'T23:59:59Z')
      .limit(50000);
    const seen = new Set<string>();
    for (const r of igPosts || []) {
      const vid = String((r as any).id || (r as any).code || '');
      if (!vid || seen.has(vid)) continue;
      seen.add(vid);
      const u = String(r.username || '').toLowerCase();
      igPostsByUsername.set(u, (igPostsByUsername.get(u) || 0) + 1);
    }
  }

  // Fetch YouTube posts (dedupe by video_id)
  const ytPostsByChannel = new Map<string, number>();
  if (allYT.size > 0) {
    const { data: ytPosts } = await supa
      .from('youtube_posts_daily')
      .select('video_id, channel_id')
      .in('channel_id', Array.from(allYT))
      .gte('post_date', start)
      .lte('post_date', end)
      .limit(50000);
    const seen = new Set<string>();
    for (const r of ytPosts || []) {
      const vid = String(r.video_id || '');
      if (!vid || seen.has(vid)) continue;
      seen.add(vid);
      const ch = String(r.channel_id || '').trim();
      ytPostsByChannel.set(ch, (ytPostsByChannel.get(ch) || 0) + 1);
    }
  }

  // Aggregate per employee
  const data: { name: string; tiktok: number; instagram: number; youtube: number }[] = [];
  for (const e of employees) {
    let tiktok = 0;
    for (const u of empTT.get(e.id) || []) tiktok += ttPostsByUsername.get(u) || 0;
    let instagram = 0;
    for (const u of empIG.get(e.id) || []) instagram += igPostsByUsername.get(u) || 0;
    let youtube = 0;
    for (const ch of empYT.get(e.id) || []) youtube += ytPostsByChannel.get(ch) || 0;
    data.push({ name: e.full_name || e.id, tiktok, instagram, youtube });
  }

  // Sort by total desc
  data.sort((a, b) => (b.tiktok + b.instagram + b.youtube) - (a.tiktok + a.instagram + a.youtube));

  return NextResponse.json({ data });
}
