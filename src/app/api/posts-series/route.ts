import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasRequiredHashtag } from '@/lib/hashtag-filter';

export const dynamic = 'force-dynamic';

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET: Get posts count per day based on taken_at (with fallbacks)
export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start') || '2026-01-01';
    const endDate = searchParams.get('end') || new Date().toISOString().slice(0, 10);
    const campaignId = searchParams.get('campaign_id') || '';
    const platform = (searchParams.get('platform') || 'all').toLowerCase();

    // Get all employees (karyawan) or campaign-specific employees
    let employeeIds: string[] = [];
    let requiredHashtags: string[] | null = null;

    if (campaignId) {
      const { data: employees } = await supabase
        .from('employee_groups')
        .select('employee_id')
        .eq('campaign_id', campaignId);
      employeeIds = (employees || []).map((e: any) => e.employee_id);

      const { data: campaign } = await supabase
        .from('campaigns')
        .select('required_hashtags')
        .eq('id', campaignId)
        .single();
      requiredHashtags = (campaign as any)?.required_hashtags || null;
    } else {
      const { data: emps } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'karyawan');
      employeeIds = (emps || []).map((r: any) => String(r.id));
    }

    if (employeeIds.length === 0) {
      return NextResponse.json({ series: [], total: 0 });
    }

    // Get usernames for employees
    const { data: users } = await supabase
      .from('users')
      .select('id, tiktok_username, instagram_username')
      .in('id', employeeIds);

    // Get TikTok usernames (from users + employee_participants)
    const tiktokUsernames = new Set<string>();
    for (const u of users || []) {
      if (u.tiktok_username) {
        tiktokUsernames.add(u.tiktok_username.toLowerCase().replace(/^@+/, ''));
      }
    }

    const { data: ttParticipants } = await supabase
      .from('employee_participants')
      .select('tiktok_username')
      .in('employee_id', employeeIds);
    for (const p of ttParticipants || []) {
      if ((p as any).tiktok_username) {
        tiktokUsernames.add((p as any).tiktok_username.toLowerCase().replace(/^@+/, ''));
      }
    }

    // Get Instagram usernames (from users + employee_instagram_participants)
    const instagramUsernames = new Set<string>();
    for (const u of users || []) {
      if (u.instagram_username) {
        instagramUsernames.add(u.instagram_username.toLowerCase().replace(/^@+/, ''));
      }
    }

    const { data: igParticipants } = await supabase
      .from('employee_instagram_participants')
      .select('instagram_username')
      .in('employee_id', employeeIds);
    for (const p of igParticipants || []) {
      if (p.instagram_username) {
        instagramUsernames.add(p.instagram_username.toLowerCase().replace(/^@+/, ''));
      }
    }

    // Get YouTube channel IDs (from user_youtube_channels) - only for employees
    const youtubeChannels = new Set<string>();
    const { data: ytChannelRows } = await supabase
      .from('user_youtube_channels')
      .select('youtube_channel_id')
      .in('user_id', employeeIds);
    for (const r of ytChannelRows || []) {
      const chId = String((r as any).youtube_channel_id || '');
      if (chId) youtubeChannels.add(chId);
    }

    // Count posts per date
    const postsByDate = new Map<string, { tiktok: number; instagram: number; youtube: number; total: number }>();

    // Initialize dates in range
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      postsByDate.set(dateStr, { tiktok: 0, instagram: 0, youtube: 0, total: 0 });
    }

    // ─── TikTok ───
    // tiktok_posts_daily has video_id as PK (one row per video), taken_at is always set
    if ((platform === 'all' || platform === 'tiktok') && tiktokUsernames.size > 0) {
      const { data: ttPosts } = await supabase
        .from('tiktok_posts_daily')
        .select('video_id, username, taken_at, title')
        .in('username', Array.from(tiktokUsernames))
        .gte('taken_at', startDate + 'T00:00:00Z')
        .lte('taken_at', endDate + 'T23:59:59Z')
        .order('taken_at', { ascending: true })
        .limit(50000);

      const videoFirstDate = new Map<string, { date: string; title: string | null }>();
      for (const row of ttPosts || []) {
        const vid = String(row.video_id);
        if (videoFirstDate.has(vid)) continue;
        const date = new Date(row.taken_at).toISOString().slice(0, 10);
        videoFirstDate.set(vid, { date, title: row.title });
      }

      const videosByDate = new Map<string, Set<string>>();
      for (const [vid, info] of videoFirstDate.entries()) {
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag(info.title, requiredHashtags)) continue;
        }
        if (!videosByDate.has(info.date)) videosByDate.set(info.date, new Set());
        videosByDate.get(info.date)!.add(vid);
      }

      for (const [date, videos] of videosByDate.entries()) {
        const entry = postsByDate.get(date) || { tiktok: 0, instagram: 0, youtube: 0, total: 0 };
        entry.tiktok = videos.size;
        entry.total += videos.size;
        postsByDate.set(date, entry);
      }
    }

    // ─── Instagram ───
    // instagram_posts_daily has id as PK (one row per post)
    // BUG FIX: taken_at can be NULL when aggregator doesn't return timestamps.
    // Use two queries: one for posts with taken_at, one for posts without (fallback to created_at).
    if ((platform === 'all' || platform === 'instagram') && instagramUsernames.size > 0) {
      const igUsernamesArr = Array.from(instagramUsernames);
      const postFirstDate = new Map<string, { date: string; caption: string | null }>();

      // Query 1: Posts WITH taken_at (use taken_at for date)
      const { data: igPostsWithDate } = await supabase
        .from('instagram_posts_daily')
        .select('id, username, taken_at, caption')
        .in('username', igUsernamesArr)
        .not('taken_at', 'is', null)
        .gte('taken_at', startDate + 'T00:00:00Z')
        .lte('taken_at', endDate + 'T23:59:59Z')
        .order('taken_at', { ascending: true })
        .limit(50000);

      for (const row of igPostsWithDate || []) {
        const pid = String((row as any).id);
        if (postFirstDate.has(pid)) continue;
        const date = new Date((row as any).taken_at).toISOString().slice(0, 10);
        postFirstDate.set(pid, { date, caption: (row as any).caption });
      }

      // Query 2: Posts WITHOUT taken_at (fallback to created_at)
      const { data: igPostsNoDate } = await supabase
        .from('instagram_posts_daily')
        .select('id, username, caption, created_at')
        .in('username', igUsernamesArr)
        .is('taken_at', null)
        .gte('created_at', startDate + 'T00:00:00Z')
        .lte('created_at', endDate + 'T23:59:59Z')
        .order('created_at', { ascending: true })
        .limit(50000);

      for (const row of igPostsNoDate || []) {
        const pid = String((row as any).id);
        if (postFirstDate.has(pid)) continue; // already counted from query 1
        const date = new Date((row as any).created_at).toISOString().slice(0, 10);
        postFirstDate.set(pid, { date, caption: (row as any).caption });
      }

      console.log(`[posts-series] Instagram: ${(igPostsWithDate||[]).length} with taken_at, ${(igPostsNoDate||[]).length} without (using created_at)`);

      // Group by date, apply hashtag filter
      const postIdsByDate = new Map<string, Set<string>>();
      for (const [pid, info] of postFirstDate.entries()) {
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag(info.caption, requiredHashtags)) continue;
        }
        // Only count if date falls within requested range
        if (info.date < startDate || info.date > endDate) continue;
        if (!postIdsByDate.has(info.date)) postIdsByDate.set(info.date, new Set());
        postIdsByDate.get(info.date)!.add(pid);
      }

      for (const [date, posts] of postIdsByDate.entries()) {
        const entry = postsByDate.get(date) || { tiktok: 0, instagram: 0, youtube: 0, total: 0 };
        entry.instagram = posts.size;
        entry.total += posts.size;
        postsByDate.set(date, entry);
      }
    }

    // ─── YouTube ───
    // youtube_posts_daily has composite PK (id=user_id, video_id) - multiple rows per video.
    // Dedup by video_id to count unique videos only.
    if ((platform === 'all' || platform === 'youtube') && youtubeChannels.size > 0) {
      const { data: ytPosts } = await supabase
        .from('youtube_posts_daily')
        .select('video_id, channel_id, post_date, title')
        .in('channel_id', Array.from(youtubeChannels))
        .gte('post_date', startDate)
        .lte('post_date', endDate)
        .order('post_date', { ascending: true })
        .limit(50000);

      // Dedup by video_id - keep earliest post_date per unique video
      const ytFirstDate = new Map<string, { date: string; title: string | null }>();
      for (const row of ytPosts || []) {
        const vid = String((row as any).video_id);
        if (!vid) continue;
        const date = String((row as any).post_date).slice(0, 10);
        const existing = ytFirstDate.get(vid);
        if (!existing || date < existing.date) {
          ytFirstDate.set(vid, { date, title: (row as any).title });
        }
      }

      console.log(`[posts-series] YouTube: ${(ytPosts||[]).length} rows → ${ytFirstDate.size} unique videos`);

      // Group by date, apply hashtag filter
      const ytVideosByDate = new Map<string, Set<string>>();
      for (const [vid, info] of ytFirstDate.entries()) {
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag(String(info.title || ''), requiredHashtags)) continue;
        }
        if (!ytVideosByDate.has(info.date)) ytVideosByDate.set(info.date, new Set());
        ytVideosByDate.get(info.date)!.add(vid);
      }

      for (const [date, videos] of ytVideosByDate.entries()) {
        const entry = postsByDate.get(date) || { tiktok: 0, instagram: 0, youtube: 0, total: 0 };
        entry.youtube = videos.size;
        entry.total += videos.size;
        postsByDate.set(date, entry);
      }
    }

    // Convert to array sorted by date
    const series = Array.from(postsByDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, counts]) => ({
        date,
        posts: counts.total,
        posts_tiktok: counts.tiktok,
        posts_instagram: counts.instagram,
        posts_youtube: counts.youtube
      }));

    const total = series.reduce((sum, s) => sum + s.posts, 0);

    return NextResponse.json({
      series,
      total,
      start: startDate,
      end: endDate,
      platform
    });
  } catch (e: any) {
    console.error('[posts-series] error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
