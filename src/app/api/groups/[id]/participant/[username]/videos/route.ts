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
    const { id: campaignId, username } = await context.params
    const supabase = adminClient()

    const url = new URL(req.url)
    const startDate = url.searchParams.get('start')
    const endDate = url.searchParams.get('end')

    // 1. Resolve User ID from the provided username (assuming text matches tiktok_username or alias)
    // Try users table first
    let userId: string | null = null
    const normUser = decodeURIComponent(username).toLowerCase().replace(/^@/,'')
    
    // Check main users table
    const { data: u1 } = await supabase.from('users').select('id')
      .or(`tiktok_username.ilike.${normUser},instagram_username.ilike.${normUser},username.ilike.${normUser}`)
      .maybeSingle()
    if (u1) userId = u1.id
    
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
    let fullName = normUser;
    
    if (userId) {
       const { data: u } = await supabase.from('users').select('full_name, tiktok_username, instagram_username').eq('id', userId).single()
       if (u) {
          if (u.full_name) fullName = u.full_name;
          if (u.tiktok_username) ttHandles.add(u.tiktok_username.toLowerCase().replace(/^@/,''))
          if (u.instagram_username) igHandles.add(u.instagram_username.toLowerCase().replace(/^@/,''))
       }
       
       const { data: tta } = await supabase.from('user_tiktok_usernames').select('tiktok_username').eq('user_id', userId)
       tta?.forEach(x => x.tiktok_username && ttHandles.add(x.tiktok_username.toLowerCase().replace(/^@/,'')))
       
       const { data: iga } = await supabase.from('user_instagram_usernames').select('instagram_username').eq('user_id', userId)
       iga?.forEach(x => x.instagram_username && igHandles.add(x.instagram_username.toLowerCase().replace(/^@/,'')))
    } else {
       // Fallback
       ttHandles.add(normUser)
    }

    // 3. Fetch Videos
    const videos: any[] = []

    // TikTok
    if (ttHandles.size > 0) {
      let q = supabase
        .from('tiktok_posts_daily')
        .select('*')
        .in('username', Array.from(ttHandles));
      
      if (startDate) q = q.gte('taken_at', startDate + 'T00:00:00Z');
      if (endDate) q = q.lte('taken_at', endDate + 'T23:59:59Z');

      const { data: posts } = await q.order('play_count', { ascending: false });
      
      const map = new Map<string, any>()
      for (const p of posts || []) {
        const vid = p.video_id
        // Dedupe: keep max views or just first one since we ordered by play_count desc
        if (!map.has(vid)) {
           map.set(vid, p)
        }
      }
      for (const v of map.values()) {
        videos.push({
           platform: 'tiktok',
           id: v.video_id,
           username: v.username,
           link: `https://www.tiktok.com/@${v.username}/video/${v.video_id}`,
           views: Number(v.play_count)||0,
           likes: Number(v.digg_count)||0,
           comments: Number(v.comment_count)||0,
           shares: Number(v.share_count)||0,
           saves: Number(v.save_count)||0,
           taken_at: v.taken_at,
           title: v.title || ''
        })
      }
    }

    // Instagram
    if (igHandles.size > 0) {
      let q = supabase
        .from('instagram_posts_daily')
        .select('*')
        .in('username', Array.from(igHandles));
        
      if (startDate) q = q.gte('taken_at', startDate + 'T00:00:00Z');
      if (endDate) q = q.lte('taken_at', endDate + 'T23:59:59Z');

      const { data: posts } = await q.order('play_count', { ascending: false });
        
      const map = new Map<string, any>()
      for (const p of posts || []) {
        const vid = p.id || p.code // prefer ID as unique
        if (!map.has(vid)) {
           map.set(vid, p)
        }
      }
      for (const v of map.values()) {
        videos.push({
           platform: 'instagram',
           id: v.id,
           username: v.username,
           link: `https://www.instagram.com/reel/${v.code}/`,
           views: Number(v.play_count)||0,
           likes: Number(v.like_count)||0,
           comments: Number(v.comment_count)||0,
           shares: 0, 
           saves: 0,
           taken_at: v.taken_at,
           caption: v.caption || ''
        })
      }
    }

    // Sort by date desc (taken_at)
    videos.sort((a,b) => {
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
