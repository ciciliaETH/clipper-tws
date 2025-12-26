import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for Vercel

// Admin client for database operations
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Simple in-memory cache + retry helper
const _cache = new Map<string, { expires: number; value: any }>();
function getCached(key: string) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _cache.delete(key); return null; }
  return entry.value;
}
function setCached(key: string, value: any, ttlMs = 60_000) { _cache.set(key, { value, expires: Date.now() + ttlMs }); }
async function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }
async function retryFetchJson(url: string, opts: RequestInit = {}, retries = 3, ttlMs = 60_000) {
  const key = `${url}|${opts.method || 'GET'}`;
  const cached = getCached(key);
  if (cached) return cached;
  let lastErr: any = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      if (!res.ok) {
        if (res.status >= 500 && i < retries - 1) { await delay(200 * Math.pow(2, i)); continue; }
        throw new Error(`HTTP ${res.status} ${res.statusText} - ${text.slice(0,200)}`);
      }
      const json = JSON.parse(text);
      setCached(key, json, ttlMs);
      return json;
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await delay(200 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

// Fetch TikTok data from external API
async function fetchTikTokPosts(username: string, count: number = 10) {
  const apiUrl = `http://202.10.44.90/api/v1/user/posts?username=${username}&count=${count}`;
  let data: any;
  try {
    data = await retryFetchJson(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      cache: 'no-store'
    }, 3, 30_000);
  } catch (err: any) {
    const msg = (err && typeof err === 'object' && 'message' in err) ? (err as any).message : String(err)
    throw new Error(`API returned error: ${msg}`);
  }

    // If returned videos exist, enrich incomplete items using TikWM
    const videos = data?.data?.videos || [];
    if (videos.length > 0) {
      const enriched = await Promise.all(videos.map(async (v: any) => {
        const hasCore = v.play && v.play_count && v.aweme_id;
        if (hasCore) return v;

        const vid = v.aweme_id || v.video_id;
        if (!vid) return v;
        const videoUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(vid)}`;
        try {
          const tikwmJson = await retryFetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, { headers: { 'Accept': 'application/json' } }, 2, 5 * 60_000).catch(() => null);
          if (!tikwmJson || tikwmJson.code !== 0) return v;

          const info = tikwmJson.data || {};
          return {
            ...v,
            play: v.play || info.play || v.play,
            play_count: v.play_count || info.play_count || info.views || v.play_count,
            digg_count: v.digg_count || info.like_count || v.digg_count,
            comment_count: v.comment_count || info.comment_count || v.comment_count,
            share_count: v.share_count || info.share_count || v.share_count,
            cover: v.cover || info.cover || v.cover,
          };
        } catch (e) {
          return v;
        }
      }));

      data.data.videos = enriched;
    }

    return data;
}

// Save metrics to Supabase (align columns + write snapshots for accrual)
async function saveMetricsToSupabase(username: string, data: any) {
  const supabase = adminClient();

  if (!data?.data?.videos || !Array.isArray(data.data.videos) || data.data.videos.length === 0) {
    return { success: false, error: 'No videos found' };
  }

  const videos = data.data.videos as any[];

  // Calculate totals from all fetched videos
  const totals = videos.reduce(
    (acc: any, v: any) => ({
      views: acc.views + (Number(v.play_count || 0) || 0),
      likes: acc.likes + (Number(v.digg_count || v.like_count || 0) || 0),
      comments: acc.comments + (Number(v.comment_count || 0) || 0),
      shares: acc.shares + (Number(v.share_count || 0) || 0),
      saves: acc.saves + (Number(v.collect_count || v.save_count || 0) || 0),
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
  );

  // Update lightweight user rollups (optional; not used by accrual)
  try {
    const latest = videos[0] || {};
    await supabase
      .from('users')
      .upsert(
        {
          tiktok_username: username,
          tiktok_followers: Number(latest?.author?.followers || latest?.authorStats?.followerCount || 0) || 0,
          tiktok_views: totals.views,
          tiktok_likes: totals.likes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tiktok_username', ignoreDuplicates: false }
      );
  } catch {}

  // Upsert per-post rows into tiktok_posts_daily with correct schema
  const postsToInsert = videos
    .map((video: any) => {
      const vid = video.aweme_id || video.video_id || video.id;
      const created = Number(video.create_time || video.createTime || 0);
      if (!vid || !created) return null;
      const post_date = new Date(created * 1000).toISOString().slice(0, 10);
      return {
        username,
        video_id: String(vid),
        post_date,
        play_count: Number(video.play_count || 0) || 0,
        digg_count: Number(video.digg_count || video.like_count || 0) || 0,
        comment_count: Number(video.comment_count || 0) || 0,
        share_count: Number(video.share_count || 0) || 0,
        save_count: Number(video.collect_count || video.save_count || 0) || 0,
      };
    })
    .filter(Boolean) as any[];

  if (postsToInsert.length) {
    await supabase
      .from('tiktok_posts_daily')
      .upsert(postsToInsert, { onConflict: 'video_id', ignoreDuplicates: true });
  }

  // Resolve owning user_id(s) for this username to write accrual snapshots
  const ownerIds = new Set<string>();
  try {
    const { data: primary } = await supabase
      .from('users')
      .select('id')
      .eq('tiktok_username', username)
      .maybeSingle();
    if (primary?.id) ownerIds.add(String(primary.id));
  } catch {}
  try {
    const { data: extra } = await supabase
      .from('user_tiktok_usernames')
      .select('user_id')
      .eq('tiktok_username', username);
    for (const r of extra || []) ownerIds.add(String((r as any).user_id));
  } catch {}

  const nowIso = new Date().toISOString();
  const windowDays = 60;
  const start = new Date(); start.setUTCDate(start.getUTCDate() - windowDays + 1);
  const startISO = start.toISOString().slice(0,10);
  for (const id of ownerIds) {
    try {
      // Aggregate from DB across all handles linked to this user
      const handles = new Set<string>();
      try {
        const { data: urow } = await supabase.from('users').select('tiktok_username').eq('id', id).maybeSingle();
        const base = (urow?.tiktok_username ? [String(urow.tiktok_username)] : []) as string[];
        for (const h of base) handles.add(h.replace(/^@/, '').toLowerCase());
      } catch {}
      try {
        const { data: extraH } = await supabase.from('user_tiktok_usernames').select('tiktok_username').eq('user_id', id);
        for (const r of extraH || []) handles.add(String((r as any).tiktok_username).replace(/^@/, '').toLowerCase());
      } catch {}
      if (handles.size === 0) continue;
      const all = Array.from(handles);
      const { data: sumRows } = await supabase
        .from('tiktok_posts_daily')
        .select('play_count, digg_count, comment_count, share_count, save_count, username, post_date')
        .in('username', all)
        .gte('post_date', startISO);
      let agg = { views:0, likes:0, comments:0, shares:0, saves:0 };
      for (const r of sumRows || []) {
        agg.views += Number((r as any).play_count)||0;
        agg.likes += Number((r as any).digg_count)||0;
        agg.comments += Number((r as any).comment_count)||0;
        agg.shares += Number((r as any).share_count)||0;
        agg.saves += Number((r as any).save_count)||0;
      }

      await supabase.from('social_metrics').upsert({
        user_id: id,
        platform: 'tiktok',
        followers: 0,
        likes: agg.likes,
        views: agg.views,
        comments: agg.comments,
        shares: agg.shares,
        saves: agg.saves,
        last_updated: nowIso,
      }, { onConflict: 'user_id,platform' });

      await supabase.from('social_metrics_history').insert({
        user_id: id,
        platform: 'tiktok',
        followers: 0,
        likes: agg.likes,
        views: agg.views,
        comments: agg.comments,
        shares: agg.shares,
        saves: agg.saves,
        captured_at: nowIso,
      });
    } catch {}
  }

  return { success: true, totalVideos: videos.length, totals };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authorization (simple bearer token check)
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    // You can set a CRON_SECRET in your environment variables
    const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (token !== cronSecret) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const concurrency = parseInt(searchParams.get('concurrency') || '3');

    const supabase = adminClient();

    // Get all users with TikTok usernames
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('tiktok_username')
      .not('tiktok_username', 'is', null)
      .limit(limit);

    if (usersError) {
      throw usersError;
    }

    if (!users || users.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No users to sync',
        processed: 0,
        results: []
      });
    }

    // Process users in batches (concurrency control)
    const results: any[] = [];
    
    for (let i = 0; i < users.length; i += concurrency) {
      const batch = users.slice(i, i + concurrency);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (user) => {
          const username = user.tiktok_username.replace(/^@/, '').toLowerCase();
          
          try {
            const tiktokData = await fetchTikTokPosts(username, 10);
            const saveResult = await saveMetricsToSupabase(username, tiktokData);
            
            return {
              username,
              success: saveResult.success,
              videos: saveResult.totalVideos,
              metrics: saveResult.totals,
              error: saveResult.postsError
            };
          } catch (error) {
            return {
              username,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        })
      );

      // Collect results
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            username: 'unknown',
            success: false,
            error: result.reason?.message || 'Promise rejected'
          });
        }
      });

      // Small delay between batches to avoid rate limiting
      if (i + concurrency < users.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const processedTime = (Date.now() - startTime) / 1000;
    const successCount = results.filter(r => r.success).length;

    return NextResponse.json({
      success: true,
      processed: results.length,
      succeeded: successCount,
      failed: results.length - successCount,
      results,
      processed_time: parseFloat(processedTime.toFixed(2))
    });

  } catch (error) {
    const processedTime = (Date.now() - startTime) / 1000;
    console.error('Sync error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      processed_time: parseFloat(processedTime.toFixed(2))
    }, { status: 500 });
  }
}
