import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSSR } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Extract platform, video_id, username from URL
// Resolve short URLs (vt.tiktok.com, bit.ly, etc.) by following redirects
async function resolveShortUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) })
    return res.url || url
  } catch {
    // Fallback: try GET with redirect follow
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) })
      return res.url || url
    } catch {
      return url
    }
  }
}

function parseVideoUrl(url: string): { platform: string; video_id: string; username: string } | null {
  try {
    // TikTok: https://www.tiktok.com/@username/video/1234567890
    const ttMatch = url.match(/tiktok\.com\/@([^/]+)\/video\/(\d+)/)
    if (ttMatch) return { platform: 'tiktok', username: ttMatch[1], video_id: ttMatch[2] }

    // TikTok short URL (will be resolved before calling this)
    if (url.includes('tiktok.com')) return { platform: 'tiktok', username: '', video_id: '' }

    // Instagram: https://www.instagram.com/reel/CODE/ or /p/CODE/
    const igMatch = url.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/)
    if (igMatch) return { platform: 'instagram', username: '', video_id: igMatch[1] }

    // YouTube: https://www.youtube.com/shorts/VIDEO_ID or watch?v=VIDEO_ID
    const ytShortsMatch = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)
    if (ytShortsMatch) return { platform: 'youtube', username: '', video_id: ytShortsMatch[1] }
    const ytWatchMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/)
    if (ytWatchMatch) return { platform: 'youtube', username: '', video_id: ytWatchMatch[1] }

    return null
  } catch {
    return null
  }
}

// Fetch video metrics from aggregator/database
async function fetchVideoMetrics(platform: string, videoId: string, username: string) {
  const supabase = supabaseAdmin()

  if (platform === 'tiktok' && videoId) {
    // Check tiktok_posts_daily
    const { data } = await supabase
      .from('tiktok_posts_daily')
      .select('video_id, username, title, play_count, digg_count, comment_count, share_count, taken_at')
      .eq('video_id', videoId)
      .order('play_count', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      const r = data[0]
      return {
        title: r.title || '',
        username: r.username || username,
        views: Number(r.play_count || 0),
        likes: Number(r.digg_count || 0),
        comments: Number(r.comment_count || 0),
        shares: Number(r.share_count || 0),
      }
    }

    // Try aggregator API for single video
    try {
      const AGGREGATOR = process.env.AGGREGATOR_BASE_URL || 'http://202.10.44.90/api/v1'
      const res = await fetch(`${AGGREGATOR}/video/info?video_id=${videoId}`, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const json = await res.json()
        const v = json?.data || json
        if (v) {
          return {
            title: v.title || v.desc || '',
            username: v.author?.unique_id || v.username || username,
            views: Number(v.play_count || v.playCount || 0),
            likes: Number(v.digg_count || v.diggCount || 0),
            comments: Number(v.comment_count || v.commentCount || 0),
            shares: Number(v.share_count || v.shareCount || 0),
          }
        }
      }
    } catch {}
  }

  if (platform === 'instagram' && videoId) {
    // videoId is the shortcode (code)
    const { data } = await supabase
      .from('instagram_posts_daily')
      .select('id, code, username, caption, play_count, like_count, comment_count, taken_at')
      .eq('code', videoId)
      .order('play_count', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      const r = data[0]
      return {
        title: r.caption || '',
        username: r.username || username,
        views: Number(r.play_count || 0),
        likes: Number(r.like_count || 0),
        comments: Number(r.comment_count || 0),
        shares: 0,
      }
    }
  }

  if (platform === 'youtube' && videoId) {
    const { data } = await supabase
      .from('youtube_posts_daily')
      .select('video_id, channel_id, title, views, likes, comments, post_date')
      .eq('video_id', videoId)
      .order('views', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      const r = data[0]
      return {
        title: r.title || '',
        username: r.channel_id || username,
        views: Number(r.views || 0),
        likes: Number(r.likes || 0),
        comments: Number(r.comments || 0),
        shares: 0,
      }
    }
  }

  return null
}

// GET: list KOL videos (optionally by campaign)
export async function GET(req: Request) {
  const supabase = supabaseAdmin()
  const url = new URL(req.url)
  const campaignId = url.searchParams.get('campaign_id')

  let query = supabase
    .from('kol_videos')
    .select('*')
    .order('views', { ascending: false })

  if (campaignId) query = query.eq('campaign_id', campaignId)

  const { data, error } = await query.limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data || [])
}

// POST: add a new KOL video by URL
export async function POST(req: Request) {
  // Auth check
  const ssrClient = await createSSR()
  const { data: { user } } = await ssrClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { video_url, campaign_id } = body
  if (!video_url) return NextResponse.json({ error: 'video_url is required' }, { status: 400 })

  // Resolve short URLs (vt.tiktok.com, bit.ly, etc.)
  let resolvedUrl = video_url.trim()
  const isShortUrl = /^https?:\/\/(vt\.tiktok|vm\.tiktok|bit\.ly|t\.co|tinyurl)/.test(resolvedUrl)
  if (isShortUrl) {
    resolvedUrl = await resolveShortUrl(resolvedUrl)
    console.log(`[KOL] Resolved short URL: ${video_url} → ${resolvedUrl}`)
  }

  // Parse URL (use resolved URL for parsing, keep original for storage)
  const parsed = parseVideoUrl(resolvedUrl)
  if (!parsed) return NextResponse.json({ error: 'Could not parse video URL. Supported: TikTok, Instagram, YouTube' }, { status: 400 })

  // Fetch metrics
  const metrics = await fetchVideoMetrics(parsed.platform, parsed.video_id, parsed.username)

  const supabase = supabaseAdmin()

  const record: any = {
    video_url: resolvedUrl, // Store the full resolved URL
    platform: parsed.platform,
    video_id: parsed.video_id,
    username: metrics?.username || parsed.username || '',
    title: metrics?.title || '',
    views: metrics?.views || 0,
    likes: metrics?.likes || 0,
    comments: metrics?.comments || 0,
    shares: metrics?.shares || 0,
    added_by: user.id,
    last_updated: new Date().toISOString(),
  }
  if (campaign_id) record.campaign_id = campaign_id

  const { data, error } = await supabase
    .from('kol_videos')
    .upsert(record, { onConflict: 'video_url' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// DELETE: remove a KOL video
export async function DELETE(req: Request) {
  const ssrClient = await createSSR()
  const { data: { user } } = await ssrClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = supabaseAdmin()
  const { error } = await supabase.from('kol_videos').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
