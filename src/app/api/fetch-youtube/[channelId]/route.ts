import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel limit

const AGGREGATOR_BASE = process.env.AGGREGATOR_BASE || 'http://202.10.44.90/api/v1';
const AGGREGATOR_V2_BASE = 'http://202.10.44.90/api/v2';
// Comma-separated API keys for aggregator v2 (if required)
const YT_API_KEYS = process.env.YT_API_KEYS || process.env.YOUTUBE_API_KEYS || 'AIzaSyCQ65XwURWB92sjWfZatGuD0tapMgl3exM,AIzaSyDFcVG-7qYrQUcmDu13V0Bjj8fWanMFKAk,AIzaSyBrjwURvu3R9y50d1IoSy_H10kK8DFIb3E';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Convert Unix timestamp (seconds) or date string to YYYY-MM-DD
// Returns null if no valid date can be extracted (do NOT default to today)
function formatPostDate(val: any): string | null {
  if (!val) return null;
  const d = new Date(typeof val === 'number' ? val * 1000 : val);
  return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : null;
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
    const apiKeyQuery = YT_API_KEYS ? `&api_key=${encodeURIComponent(YT_API_KEYS)}` : '';
    const v2Url = `${AGGREGATOR_V2_BASE}/youtube/video?channel=${encodeURIComponent(channelParam)}&limit=30&shorts_only=true${apiKeyQuery}`;
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
            
            // Resolve mapping: robust strategy to find user_id and canonical channel_id
            let mappedUserId: string | null = null;
            let mappedChannelId: string | null = null;
            
            try {
              // 1. Try direct match on user_youtube_channels (Channel ID)
              const { data: mapRow } = await supa
                .from('user_youtube_channels')
                .select('user_id, youtube_channel_id')
                .eq('youtube_channel_id', channelParam)
                .maybeSingle();

              if (mapRow) {
                mappedUserId = (mapRow as any).user_id;
                mappedChannelId = (mapRow as any).youtube_channel_id;
              }

              // 2. If not found, try lookup via user_youtube_usernames (Handle)
              if (!mappedUserId) {
                const handle = channelParam.replace(/^@/, '');
                
                // A. Check user_youtube_usernames
                const { data: userMap } = await supa
                  .from('user_youtube_usernames')
                  .select('user_id')
                  .or(`youtube_username.eq.${handle},youtube_username.eq.@${handle}`)
                  .maybeSingle();
                
                if (userMap) mappedUserId = (userMap as any).user_id;

                // B. Check user_tiktok_usernames (Common handle strategy)
                if (!mappedUserId) {
                    const { data: ttMap } = await supa
                        .from('user_tiktok_usernames')
                        .select('user_id')
                        .eq('tiktok_username', handle) // stored as plain username usually
                        .maybeSingle();
                    if (ttMap) mappedUserId = (ttMap as any).user_id;
                }

                // C. Check user_instagram_usernames (Common handle strategy)
                if (!mappedUserId) {
                    const { data: igMap } = await supa
                        .from('user_instagram_usernames')
                        .select('user_id')
                        .eq('instagram_username', handle)
                        .maybeSingle();
                    if (igMap) mappedUserId = (igMap as any).user_id;
                }
                
                if (mappedUserId) {
                  // Try to find the canonical channel ID for this user from DB first
                  const { data: canon } = await supa
                    .from('user_youtube_channels')
                    .select('youtube_channel_id')
                    .eq('user_id', mappedUserId)
                    .maybeSingle();
                  
                  if (canon) {
                    mappedChannelId = (canon as any).youtube_channel_id;
                  } else {
                     // If we found the USER but don't know their Channel ID yet,
                     // and the response from Aggregator contains the channel ID...
                     // Wait, the aggregator response (v) might have channel info?
                     // Usually aggregator v2 returns `author` object with `id` (channel id) inside video object.
                     if (list.length > 0) {
                        const firstVideo = list[0];
                        // Check if aggregator provides channel ID in video metadata
                        // Typical response: { ... author: { id: "UC...", unique_id: "handle" } ... }
                        // Or just top level author_id?
                        // Let's safe check common fields
                        const authId = firstVideo?.author?.id || firstVideo?.author_id || firstVideo?.channel_id;
                        if (authId && String(authId).startsWith('UC')) {
                           mappedChannelId = String(authId);
                           // Auto-link this channel ID to the user!
                           await supa.from('user_youtube_channels').upsert({
                               user_id: mappedUserId,
                               youtube_channel_id: mappedChannelId
                           }, { onConflict: 'user_id, youtube_channel_id' });
                           console.log(`[YouTube Fetch] Auto-linked Channel ${mappedChannelId} to User ${mappedUserId}`);
                        }
                     }
                  }
                }
              }
              
              // 3. Fallback: If still no channel ID and input looks like one
              if (mappedUserId && !mappedChannelId && String(channelParam).startsWith('UC')) {
                 mappedChannelId = channelParam;
                 // verify link
                 await supa.from('user_youtube_channels').upsert({
                    user_id: mappedUserId,
                    youtube_channel_id: mappedChannelId
                 }, { onConflict: 'user_id, youtube_channel_id' });
              }

            } catch (e) {
              console.warn('[YouTube Fetch] Mapping error:', e);
            }

            const upserts = [] as any[];
            for (const v of list) {
              const videoId = v.video_id || v.id;
              if (!videoId) continue;
              
              // Derive post_date from timestamp or string — skip if no valid date
              const pDate = formatPostDate(v.taken_at_timestamp || v.published_at);
              if (!pDate) continue; // skip videos without a valid publish date
              // Only upsert when we can map to a user
              if (mappedUserId) {
                const row: any = {
                  id: mappedUserId, // user_id
                  channel_id: mappedChannelId || channelParam, // canonical channel id when known
                  video_id: videoId,
                  shortcode: videoId,
                  post_date: pDate,
                  views: Number(v.views || 0),
                  likes: Number(v.likes || 0),
                  comments: Number(v.comments || 0),
                  updated_at: new Date().toISOString()
                };
                // Only include title if non-empty, so we don't overwrite existing title with empty string
                const vTitle = String(v.title || '');
                if (vTitle) row.title = vTitle;
                upserts.push(row);
              }
            }
            
            if (upserts.length > 0) {
              // Split rows: those with title vs without, so we don't overwrite existing titles
              const withTitle = upserts.filter((r: any) => r.title);
              const withoutTitle = upserts.filter((r: any) => !r.title);
              let dbError = false;
              for (const batch of [withTitle, withoutTitle]) {
                if (batch.length === 0) continue;
                const { error } = await supa.from('youtube_posts_daily').upsert(batch, { onConflict: 'id,video_id' });
                if (error) {
                  console.error('[YouTube Fetch][V2] DB Error:', error);
                  dbError = true;
                }
              }
              if (!dbError) {
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
    // Resolve mapping: robust strategy
    let mappedUserId: string | null = null;
    let mappedChannelId: string | null = null;
    
    try {
      // 1. Try direct match (Channel ID)
      const { data: mapRow } = await supa
        .from('user_youtube_channels')
        .select('user_id, youtube_channel_id')
        .eq('youtube_channel_id', channelParam)
        .maybeSingle();

      if (mapRow) {
        mappedUserId = (mapRow as any).user_id;
        mappedChannelId = (mapRow as any).youtube_channel_id;
      }

      // 2. Try Handle lookup
      if (!mappedUserId) {
        const handle = channelParam.replace(/^@/, '');
        const { data: userMap } = await supa
          .from('user_youtube_usernames')
          .select('user_id')
          .or(`youtube_username.eq.${handle},youtube_username.eq.@${handle}`)
          .maybeSingle();
        
        if (userMap) {
          mappedUserId = (userMap as any).user_id;
          const { data: canon } = await supa
            .from('user_youtube_channels')
            .select('youtube_channel_id')
            .eq('user_id', mappedUserId)
            .maybeSingle();
          if (canon) mappedChannelId = (canon as any).youtube_channel_id;
        }
      }
    } catch (e) { console.warn('[YouTube Fetch] V1 Mapping error:', e); }

    const upserts: any[] = [];
    for (const v of videos) {
      // Map API fields to our Schema
      const videoId = v.video_id || v.aweme_id || v.id;
      if (!videoId) continue;

      const title = String(v.title || v.desc || '');
      const postDate = formatPostDate(v.create_time);
      if (!postDate) continue; // skip videos without a valid publish date
      const views = Number(v.play_count || 0);
      const likes = Number(v.digg_count || 0);
      const comments = Number(v.comment_count || 0);

      if (mappedUserId) {
        const row: any = {
          id: mappedUserId, // user_id (must exist for PK)
          channel_id: mappedChannelId || channelParam,
          video_id: videoId,
          shortcode: videoId,
          post_date: postDate,
          views,
          likes,
          comments,
          updated_at: new Date().toISOString()
        };
        // Only include title if non-empty, so we don't overwrite existing title
        if (title) row.title = title;
        upserts.push(row);
      }
    }

    if (upserts.length > 0) {
        // Split rows: those with title vs without, so we don't overwrite existing titles
        const withTitle = upserts.filter((r: any) => r.title);
        const withoutTitle = upserts.filter((r: any) => !r.title);
        for (const batch of [withTitle, withoutTitle]) {
          if (batch.length === 0) continue;
          const { error } = await supa.from('youtube_posts_daily').upsert(batch, { onConflict: 'id,video_id' });
          if (error) {
            console.error('[YouTube Fetch] DB Error:', error);
            throw error;
          }
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
