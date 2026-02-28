import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(req: Request, context: any) {
  try {
    const { username } = await context.params
    const supabase = adminClient()

    const url = new URL(req.url)
    const startDate = url.searchParams.get('start')
    const endDate = url.searchParams.get('end')
    const platform = (url.searchParams.get('platform') || 'all').toLowerCase()
    const hashtag = (url.searchParams.get('hashtag') || '').trim()

    // 1. Resolve User ID from the provided username
    const normUser = decodeURIComponent(username).toLowerCase().replace(/^@/, '')

    let userId: string | null = null
    let foundFullName: string | null = null

    const { data: u1 } = await supabase.from('users').select('id, full_name')
      .or(`tiktok_username.eq.${normUser},tiktok_username.eq.@${normUser},instagram_username.eq.${normUser},instagram_username.eq.@${normUser},username.eq.${normUser},full_name.ilike.${normUser}`)
      .maybeSingle()

    if (u1) {
      userId = u1.id
      foundFullName = u1.full_name
    } else {
      const { data: u2 } = await supabase.from('users').select('id, full_name')
        .or(`tiktok_username.ilike.${normUser},tiktok_username.ilike.@${normUser},instagram_username.ilike.${normUser},instagram_username.ilike.@${normUser},username.ilike.${normUser},full_name.ilike.${normUser}`)
        .maybeSingle()
      if (u2) {
        userId = u2.id
        foundFullName = u2.full_name
      }
    }

    // Check aliases if not found
    if (!userId) {
      const { data: a1 } = await supabase.from('user_tiktok_usernames').select('user_id').ilike('tiktok_username', normUser).maybeSingle()
      if (a1) userId = a1.user_id
      if (!userId) {
        const { data: a2 } = await supabase.from('user_instagram_usernames').select('user_id').ilike('instagram_username', normUser).maybeSingle()
        if (a2) userId = a2.user_id
      }
    }

    // 2. Collect all handles
    const ttHandles = new Set<string>()
    const igHandles = new Set<string>()
    const ytChannels = new Set<string>()
    let ytHandle: string | null = null
    let fullName = foundFullName || normUser

    if (userId) {
      const { data: u } = await supabase.from('users').select('full_name, tiktok_username, instagram_username, youtube_channel_id').eq('id', userId).single()
      if (u) {
        if (u.full_name) fullName = u.full_name
        if (u.tiktok_username) ttHandles.add(u.tiktok_username.toLowerCase().replace(/^@/, ''))
        if (u.instagram_username) igHandles.add(u.instagram_username.toLowerCase().replace(/^@/, ''))
        if ((u as any).youtube_channel_id) ytChannels.add(String((u as any).youtube_channel_id).trim())
      }

      const { data: tta } = await supabase.from('user_tiktok_usernames').select('tiktok_username').eq('user_id', userId)
      tta?.forEach(x => x.tiktok_username && ttHandles.add(x.tiktok_username.toLowerCase().replace(/^@/, '')))

      const { data: iga } = await supabase.from('user_instagram_usernames').select('instagram_username').eq('user_id', userId)
      iga?.forEach(x => x.instagram_username && igHandles.add(x.instagram_username.toLowerCase().replace(/^@/, '')))

      const { data: ytc } = await supabase.from('user_youtube_channels').select('youtube_channel_id').eq('user_id', userId)
      ytc?.forEach(x => x.youtube_channel_id && ytChannels.add(String((x as any).youtube_channel_id).trim()))

      // Also pull from all campaigns (not scoped to a single campaign)
      const { data: yte } = await supabase.from('employee_youtube_participants').select('youtube_channel_id').eq('employee_id', userId)
      yte?.forEach(x => x.youtube_channel_id && ytChannels.add(String((x as any).youtube_channel_id).trim()))

      try {
        const { data: yh } = await supabase.from('user_youtube_usernames').select('youtube_username').eq('user_id', userId).maybeSingle()
        if (yh && (yh as any).youtube_username) {
          ytHandle = String((yh as any).youtube_username).trim().replace(/^@/, '')
        }
      } catch {}
    } else {
      ttHandles.add(normUser)
    }

    // 3. Fetch Videos
    const videos: any[] = []

    // TikTok
    if ((platform === 'all' || platform === 'tiktok') && ttHandles.size > 0) {
      let q = supabase
        .from('tiktok_posts_daily')
        .select('*')
        .in('username', Array.from(ttHandles))
      if (startDate) q = q.gte('taken_at', startDate + 'T00:00:00Z')
      if (endDate) q = q.lte('taken_at', endDate + 'T23:59:59Z')
      if (hashtag) q = q.ilike('title', `%${hashtag}%`)
      const { data: posts } = await q.order('play_count', { ascending: false })

      const map = new Map<string, any>()
      for (const p of posts || []) {
        if (!map.has(p.video_id)) map.set(p.video_id, p)
      }
      for (const v of map.values()) {
        videos.push({
          platform: 'tiktok',
          id: v.video_id,
          username: v.username,
          link: `https://www.tiktok.com/@${v.username}/video/${v.video_id}`,
          views: Number(v.play_count) || 0,
          likes: Number(v.digg_count) || 0,
          comments: Number(v.comment_count) || 0,
          shares: Number(v.share_count) || 0,
          saves: Number(v.save_count) || 0,
          taken_at: v.taken_at,
          title: v.title || ''
        })
      }
    }

    // Instagram
    if ((platform === 'all' || platform === 'instagram') && igHandles.size > 0) {
      let q = supabase
        .from('instagram_posts_daily')
        .select('*')
        .in('username', Array.from(igHandles))
      if (startDate) q = q.gte('taken_at', startDate + 'T00:00:00Z')
      if (endDate) q = q.lte('taken_at', endDate + 'T23:59:59Z')
      if (hashtag) q = q.ilike('caption', `%${hashtag}%`)
      const { data: posts } = await q.order('play_count', { ascending: false })

      const map = new Map<string, any>()
      for (const p of posts || []) {
        const vid = p.id || p.code
        if (!map.has(vid)) map.set(vid, p)
      }
      for (const v of map.values()) {
        videos.push({
          platform: 'instagram',
          id: v.id,
          username: v.username,
          link: `https://www.instagram.com/reel/${v.code}/`,
          views: Number(v.play_count) || 0,
          likes: Number(v.like_count) || 0,
          comments: Number(v.comment_count) || 0,
          shares: 0,
          saves: 0,
          taken_at: v.taken_at,
          caption: v.caption || ''
        })
      }
    }

    // YouTube
    if ((platform === 'all' || platform === 'youtube') && ytChannels.size > 0) {
      let q = supabase
        .from('youtube_posts_daily')
        .select('*')
        .in('channel_id', Array.from(ytChannels))
      if (startDate) q = q.gte('post_date', startDate)
      if (endDate) q = q.lte('post_date', endDate)
      if (hashtag) q = q.ilike('title', `%${hashtag}%`)
      const { data: posts } = await q.order('views', { ascending: false })

      const map = new Map<string, any>()
      for (const p of posts || []) {
        const vid = (p as any).video_id || (p as any).id
        if (!map.has(vid)) map.set(vid, p)
      }
      for (const v of map.values()) {
        const vid = (v as any).video_id || (v as any).id
        videos.push({
          platform: 'youtube',
          id: vid,
          username: ytHandle || (v.channel_id?.toString()?.replace(/^@/, '') || ''),
          link: `https://www.youtube.com/shorts/${vid}`,
          views: Number(v.views) || 0,
          likes: Number(v.likes) || 0,
          comments: Number(v.comments) || 0,
          shares: 0,
          saves: 0,
          taken_at: v.post_date ? new Date(v.post_date + 'T00:00:00Z').toISOString() : null,
          title: v.title || ''
        })
      }
    }

    // Sort by date desc
    videos.sort((a, b) => {
      const dA = a.taken_at ? new Date(a.taken_at).getTime() : 0
      const dB = b.taken_at ? new Date(b.taken_at).getTime() : 0
      return dB - dA
    })

    return NextResponse.json({
      username,
      fullName,
      userId,
      count: videos.length,
      videos
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
