import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel limit

const AGGREGATOR_BASE = process.env.AGGREGATOR_BASE || 'http://202.10.44.90/api/v1';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Convert Unix timestamp (seconds) to YYYY-MM-DD
function formatPostDate(ts: number | undefined): string {
  if (!ts) return new Date().toISOString().split('T')[0];
  return new Date(ts * 1000).toISOString().split('T')[0];
}

export async function GET(req: Request, context: any) {
  try {
    const { channelId } = await context.params;
    const supa = adminClient();
    
    // The user instruction implies "username" query param can be the identifier
    // We pass `type=short` as requested.
    // Clean identifier.
    const apiUsername = String(channelId || '').trim(); 
    
    const url = `${AGGREGATOR_BASE}/user/posts?username=${encodeURIComponent(apiUsername)}&type=short`;
    console.log(`[YouTube Fetch] Requesting: ${url}`);

    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    } catch (e: any) {
      console.error('[YouTube Fetch] Network error:', e);
      return NextResponse.json({ success: false, error: 'Aggregator Unreachable' }, { status: 502 });
    }

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Aggregator HTTP ${res.status}` }, { status: res.status });
    }

    const json = await res.json();
    if (json.code !== 0) {
      // code 0 usually means success in this aggregator format (TikWM style)
      return NextResponse.json({ success: false, error: json.msg || 'Aggregator returned error code' });
    }

    const videos = json.data?.videos || []; // Normalized field 'videos' according to sample
    console.log(`[YouTube Fetch] Found ${videos.length} videos`);

    if (videos.length === 0) {
       return NextResponse.json({ success: true, processed: 0, message: 'No videos found' });
    }

    // Process and upsert
    const upserts = [];
    for (const v of videos) {
      // Map API fields to our Schema
      const videoId = v.video_id || v.aweme_id || v.id;
      if (!videoId) continue;

      const title = v.title || v.desc || '(No Title)';
      const postDate = formatPostDate(v.create_time);
      const views = Number(v.play_count || 0);
      const likes = Number(v.digg_count || 0);
      const comments = Number(v.comment_count || 0);

      upserts.push({
        id: videoId,
        channel_id: channelId, // Link to the identifier we used
        title: title.substring(0, 255), // truncate
        post_date: postDate,
        views,
        likes,
        comments,
        updated_at: new Date().toISOString()
      });
    }

    if (upserts.length > 0) {
        const { error } = await supa.from('youtube_posts_daily').upsert(upserts, { onConflict: 'id' });
        if (error) {
            console.error('[YouTube Fetch] DB Error:', error);
            throw error;
        }
    }

    return NextResponse.json({ 
      success: true, 
      processed: upserts.length, 
      videos_found: videos.length
    });

  } catch (error: any) {
    console.error('[YouTube Fetch] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
