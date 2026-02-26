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

// GET: Get posts count per day based on taken_at
export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start') || '2026-01-01'; // Default: 1 Januari 2026
    const endDate = searchParams.get('end') || new Date().toISOString().slice(0, 10); // Default: hari ini
    const campaignId = searchParams.get('campaign_id') || '';
    const platform = (searchParams.get('platform') || 'all').toLowerCase();

    // Get all employees (karyawan) or campaign-specific employees
    let employeeIds: string[] = [];
    let requiredHashtags: string[] | null = null;

    if (campaignId) {
      // Get employees from campaign
      const { data: employees } = await supabase
        .from('employee_groups')
        .select('employee_id')
        .eq('campaign_id', campaignId);
      employeeIds = (employees || []).map((e: any) => e.employee_id);
      
      // Get campaign hashtags
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('required_hashtags')
        .eq('id', campaignId)
        .single();
      requiredHashtags = (campaign as any)?.required_hashtags || null;
    } else {
      // All employees
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

    // Get YouTube channel IDs (from user_youtube_channels)
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

    // Query TikTok posts - count each video only on its FIRST snapshot date
    if ((platform === 'all' || platform === 'tiktok') && tiktokUsernames.size > 0) {
      const { data: ttPosts } = await supabase
        .from('tiktok_posts_daily')
        .select('video_id, username, taken_at, title')
        .in('username', Array.from(tiktokUsernames))
        .gte('taken_at', startDate + 'T00:00:00Z')
        .lte('taken_at', endDate + 'T23:59:59Z')
        .order('taken_at', { ascending: true });

      // Find earliest date per video_id, then count per date
      const videoFirstDate = new Map<string, { date: string; title: string | null }>();
      for (const row of ttPosts || []) {
        const vid = String(row.video_id);
        if (videoFirstDate.has(vid)) continue; // already saw this video earlier
        const date = new Date(row.taken_at).toISOString().slice(0, 10);
        videoFirstDate.set(vid, { date, title: row.title });
      }

      // Group by first-seen date, count unique videos
      const videosByDate = new Map<string, Set<string>>();
      for (const [vid, info] of videoFirstDate.entries()) {
        // Apply hashtag filter
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag(info.title, requiredHashtags)) continue;
        }
        if (!videosByDate.has(info.date)) videosByDate.set(info.date, new Set());
        videosByDate.get(info.date)!.add(vid);
      }

      // Add to postsByDate
      for (const [date, videos] of videosByDate.entries()) {
        const entry = postsByDate.get(date) || { tiktok: 0, instagram: 0, youtube: 0, total: 0 };
        entry.tiktok = videos.size;
        entry.total += videos.size;
        postsByDate.set(date, entry);
      }
    }

    // Query Instagram posts - count each post only on its FIRST snapshot date
    if ((platform === 'all' || platform === 'instagram') && instagramUsernames.size > 0) {
      const { data: igPosts } = await supabase
        .from('instagram_posts_daily')
        .select('id, username, taken_at, caption')
        .in('username', Array.from(instagramUsernames))
        .gte('taken_at', startDate + 'T00:00:00Z')
        .lte('taken_at', endDate + 'T23:59:59Z')
        .order('taken_at', { ascending: true });

      // Find earliest date per post id
      const postFirstDate = new Map<string, { date: string; caption: string | null }>();
      for (const row of igPosts || []) {
        const pid = String((row as any).id);
        if (postFirstDate.has(pid)) continue;
        const date = new Date((row as any).taken_at).toISOString().slice(0, 10);
        postFirstDate.set(pid, { date, caption: (row as any).caption });
      }

      // Group by first-seen date
      const postIdsByDate = new Map<string, Set<string>>();
      for (const [pid, info] of postFirstDate.entries()) {
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag(info.caption, requiredHashtags)) continue;
        }
        if (!postIdsByDate.has(info.date)) postIdsByDate.set(info.date, new Set());
        postIdsByDate.get(info.date)!.add(pid);
      }

      // Add to postsByDate
      for (const [date, posts] of postIdsByDate.entries()) {
        const entry = postsByDate.get(date) || { tiktok: 0, instagram: 0, youtube: 0, total: 0 };
        entry.instagram = posts.size;
        entry.total += posts.size;
        postsByDate.set(date, entry);
      }
    }

    // Query YouTube posts - count each video only on its FIRST snapshot date
    if ((platform === 'all' || platform === 'youtube') && youtubeChannels.size > 0) {
      const { data: ytPosts } = await supabase
        .from('youtube_posts_daily')
        .select('video_id, channel_id, post_date, title')
        .in('channel_id', Array.from(youtubeChannels))
        .gte('post_date', startDate)
        .lte('post_date', endDate)
        .order('post_date', { ascending: true });

      // Find earliest date per video_id
      const ytFirstDate = new Map<string, { date: string; title: string | null }>();
      for (const row of ytPosts || []) {
        const vid = String((row as any).video_id);
        if (ytFirstDate.has(vid)) continue;
        const date = String((row as any).post_date).slice(0, 10);
        ytFirstDate.set(vid, { date, title: (row as any).title });
      }

      // Group by first-seen date
      const ytVideosByDate = new Map<string, Set<string>>();
      for (const [vid, info] of ytFirstDate.entries()) {
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag(String(info.title || ''), requiredHashtags)) continue;
        }
        if (!ytVideosByDate.has(info.date)) ytVideosByDate.set(info.date, new Set());
        ytVideosByDate.get(info.date)!.add(vid);
      }

      // Add to postsByDate
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
