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
    const platform = (url.searchParams.get('platform') || 'all').toLowerCase() // all, tiktok, instagram
    const daysParam = Number(url.searchParams.get('days') || '7')
    const windowDays = ([7, 28] as number[]).includes(daysParam) ? daysParam : 7
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
    const endISO = new Date().toISOString().slice(0, 10)
    const startDate = new Date()
    startDate.setUTCDate(startDate.getUTCDate() - (windowDays - 1))
    const startISO = startDate.toISOString().slice(0, 10)

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
      .select('id, full_name, username, tiktok_username, instagram_username')
      .in('id', employeeIds)
    
    const userMap = new Map<string, any>()
    for (const u of users || []) {
      userMap.set(u.id, {
        name: u.full_name || u.username || u.tiktok_username || u.instagram_username || u.id,
        tiktok_username: u.tiktok_username,
        instagram_username: u.instagram_username
      })
    }

    const videos: any[] = []

    // === TIKTOK VIDEOS ===
    if (platform === 'all' || platform === 'tiktok') {
      // Get TikTok usernames for employees
      const tiktokUsernames = Array.from(new Set(
        (users || [])
          .map((u: any) => u.tiktok_username)
          .filter(Boolean)
          .map((u: string) => u.toLowerCase().replace(/^@+/, ''))
      ))

      console.log(`[Top Videos] TikTok: ${tiktokUsernames.length} usernames to query: ${tiktokUsernames.slice(0, 5).join(', ')}${tiktokUsernames.length > 5 ? '...' : ''}`)
      
      if (tiktokUsernames.length > 0) {
        // Query tiktok_posts_daily for videos in window
        const { data: tiktokPosts } = await supabase
          .from('tiktok_posts_daily')
          .select('video_id, username, post_date, title, play_count, digg_count, comment_count, share_count, save_count')
          .in('username', tiktokUsernames)
          .gte('post_date', startISO)
          .lte('post_date', endISO)
          .order('play_count', { ascending: false })
          .limit(limit * 10) // Get more for hashtag filtering

        console.log(`[Top Videos] TikTok: Found ${tiktokPosts?.length || 0} posts in date range ${startISO} to ${endISO}`)

        // Group by video_id and calculate accrual (delta from first to last snapshot)
        const videoMap = new Map<string, any[]>()
        for (const post of tiktokPosts || []) {
          const vid = String(post.video_id)
          if (!videoMap.has(vid)) videoMap.set(vid, [])
          videoMap.get(vid)!.push(post)
        }

        // Calculate accrual for each video
        for (const [videoId, snapshots] of videoMap.entries()) {
          // Sort by date
          snapshots.sort((a, b) => a.post_date.localeCompare(b.post_date))
          
          const first = snapshots[0]
          const last = snapshots[snapshots.length - 1]
          
          // Filter by hashtag if required
          if (!hasRequiredHashtag(last.title, requiredHashtags)) {
            continue;
          }
          
          // Accrual = final - initial (or use final if only one snapshot)
          const views = snapshots.length === 1 
            ? Number(last.play_count || 0)
            : Math.max(0, Number(last.play_count || 0) - Number(first.play_count || 0))
          const likes = snapshots.length === 1
            ? Number(last.digg_count || 0)
            : Math.max(0, Number(last.digg_count || 0) - Number(first.digg_count || 0))
          const comments = snapshots.length === 1
            ? Number(last.comment_count || 0)
            : Math.max(0, Number(last.comment_count || 0) - Number(first.comment_count || 0))
          const shares = snapshots.length === 1
            ? Number(last.share_count || 0)
            : Math.max(0, Number(last.share_count || 0) - Number(first.share_count || 0))
          const saves = snapshots.length === 1
            ? Number(last.save_count || 0)
            : Math.max(0, Number(last.save_count || 0) - Number(first.save_count || 0))

          // Find owner user
          let ownerName = last.username
          let ownerId = null
          for (const [uid, info] of userMap.entries()) {
            if (info.tiktok_username?.toLowerCase().replace(/^@+/, '') === last.username.toLowerCase()) {
              ownerName = info.name
              ownerId = uid
              break
            }
          }

          videos.push({
            platform: 'tiktok',
            video_id: videoId,
            username: last.username,
            owner_name: ownerName,
            owner_id: ownerId,
            post_date: last.post_date,
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
      const instagramUsernames = Array.from(new Set(
        (users || [])
          .map((u: any) => u.instagram_username)
          .filter(Boolean)
          .map((u: string) => u.toLowerCase().replace(/^@+/, ''))
      ))

      // Also get from employee_instagram_participants
      const { data: igParticipants } = await supabase
        .from('employee_instagram_participants')
        .select('instagram_username')
        .in('employee_id', employeeIds)
      
      for (const p of igParticipants || []) {
        if (p.instagram_username) {
          instagramUsernames.push(p.instagram_username.toLowerCase().replace(/^@+/, ''))
        }
      }
      const uniqueIgUsernames = Array.from(new Set(instagramUsernames))

      console.log(`[Top Videos] Instagram: ${uniqueIgUsernames.length} usernames to query: ${uniqueIgUsernames.slice(0, 5).join(', ')}${uniqueIgUsernames.length > 5 ? '...' : ''}`)

      if (uniqueIgUsernames.length > 0) {
        // Query instagram_posts_daily for posts in window
        const { data: igPosts } = await supabase
          .from('instagram_posts_daily')
          .select('id, code, username, post_date, caption, play_count, like_count, comment_count')
          .in('username', uniqueIgUsernames)
          .gte('post_date', startISO)
          .lte('post_date', endISO)
          .order('play_count', { ascending: false })
          .limit(limit * 10) // Get more for hashtag filtering

        console.log(`[Top Videos] Instagram: Found ${igPosts?.length || 0} posts in date range ${startISO} to ${endISO}`)

        // Group by id and calculate accrual
        const videoMap = new Map<string, any[]>()
        for (const post of igPosts || []) {
          const vid = String(post.id)
          if (!videoMap.has(vid)) videoMap.set(vid, [])
          videoMap.get(vid)!.push(post)
        }

        // Calculate accrual for each post
        for (const [postId, snapshots] of videoMap.entries()) {
          snapshots.sort((a, b) => a.post_date.localeCompare(b.post_date))
          
          const first = snapshots[0]
          const last = snapshots[snapshots.length - 1]
          
          // Filter by hashtag if required
          if (!hasRequiredHashtag(last.caption, requiredHashtags)) {
            continue;
          }
          
          const views = snapshots.length === 1
            ? Number(last.play_count || 0)
            : Math.max(0, Number(last.play_count || 0) - Number(first.play_count || 0))
          const likes = snapshots.length === 1
            ? Number(last.like_count || 0)
            : Math.max(0, Number(last.like_count || 0) - Number(first.like_count || 0))
          const comments = snapshots.length === 1
            ? Number(last.comment_count || 0)
            : Math.max(0, Number(last.comment_count || 0) - Number(first.comment_count || 0))

          // Find owner user
          let ownerName = last.username
          let ownerId = null
          for (const [uid, info] of userMap.entries()) {
            if (info.instagram_username?.toLowerCase().replace(/^@+/, '') === last.username.toLowerCase()) {
              ownerName = info.name
              ownerId = uid
              break
            }
          }

          videos.push({
            platform: 'instagram',
            video_id: postId,
            username: last.username,
            owner_name: ownerName,
            owner_id: ownerId,
            post_date: last.post_date,
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

    // Sort by views descending and limit
    videos.sort((a, b) => b.metrics.views - a.metrics.views);
    const topVideos = videos.slice(0, limit);

    console.log(`[Top Videos] Final: ${videos.length} total videos (TikTok + Instagram), showing top ${topVideos.length}`)
    if (topVideos.length > 0) {
      console.log(`[Top Videos] Top video: ${topVideos[0].platform} @${topVideos[0].username} - ${topVideos[0].metrics.views} views`)
    }

    return NextResponse.json({
      videos: topVideos,
      campaign_id: campaignId || null,
      required_hashtags: requiredHashtags,
      platform,
      start: startISO,
      end: endISO,
      days: windowDays,
      total_found: videos.length,
      showing: topVideos.length,
      filtered_by_hashtag: requiredHashtags && requiredHashtags.length > 0
    });
  } catch (e: any) {
    console.error('[top-videos] error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
