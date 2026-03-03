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

  // Fetch all employees (karyawan + leader) - use select('*') to avoid column name issues
  const { data: employees, error: empError } = await supa
    .from('users')
    .select('*')
    .in('role', ['karyawan', 'leader'])
    .order('full_name', { ascending: true });

  if (empError) return NextResponse.json({ data: [], _error: empError.message });
  if (!employees?.length) return NextResponse.json({ data: [], _error: 'no employees found' });

  const empIds = employees.map(e => e.id);

  // Source 1: profile usernames from users table
  const empTT = new Map<string, Set<string>>();
  const empIG = new Map<string, Set<string>>();
  const empYT = new Map<string, Set<string>>();
  for (const e of employees) {
    const ttSet = new Set<string>();
    if (e.tiktok_username) ttSet.add(String(e.tiktok_username).replace(/^@+/, '').toLowerCase());
    empTT.set(e.id, ttSet);
    const igSet = new Set<string>();
    if (e.instagram_username) igSet.add(String(e.instagram_username).replace(/^@+/, '').toLowerCase());
    empIG.set(e.id, igSet);
    const ytSet = new Set<string>();
    if (e.youtube_channel_id) ytSet.add(String(e.youtube_channel_id).trim());
    empYT.set(e.id, ytSet);
  }

  // Source 2: alias tables (user_tiktok_usernames, user_instagram_usernames, user_youtube_channels)
  const [{ data: ttAliases }, { data: igAliases }, { data: ytAliases }] = await Promise.all([
    supa.from('user_tiktok_usernames').select('user_id, tiktok_username').in('user_id', empIds),
    supa.from('user_instagram_usernames').select('user_id, instagram_username').in('user_id', empIds),
    supa.from('user_youtube_channels').select('user_id, youtube_channel_id').in('user_id', empIds),
  ]);
  for (const r of ttAliases || []) {
    const u = String(r.tiktok_username || '').replace(/^@+/, '').toLowerCase();
    if (u) { const s = empTT.get(r.user_id) || new Set(); s.add(u); empTT.set(r.user_id, s); }
  }
  for (const r of igAliases || []) {
    const u = String(r.instagram_username || '').replace(/^@+/, '').toLowerCase();
    if (u) { const s = empIG.get(r.user_id) || new Set(); s.add(u); empIG.set(r.user_id, s); }
  }
  for (const r of ytAliases || []) {
    const ch = String(r.youtube_channel_id || '').trim();
    if (ch) { const s = empYT.get(r.user_id) || new Set(); s.add(ch); empYT.set(r.user_id, s); }
  }

  // Source 3: campaign-specific assignments (each wrapped individually to prevent crashes)
  try {
    const { data: campTT } = await supa.from('employee_participants').select('employee_id, tiktok_username').in('employee_id', empIds);
    for (const r of campTT || []) {
      const u = String(r.tiktok_username || '').replace(/^@+/, '').toLowerCase();
      if (u) { const s = empTT.get(r.employee_id) || new Set(); s.add(u); empTT.set(r.employee_id, s); }
    }
  } catch (e) { console.error('[deliverables] employee_participants error', e); }
  try {
    const { data: campIG } = await supa.from('employee_instagram_participants').select('employee_id, instagram_username').in('employee_id', empIds);
    for (const r of campIG || []) {
      const u = String((r as any).instagram_username || '').replace(/^@+/, '').toLowerCase();
      if (u) { const s = empIG.get((r as any).employee_id) || new Set(); s.add(u); empIG.set((r as any).employee_id, s); }
    }
  } catch (e) { console.error('[deliverables] employee_instagram_participants error', e); }
  try {
    const { data: campYT } = await supa.from('employee_youtube_participants').select('employee_id, youtube_channel_id').in('employee_id', empIds);
    for (const r of campYT || []) {
      const ch = String((r as any).youtube_channel_id || '').trim();
      if (ch) { const s = empYT.get((r as any).employee_id) || new Set(); s.add(ch); empYT.set((r as any).employee_id, s); }
    }
  } catch (e) { /* table may not exist */ }

  // Collect all usernames we need to query
  const allTT = new Set<string>();
  const allIG = new Set<string>();
  const allYT = new Set<string>();
  for (const s of empTT.values()) for (const u of s) allTT.add(u);
  for (const s of empIG.values()) for (const u of s) allIG.add(u);
  for (const s of empYT.values()) for (const u of s) allYT.add(u);

  // Fetch TikTok posts (dedupe by video_id)
  // Use both taken_at and post_date to cover all posts (some may have NULL taken_at)
  const ttPostsByUsername = new Map<string, number>();
  if (allTT.size > 0) {
    const ttArr = Array.from(allTT);
    const { data: ttPosts1 } = await supa
      .from('tiktok_posts_daily')
      .select('video_id, username')
      .in('username', ttArr)
      .gte('taken_at', start + 'T00:00:00Z')
      .lte('taken_at', end + 'T23:59:59Z')
      .limit(50000);
    const { data: ttPosts2 } = await supa
      .from('tiktok_posts_daily')
      .select('video_id, username')
      .in('username', ttArr)
      .is('taken_at', null)
      .gte('post_date', start)
      .lte('post_date', end)
      .limit(50000);
    const seen = new Set<string>();
    for (const r of [...(ttPosts1 || []), ...(ttPosts2 || [])]) {
      const vid = String(r.video_id || '');
      if (!vid || seen.has(vid)) continue;
      seen.add(vid);
      const u = String(r.username || '').toLowerCase();
      ttPostsByUsername.set(u, (ttPostsByUsername.get(u) || 0) + 1);
    }
  }

  // Fetch Instagram posts (dedupe by id/code)
  // Use both taken_at and post_date fallback
  const igPostsByUsername = new Map<string, number>();
  if (allIG.size > 0) {
    const igArr = Array.from(allIG);
    const { data: igPosts1 } = await supa
      .from('instagram_posts_daily')
      .select('id, code, username')
      .in('username', igArr)
      .gte('taken_at', start + 'T00:00:00Z')
      .lte('taken_at', end + 'T23:59:59Z')
      .limit(50000);
    const { data: igPosts2 } = await supa
      .from('instagram_posts_daily')
      .select('id, code, username')
      .in('username', igArr)
      .is('taken_at', null)
      .gte('post_date', start)
      .lte('post_date', end)
      .limit(50000);
    const seen = new Set<string>();
    for (const r of [...(igPosts1 || []), ...(igPosts2 || [])]) {
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

  return NextResponse.json({
    data,
    _debug: { employees: employees.length, ttUsernames: allTT.size, igUsernames: allIG.size, ytChannels: allYT.size, ttPosts: Array.from(ttPostsByUsername.values()).reduce((a,b)=>a+b,0), igPosts: Array.from(igPostsByUsername.values()).reduce((a,b)=>a+b,0), ytPosts: Array.from(ytPostsByChannel.values()).reduce((a,b)=>a+b,0), start, end }
  });
}
