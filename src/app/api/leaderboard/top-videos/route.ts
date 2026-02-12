import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hasRequiredHashtag } from '@/lib/hashtag-filter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60; // 60 seconds to stay safe

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const campaignId = url.searchParams.get('campaign_id') || ''
    const platform = (url.searchParams.get('platform') || 'all').toLowerCase() // all, tiktok, instagram, youtube
    const daysParam = Number(url.searchParams.get('days') || '30')
    const mode = (url.searchParams.get('mode') || '').toLowerCase() // '' | 'calendar'
    // Allow any days value between 1 and 365 (default 30)
    const windowDays = Math.max(1, Math.min(365, daysParam))
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') || '10')))

    const supabase = supabaseAdmin()
    
    // If campaign_id is missing, we aggregate across ALL campaigns (all employees)
    let requiredHashtags: string[] | null = null
    let employeeIds: string[] = []
    if (!campaignId) {
      // All employees (role=karyawan)
      const { data: emps } = await supabase
        .from('users')
        .select('id')
        .eq('role','karyawan')
      employeeIds = (emps||[]).map((r:any)=> String(r.id))
    } else {
      // Get campaign info including required hashtags
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('id, name, required_hashtags')
        .eq('id', campaignId)
        .single()
      requiredHashtags = (campaign as any)?.required_hashtags || null
    }
    
    // Calculate date window
    const now = new Date()
    let endISO = now.toISOString().slice(0, 10)
    let startISO: string
    if (mode === 'calendar') {
      // Start at first day of current month (UTC)
      const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      startISO = s.toISOString().slice(0, 10)
    } else {
      const startDate = new Date()
      startDate.setUTCDate(startDate.getUTCDate() - (windowDays - 1))
      startISO = startDate.toISOString().slice(0, 10)
    }

    // Collect employees according to campaign scope
    if (campaignId) {
      const { data: employees } = await supabase
        .from('employee_groups')
        .select('employee_id')
        .eq('campaign_id', campaignId)
      console.log(`[Top Videos] Campaign ${campaignId}: Found ${employees?.length || 0} employees`)
      if (!employees || employees.length === 0) {
        return NextResponse.json({ 
          videos: [], 
          campaign_id: campaignId,
          required_hashtags: requiredHashtags,
          platform, 
          start: startISO, 
          end: endISO, 
          days: windowDays,
          debug: { employees_count: 0, reason: 'No employees in campaign' }
        })
      }
      employeeIds = employees.map((e: any) => e.employee_id)
    }

    // Get usernames mapping
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, username, tiktok_username, instagram_username, youtube_channel_id')
      .in('id', employeeIds)
    
    // Fetch aliases for comprehensive lookup
    const { data: ttAliases } = await supabase
      .from('user_tiktok_usernames')
      .select('user_id, tiktok_username')
      .in('user_id', employeeIds);

    const { data: igAliases } = await supabase
      .from('user_instagram_usernames')
      .select('user_id, instagram_username')
      .in('user_id', employeeIds);
    
    const userMap = new Map<string, any>()
    for (const u of users || []) {
      userMap.set(u.id, {
        name: u.full_name || u.username || u.tiktok_username || u.instagram_username || u.id,
      })
    }

    // Build Reverse Maps: username -> user_id
    const ttUserToId = new Map<string, string>();
    const igUserToId = new Map<string, string>();
    const ytChannelToId = new Map<string, string>();
    const ytIdToHandle = new Map<string, string>(); // user_id -> youtube handle (without @)
    
    // Populate from users table (current)
    for(const u of users || []) {
        if(u.tiktok_username) ttUserToId.set(u.tiktok_username.toLowerCase().replace(/^@+/,''), u.id);
        if(u.instagram_username) igUserToId.set(u.instagram_username.toLowerCase().replace(/^@+/,''), u.id);
        if((u as any).youtube_channel_id) ytChannelToId.set(String((u as any).youtube_channel_id).trim(), u.id);
    }
    // Populate from aliases
    for(const a of ttAliases || []) {
        if(a.tiktok_username) ttUserToId.set(a.tiktok_username.toLowerCase().replace(/^@+/,''), a.user_id);
    }
    for(const a of igAliases || []) {
        if(a.instagram_username) igUserToId.set(a.instagram_username.toLowerCase().replace(/^@+/,''), a.user_id);
    }

    // Try to fetch YouTube handles if a mapping table exists in DB (ignore if missing)
    try {
      const { data: ytHandles } = await supabase
        .from('user_youtube_usernames')
        .select('user_id, youtube_username')
        .in('user_id', employeeIds);
      for (const r of ytHandles || []) {
        const uid = (r as any).user_id;
        const handle = String((r as any).youtube_username || '').trim().replace(/^@+/, '').toLowerCase();
        if (uid && handle) ytIdToHandle.set(uid, handle);
      }
    } catch (e) {
      // table may not exist; ignore silently
    }

    const videos: any[] = []

    // === TIKTOK VIDEOS ===
    if (platform === 'all' || platform === 'tiktok') {
      // Get TikTok usernames for employees
      const tiktokUsernames = Array.from(ttUserToId.keys());

      console.log(`[Top Videos] TikTok: ${tiktokUsernames.length} usernames to query: ${tiktokUsernames.slice(0, 5).join(', ')}${tiktokUsernames.length > 5 ? '...' : ''}`)
      
      if (tiktokUsernames.length > 0) {
        // Query snapshots within the taken_at window
        const { data: tiktokPosts } = await supabase
          .from('tiktok_posts_daily')
          .select('video_id, username, taken_at, title, play_count, digg_count, comment_count, share_count, save_count')
          .in('username', tiktokUsernames)
          .gte('taken_at', startISO + 'T00:00:00Z')
          .lte('taken_at', endISO + 'T23:59:59Z')
          .order('play_count', { ascending: false })
          .limit(limit * 200)

        const startTs = new Date(startISO + 'T00:00:00Z').getTime()
        const endTs = new Date(endISO + 'T23:59:59Z').getTime()
        const videoMap = new Map<string, any[]>()
        for (const post of (tiktokPosts || [])) {
          const vid = String(post.video_id)
          if (!videoMap.has(vid)) videoMap.set(vid, [])
          videoMap.get(vid)!.push(post)
        }

        console.log(`[Top Videos] TikTok: Found ${tiktokPosts?.length || 0} total posts, groups=${videoMap.size} window ${startISO}..${endISO}`)

        // Calculate ABSOLUTE totals for each video (last snapshot as of endISO)
        for (const [videoId, snapshots] of videoMap.entries()) {
          // Sort by taken_at
          snapshots.sort((a, b) => (a.taken_at || '').localeCompare(b.taken_at || ''))
          
          const first = snapshots[0]
          const last = snapshots[snapshots.length - 1]

          // Determine actual upload date from earliest taken_at
          const actualPostDate = snapshots.reduce((min: string, s: any) => {
            const iso = new Date(s.taken_at).toISOString().slice(0,10)
            return !min || iso < min ? iso : min
          }, new Date(first.taken_at).toISOString().slice(0,10))

          // Filter snapshots within window (upload date window); use latest snapshot within window as current total
          const windowSnapshots = snapshots.filter((s) => {
            const ts = new Date(s.taken_at).getTime()
            return ts >= startTs && ts <= endTs
          })
          const lastW = windowSnapshots[windowSnapshots.length - 1] || last
          
          // Filter by hashtag if required
          if (!hasRequiredHashtag(lastW.title, requiredHashtags)) {
            continue;
          }
          
          // Absolute totals at latest snapshot in window (post date ranking)
          const views = Number(lastW.play_count || 0)
          const likes = Number(lastW.digg_count || 0)
          const comments = Number(lastW.comment_count || 0)
          const shares = Number(lastW.share_count || 0)
          const saves = Number(lastW.save_count || 0)

          // Find owner user
          let ownerName = last.username
          let ownerId = null
          const normalized = last.username.toLowerCase().replace(/^@+/,'');
          if (ttUserToId.has(normalized)) {
             ownerId = ttUserToId.get(normalized);
             if (ownerId && userMap.has(ownerId)) {
                ownerName = userMap.get(ownerId).name;
             }
          }

          // taken_at returned to client uses actual upload date computed above

          videos.push({
            platform: 'tiktok',
            video_id: videoId,
            username: last.username,
            owner_name: ownerName,
            owner_id: ownerId,
            taken_at: actualPostDate, // Use actual upload date
            link: `https://www.tiktok.com/@${last.username}/video/${videoId}`,
            metrics: {
              views,
              likes,
              comments,
              shares,
              saves,
              total_engagement: likes + comments + shares + saves
            },
            snapshots_count: snapshots.length
          });
        }
      }
    }

    // === INSTAGRAM VIDEOS ===
    if (platform === 'all' || platform === 'instagram') {
      // Get Instagram usernames for employees
      const uniqueIgUsernames = Array.from(igUserToId.keys());

      console.log(`[Top Videos] Instagram: ${uniqueIgUsernames.length} usernames to query: ${uniqueIgUsernames.slice(0, 5).join(', ')}${uniqueIgUsernames.length > 5 ? '...' : ''}`)

      if (uniqueIgUsernames.length > 0) {
        // Query snapshots within the taken_at window
        const { data: igPosts } = await supabase
          .from('instagram_posts_daily')
          .select('id, code, username, taken_at, caption, play_count, like_count, comment_count')
          .in('username', uniqueIgUsernames)
          .gte('taken_at', startISO + 'T00:00:00Z')
          .lte('taken_at', endISO + 'T23:59:59Z')
          .order('play_count', { ascending: false })
          .limit(limit * 200)

        const startTs = new Date(startISO + 'T00:00:00Z').getTime()
        const endTs = new Date(endISO + 'T23:59:59Z').getTime()
        const videoMap = new Map<string, any[]>()
        for (const post of (igPosts || [])) {
          const vid = String(post.id)
          if (!videoMap.has(vid)) videoMap.set(vid, [])
          videoMap.get(vid)!.push(post)
        }

        console.log(`[Top Videos] Instagram: Found ${igPosts?.length || 0} total posts, groups=${videoMap.size} window ${startISO}..${endISO}`)

        // Calculate ABSOLUTE totals for each post (last snapshot as of endISO)
        for (const [postId, snapshots] of videoMap.entries()) {
          snapshots.sort((a, b) => (a.taken_at || '').localeCompare(b.taken_at || ''))
          
          const first = snapshots[0]
          const last = snapshots[snapshots.length - 1]

          // Determine actual upload date from earliest taken_at
          const actualPostDate = snapshots.reduce((min: string, s: any) => {
            const iso = new Date(s.taken_at).toISOString().slice(0,10)
            return !min || iso < min ? iso : min
          }, new Date(first.taken_at).toISOString().slice(0,10))

          // Filter snapshots within window (upload date window); use latest snapshot within window as current total
          const windowSnapshots = snapshots.filter((s) => {
            const ts = new Date(s.taken_at).getTime()
            return ts >= startTs && ts <= endTs
          })
          const lastW = windowSnapshots[windowSnapshots.length - 1] || last
          
          // Filter by hashtag if required
          if (!hasRequiredHashtag(lastW.caption, requiredHashtags)) {
            continue;
          }
          
          const views = Number(lastW.play_count || 0)
          const likes = Number(lastW.like_count || 0)
          const comments = Number(lastW.comment_count || 0)

          // Find owner user
          let ownerName = last.username
          let ownerId = null
          const normalized = last.username.toLowerCase().replace(/^@+/,'');
          if (igUserToId.has(normalized)) {
             ownerId = igUserToId.get(normalized);
             if (ownerId && userMap.has(ownerId)) {
                ownerName = userMap.get(ownerId).name;
             }
          }

          videos.push({
            platform: 'instagram',
            video_id: postId,
            username: last.username,
            owner_name: ownerName,
            owner_id: ownerId,
            taken_at: actualPostDate, // Use actual upload date
            link: `https://www.instagram.com/reel/${last.code || postId}/`,
            metrics: {
              views,
              likes,
              comments,
              shares: 0,
              saves: 0,
              total_engagement: likes + comments
            }
          });
        }
      }
    }

    // === YOUTUBE VIDEOS ===
    if (platform === 'all' || platform === 'youtube') {
      // Collect YouTube channels for employees
      const channels: string[] = []
      // from users direct column
      for (const u of users || []) {
        const cid = (u as any).youtube_channel_id; if (cid) channels.push(String(cid).trim())
      }
      // from user_youtube_channels table
      if (employeeIds.length > 0) {
        const { data: ytMap } = await supabase
          .from('user_youtube_channels')
          .select('user_id, youtube_channel_id')
          .in('user_id', employeeIds)
        for (const r of ytMap || []) {
          const cid = (r as any).youtube_channel_id; if (cid) {
            channels.push(String(cid).trim()); ytChannelToId.set(String(cid).trim(), (r as any).user_id)
          }
        }
        const { data: ytEmp } = await supabase
          .from('employee_youtube_participants')
          .select('employee_id, youtube_channel_id')
          .in('employee_id', employeeIds)
        for (const r of ytEmp || []) {
          const cid = (r as any).youtube_channel_id; if (cid) {
            channels.push(String(cid).trim()); ytChannelToId.set(String(cid).trim(), (r as any).employee_id)
          }
        }
      }
      const uniqueChannels = Array.from(new Set(channels.filter(Boolean)))
      if (uniqueChannels.length > 0) {
        const { data: ytRows } = await supabase
          .from('youtube_posts_daily')
          .select('video_id, id, channel_id, post_date, title, views, likes, comments')
          .in('channel_id', uniqueChannels)
          .gte('post_date', startISO)
          .lte('post_date', endISO)
          .order('views', { ascending: false })
          .limit(limit * 200)

        // Group by video id
        const videoMap = new Map<string, any[]>()
        for (const r of ytRows || []) {
          const vid = String((r as any).video_id)
          if (!videoMap.has(vid)) videoMap.set(vid, [])
          videoMap.get(vid)!.push(r)
        }

        for (const [vid, snaps] of videoMap.entries()) {
          // Sort by post_date
          snaps.sort((a, b) => String((a as any).post_date).localeCompare(String((b as any).post_date)))
          const last = snaps[snaps.length - 1]
          const first = snaps[0]
          const postDate = String((first as any).post_date)
          // hashtag filter on title
          if (!hasRequiredHashtag((last as any).title, requiredHashtags)) continue
          const views = Number((last as any).views || 0)
          const likes = Number((last as any).likes || 0)
          const comments = Number((last as any).comments || 0)
          const channelId = String((last as any).channel_id)
          let ownerName = channelId
          let ownerId: string | null = (last as any).id || null
          let displayUsername = channelId
          if (!ownerId && ytChannelToId.has(channelId)) {
            ownerId = ytChannelToId.get(channelId)!
            if (ownerId && userMap.has(ownerId)) ownerName = userMap.get(ownerId).name
            // Prefer handle from mapping if available
            const h = ownerId ? ytIdToHandle.get(ownerId) : undefined
            if (h) displayUsername = h
          } else {
            // If channel_id itself is a handle like @handle, normalize to without @
            if (channelId.startsWith('@')) displayUsername = channelId.replace(/^@+/, '')
          }
          videos.push({
            platform: 'youtube',
            video_id: vid,
            username: displayUsername,
            owner_name: ownerName,
            owner_id: ownerId,
            taken_at: postDate,
            link: `https://www.youtube.com/shorts/${vid}`,
            metrics: { views, likes, comments, shares: 0, saves: 0, total_engagement: likes + comments },
            snapshots_count: snaps.length
          })
        }
      }
    }

    // Sort by views descending and limit
    videos.sort((a, b) => b.metrics.views - a.metrics.views);
    const topVideos = videos.slice(0, limit);

    console.log(`[Top Videos] Final: ${videos.length} total videos (TT+IG+YT), showing top ${topVideos.length}`)
    if (topVideos.length > 0) {
      console.log(`[Top Videos] Top video: ${topVideos[0].platform} @${topVideos[0].username} - ${topVideos[0].metrics.views} views`)
    }

    // === CALCULATE ACTUAL TOTAL POSTS FROM taken_at (accurate count) ===
    // Query unique video_id/id based on taken_at in range (precise timestamps)
    let actualTotalPosts = 0;
    
    // Get TikTok usernames from users table
    const tiktokUsernamesForCount = Array.from(new Set(
      (users || [])
        .map((u: any) => u.tiktok_username)
        .filter(Boolean)
        .map((u: string) => u.toLowerCase().replace(/^@+/, ''))
    ));
    
    // Also add TikTok usernames from employee_participants
    if (employeeIds.length > 0) {
      const { data: ttParticipantsAll } = await supabase
        .from('employee_participants')
        .select('tiktok_username')
        .in('employee_id', employeeIds);
      for (const p of ttParticipantsAll || []) {
        if ((p as any).tiktok_username) {
          tiktokUsernamesForCount.push((p as any).tiktok_username.toLowerCase().replace(/^@+/, ''));
        }
      }
    }
    const uniqueTTUsernamesAll = Array.from(new Set(tiktokUsernamesForCount));
    
    // Get Instagram usernames from users table
    const instagramUsernamesForCount = Array.from(new Set(
      (users || [])
        .map((u: any) => u.instagram_username)
        .filter(Boolean)
        .map((u: string) => u.toLowerCase().replace(/^@+/, ''))
    ));
    
    // Also add from employee_instagram_participants
    if (employeeIds.length > 0) {
      const { data: igParticipantsAll } = await supabase
        .from('employee_instagram_participants')
        .select('instagram_username')
        .in('employee_id', employeeIds);
      for (const p of igParticipantsAll || []) {
        if (p.instagram_username) {
          instagramUsernamesForCount.push(p.instagram_username.toLowerCase().replace(/^@+/, ''));
        }
      }
    }
    const uniqueIgUsernamesAll = Array.from(new Set(instagramUsernamesForCount));
    
    // Count unique TikTok videos by taken_at
    if ((platform === 'all' || platform === 'tiktok') && uniqueTTUsernamesAll.length > 0) {
      const { data: ttUnique } = await supabase
        .from('tiktok_posts_daily')
        .select('video_id, username, taken_at, title')
        .in('username', uniqueTTUsernamesAll)
        .gte('taken_at', startISO + 'T00:00:00Z')
        .lte('taken_at', endISO + 'T23:59:59Z');
      
      // Get unique video_ids with hashtag filter
      const uniqueTTVideos = new Set<string>();
      for (const row of ttUnique || []) {
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag(row.title, requiredHashtags)) continue;
        }
        uniqueTTVideos.add(row.video_id);
      }
      actualTotalPosts += uniqueTTVideos.size;
    }
    
    // Count unique Instagram posts by taken_at
    if ((platform === 'all' || platform === 'instagram') && uniqueIgUsernamesAll.length > 0) {
      const { data: igUnique } = await supabase
        .from('instagram_posts_daily')
        .select('id, username, taken_at, caption')
        .in('username', uniqueIgUsernamesAll)
        .gte('taken_at', startISO + 'T00:00:00Z')
        .lte('taken_at', endISO + 'T23:59:59Z');
      
      // Get unique ids with hashtag filter
      const uniqueIGPosts = new Set<string>();
      for (const row of igUnique || []) {
        if (requiredHashtags && requiredHashtags.length > 0) {
          if (!hasRequiredHashtag((row as any).caption, requiredHashtags)) continue;
        }
        uniqueIGPosts.add(String((row as any).id));
      }
      actualTotalPosts += uniqueIGPosts.size;
    }

    console.log(`[Top Videos] Actual Total Posts (by taken_at): ${actualTotalPosts} (TT usernames: ${uniqueTTUsernamesAll.length}, IG usernames: ${uniqueIgUsernamesAll.length})`)

    return NextResponse.json({
      videos: topVideos,
      campaign_id: campaignId || null,
      required_hashtags: requiredHashtags,
      platform,
      start: startISO,
      end: endISO,
      days: windowDays,
      mode,
      total_found: actualTotalPosts,
      showing: topVideos.length,
      filtered_by_hashtag: requiredHashtags && requiredHashtags.length > 0
    });
  } catch (e: any) {
    console.error('[top-videos] error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
