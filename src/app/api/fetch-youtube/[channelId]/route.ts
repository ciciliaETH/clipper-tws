import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel limit

const AGGREGATOR_BASE = process.env.AGGREGATOR_BASE || 'http://202.10.44.90/api/v1';
const AGGREGATOR_V2_BASE = 'http://202.10.44.90/api/v2';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Convert Unix timestamp (seconds) or date string to YYYY-MM-DD
function formatPostDate(val: any): string {
  if (!val) return new Date().toISOString().split('T')[0];
  const d = new Date(typeof val === 'number' ? val * 1000 : val);
  return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
}

export async function GET(req: Request, context: any) {
  try {
    const { channelId } = await context.params;
    const supa = adminClient();
    
    // Identifier: could be channel ID (UC...) or handle (@...)
    // Aggregator V2 expects 'channel' param
    const channelParam = decodeURIComponent(String(channelId));

    // 1. Try V2 Aggregator (Priority)
    // http://202.10.44.90/api/v2/youtube/video?channel=@MrBeast&limit=30&shorts_only=true
    const v2Url = `${AGGREGATOR_V2_BASE}/youtube/video?channel=${encodeURIComponent(channelParam)}&limit=30&shorts_only=true`;
    console.log(`[YouTube Fetch] Requesting V2: ${v2Url}`);

    try {
      const res = await fetch(v2Url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'success' && json.data) {
          // Normalize result: support both single 'latest_video' and array 'videos'
          let list = [];
          if (Array.isArray(json.data.videos)) {
            list = json.data.videos;
          } else if (json.data.latest_video) {
            list = [json.data.latest_video];
          }

          if (list.length > 0) {
            console.log(`[YouTube Fetch] V2 Found ${list.length} videos`);
            
            const upserts = [];
            for (const v of list) {
              const videoId = v.video_id || v.id;
              if (!videoId) continue;
              
              // Derive post_date from timestamp or string
              const pDate = formatPostDate(v.taken_at_timestamp || v.published_at);
              
              upserts.push({
                id: videoId,
                channel_id: channelParam,
                shortcode: videoId,
                title: (v.title || '').substring(0, 255),
                post_date: pDate,
                views: Number(v.views || 0),
                likes: Number(v.likes || 0),
                comments: Number(v.comments || 0),
                updated_at: new Date().toISOString()
              });
            }
            
            if (upserts.length > 0) {
              const { error } = await supa.from('youtube_posts_daily').upsert(upserts, { onConflict: 'id' });
              if (error) {
                console.error('[YouTube Fetch][V2] DB Error:', error);
              } else {
                return NextResponse.json({ 
                  success: true, 
                  processed: upserts.length, 
                  videos_found: list.length,
                  source: 'aggregator_v2'
                });
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[YouTube Fetch] V2 failed: ${err.message}`);
    }

    // 2. Fallback to V1 (Old logic)
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
        shortcode: videoId,
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
