import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST() {
  const supabase = supabaseAdmin()
  const AGGREGATOR = process.env.AGGREGATOR_BASE_URL || 'http://202.10.44.90/api/v1'

  // Get all KOL videos
  const { data: kolVideos, error } = await supabase
    .from('kol_videos')
    .select('*')
    .order('last_updated', { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!kolVideos || kolVideos.length === 0) return NextResponse.json({ message: 'No KOL videos to refresh', updated: 0 })

  let updated = 0
  const results: any[] = []

  for (const kol of kolVideos) {
    try {
      let metrics: any = null

      if (kol.platform === 'tiktok' && kol.video_id) {
        // Try DB first
        const { data } = await supabase
          .from('tiktok_posts_daily')
          .select('play_count, digg_count, comment_count, share_count, title, username')
          .eq('video_id', kol.video_id)
          .order('play_count', { ascending: false })
          .limit(1)
        if (data?.[0]) {
          const r = data[0]
          metrics = { views: Number(r.play_count||0), likes: Number(r.digg_count||0), comments: Number(r.comment_count||0), shares: Number(r.share_count||0), title: r.title, username: r.username }
        } else {
          // Try aggregator
          try {
            const res = await fetch(`${AGGREGATOR}/video/info?video_id=${kol.video_id}`, { signal: AbortSignal.timeout(10000) })
            if (res.ok) {
              const json = await res.json()
              const v = json?.data || json
              if (v) {
                metrics = {
                  views: Number(v.play_count || v.playCount || 0),
                  likes: Number(v.digg_count || v.diggCount || 0),
                  comments: Number(v.comment_count || v.commentCount || 0),
                  shares: Number(v.share_count || v.shareCount || 0),
                  title: v.title || v.desc || '',
                  username: v.author?.unique_id || '',
                }
              }
            }
          } catch {}
        }
      }

      if (kol.platform === 'instagram' && kol.video_id) {
        const { data } = await supabase
          .from('instagram_posts_daily')
          .select('play_count, like_count, comment_count, caption, username')
          .eq('code', kol.video_id)
          .order('play_count', { ascending: false })
          .limit(1)
        if (data?.[0]) {
          const r = data[0]
          metrics = { views: Number(r.play_count||0), likes: Number(r.like_count||0), comments: Number(r.comment_count||0), shares: 0, title: r.caption, username: r.username }
        }
      }

      if (kol.platform === 'youtube' && kol.video_id) {
        const { data } = await supabase
          .from('youtube_posts_daily')
          .select('views, likes, comments, title, channel_id')
          .eq('video_id', kol.video_id)
          .order('views', { ascending: false })
          .limit(1)
        if (data?.[0]) {
          const r = data[0]
          metrics = { views: Number(r.views||0), likes: Number(r.likes||0), comments: Number(r.comments||0), shares: 0, title: r.title, username: r.channel_id }
        }
      }

      if (metrics) {
        await supabase
          .from('kol_videos')
          .update({
            views: metrics.views,
            likes: metrics.likes,
            comments: metrics.comments,
            shares: metrics.shares,
            title: metrics.title || kol.title,
            username: metrics.username || kol.username,
            last_updated: new Date().toISOString(),
          })
          .eq('id', kol.id)
        updated++
        results.push({ id: kol.id, video_id: kol.video_id, views: metrics.views, status: 'updated' })
      } else {
        results.push({ id: kol.id, video_id: kol.video_id, status: 'no_data' })
      }
    } catch (e: any) {
      results.push({ id: kol.id, video_id: kol.video_id, status: 'error', error: e.message })
    }
  }

  return NextResponse.json({ total: kolVideos.length, updated, results })
}
