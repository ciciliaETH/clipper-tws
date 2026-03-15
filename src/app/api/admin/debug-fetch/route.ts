import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const AGGREGATOR_BASE = process.env.AGGREGATOR_API_BASE || 'http://202.10.44.90/api/v1';
const AGGREGATOR_PER_PAGE = 100;
const AGGREGATOR_RATE_MS = 100;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const username = (url.searchParams.get('username') || '').toLowerCase().replace(/^@/, '').trim();
  const searchVideoId = url.searchParams.get('video_id') || '';

  if (!username) {
    return NextResponse.json({ error: 'username required. Usage: ?username=raditxaktas&video_id=7612851822021086472' }, { status: 400 });
  }

  const supa = adminClient();
  const results: any = { username, searchVideoId, steps: [] };

  // Step 1: Check if video exists in database
  if (searchVideoId) {
    const { data: dbVideo } = await supa
      .from('tiktok_posts_daily')
      .select('video_id, username, taken_at, play_count, title')
      .eq('video_id', searchVideoId)
      .maybeSingle();

    results.steps.push({
      step: '1_check_database',
      found: !!dbVideo,
      data: dbVideo || 'NOT FOUND in tiktok_posts_daily'
    });
  }

  // Step 2: Count total videos for this username in database
  const { count: dbCount } = await supa
    .from('tiktok_posts_daily')
    .select('video_id', { count: 'exact', head: true })
    .eq('username', username);

  results.steps.push({
    step: '2_db_video_count',
    username,
    total_videos_in_db: dbCount
  });

  // Step 3: Fetch from aggregator and check
  const allVideos: any[] = [];
  const seenIds = new Set<string>();
  let totalPages = 0;
  let foundTarget = false;
  let targetVideoRaw: any = null;

  const startStr = '2025-01-01';
  const endStr = new Date().toISOString().slice(0, 10);
  let cursor: string | undefined = undefined;

  results.steps.push({
    step: '3_aggregator_fetch_start',
    url_format: `${AGGREGATOR_BASE}/user/posts?username=${username}&count=${AGGREGATOR_PER_PAGE}&start=${startStr}&end=${endStr}`,
    date_range: `${startStr} to ${endStr}`
  });

  const fetchStart = Date.now();
  for (let page = 0; page < 50; page++) {
    if (Date.now() - fetchStart > 45000) {
      results.steps.push({ step: '3_timeout', message: 'Stopped after 45s' });
      break;
    }

    try {
      const aggUrl = new URL(`${AGGREGATOR_BASE}/user/posts`);
      aggUrl.searchParams.set('username', username);
      aggUrl.searchParams.set('count', String(AGGREGATOR_PER_PAGE));
      aggUrl.searchParams.set('start', startStr);
      aggUrl.searchParams.set('end', endStr);
      if (cursor) aggUrl.searchParams.set('cursor', cursor);

      const res = await fetch(aggUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000)
      });

      if (!res.ok) {
        results.steps.push({ step: `3_page_${page + 1}_error`, status: res.status });
        break;
      }

      const json = await res.json();
      const videos = json?.data?.videos || json?.videos || [];

      if (!Array.isArray(videos) || videos.length === 0) {
        results.steps.push({ step: `3_page_${page + 1}_empty`, raw_keys: Object.keys(json || {}) });
        break;
      }

      let added = 0;
      for (const v of videos) {
        const vid = v?.aweme_id || v?.video_id || v?.id;
        if (!vid) continue;
        const id = String(vid);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        allVideos.push(v);
        added++;

        // Check if this is the target video
        if (searchVideoId && id === searchVideoId) {
          foundTarget = true;
          targetVideoRaw = v;
        }
      }

      totalPages++;

      // Log page info
      if (page < 5 || foundTarget) {
        results.steps.push({
          step: `3_page_${page + 1}`,
          videos_on_page: videos.length,
          new_unique: added,
          running_total: allVideos.length,
          found_target: foundTarget
        });
      }

      const nextCursor = json?.data?.cursor || json?.data?.next_cursor;
      const hasMore = json?.data?.hasMore || json?.data?.has_more;
      if (!hasMore || !nextCursor || cursor === nextCursor) break;
      cursor = String(nextCursor);
      await new Promise(r => setTimeout(r, AGGREGATOR_RATE_MS));
    } catch (err: any) {
      results.steps.push({ step: `3_page_${page + 1}_exception`, error: err.message });
      break;
    }
  }

  results.aggregator_total = allVideos.length;
  results.aggregator_pages = totalPages;

  if (searchVideoId) {
    results.target_video_found_in_aggregator = foundTarget;
    if (targetVideoRaw) {
      results.target_video_raw = {
        video_id: targetVideoRaw.video_id,
        aweme_id: targetVideoRaw.aweme_id,
        id: targetVideoRaw.id,
        title: targetVideoRaw.title || targetVideoRaw.desc || targetVideoRaw.description,
        create_time: targetVideoRaw.create_time || targetVideoRaw.createTime,
        play_count: targetVideoRaw.play_count || targetVideoRaw.playCount || targetVideoRaw?.stats?.playCount || targetVideoRaw?.statsV2?.playCount,
        digg_count: targetVideoRaw.digg_count || targetVideoRaw.diggCount || targetVideoRaw?.stats?.diggCount,
      };
    }
  }

  // Step 4: Compare aggregator vs database
  // Get all video_ids from database for this username
  const { data: dbVideos } = await supa
    .from('tiktok_posts_daily')
    .select('video_id')
    .eq('username', username);

  const dbIds = new Set((dbVideos || []).map((r: any) => String(r.video_id)));
  const aggIds = new Set(allVideos.map((v: any) => String(v?.aweme_id || v?.video_id || v?.id)));

  const inAggNotDb = Array.from(aggIds).filter(id => !dbIds.has(id));
  const inDbNotAgg = Array.from(dbIds).filter(id => !aggIds.has(id));

  results.steps.push({
    step: '4_comparison',
    aggregator_unique_videos: aggIds.size,
    database_videos: dbIds.size,
    in_aggregator_NOT_in_db: inAggNotDb.length,
    in_db_NOT_in_aggregator: inDbNotAgg.length,
    missing_from_db_sample: inAggNotDb.slice(0, 10)
  });

  results.summary = {
    aggregator_videos: aggIds.size,
    database_videos: dbIds.size,
    missing_from_db: inAggNotDb.length,
    target_found: searchVideoId ? foundTarget : 'no video_id specified'
  };

  return NextResponse.json(results);
}
