import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSSR } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300; // 5 minutes - refreshes all group TikTok participants

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function ensureAdmin() {
  const supabase = await createSSR()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!data) return false
  return (data.role === 'admin' || data.role === 'super_admin')
}

function parseTs(ts: any): Date | null {
  if (ts == null) return null
  if (typeof ts === 'number') {
    const ms = ts > 1e12 ? ts : ts * 1000
    const d = new Date(ms); return isNaN(d.getTime()) ? null : d
  }
  if (typeof ts === 'string') {
    const n = Number(ts)
    if (!Number.isNaN(n) && n > 0) {
      const ms = n > 1e12 ? n : n * 1000
      const d = new Date(ms); return isNaN(d.getTime()) ? null : d
    }
    const d = new Date(ts); return isNaN(d.getTime()) ? null : d
  }
  return null
}

export async function POST(req: Request, context: any) {
  try {
    const { id } = await context.params
    const isAdmin = await ensureAdmin()
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json().catch(()=> ({}))
    const startISO: string | null = body?.start || null
    const endISO: string | null = body?.end || null
    const count = Number(body?.count || 50)

    const supabaseAdmin = adminClient()

    // 1) participants
    const { data: parts, error: pErr } = await supabaseAdmin
      .from('group_participants')
      .select('tiktok_username')
      .eq('group_id', id)
    if (pErr) throw pErr
    const usernames = (parts || []).map(p => String(p.tiktok_username).replace(/^@/, '').toLowerCase()).filter(Boolean)
    if (!usernames.length) return NextResponse.json({ updated: 0, results: [] })

    const minDate = startISO ? new Date(startISO + 'T00:00:00.000Z') : new Date(Date.now() - 90*24*60*60*1000)
    const maxDate = endISO ? new Date(endISO + 'T23:59:59.999Z') : null

    const limit = Number(process.env.GROUP_REFRESH_CONCURRENCY || '4')
    const results: any[] = []

    async function processOne(u: string) {
      try {
        // Primary: external aggregator with pagination by cursor
        const maxPagesEnv = Number(process.env.GROUP_REFRESH_MAX_PAGES || '0')
        const perPage = count
        const allVideos: any[] = []
        const seen = new Set<string>()
        let cursor: string | undefined = undefined
        let page = 0
        let stop = false
        while (!stop) {
          if (maxPagesEnv > 0 && page >= maxPagesEnv) break
          page += 1
          const url = new URL(`http://202.10.44.90/api/v1/user/posts`)
          url.searchParams.set('username', u)
          url.searchParams.set('count', String(perPage))
          if (startISO) url.searchParams.set('start', startISO)
          if (endISO) url.searchParams.set('end', endISO)
          if (cursor) url.searchParams.set('cursor', cursor)
          const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
          if (!res.ok) break
          const j = await res.json().catch(()=>null)
          const pageVideos: any[] = Array.isArray(j?.data?.videos) ? j.data.videos : []
          for (const v of pageVideos) {
            const vid = v.aweme_id || v.video_id || v.id
            const key = String(vid || '')
            if (!key || seen.has(key)) continue
            const ts = v.create_time ?? v.createTime ?? v.create_time_utc ?? v.create_date
            const d = parseTs(ts)
            if (!d) continue
            if (d < minDate) { stop = true; break }
            seen.add(key)
            allVideos.push(v)
          }
          if (stop) break
          const hasMore = !!j?.data?.hasMore
          cursor = j?.data?.cursor ? String(j.data.cursor) : undefined
          if (!hasMore || !cursor) break
        }
        let videos: any[] = allVideos
        // Enrich with TikWM if needed
        videos = await Promise.all(videos.map(async (v: any) => {
          const hasCore = (v.play && v.play_count && (v.aweme_id || v.video_id))
          if (hasCore) return v
          const vid = v.aweme_id || v.video_id
          if (!vid) return v
          const videoUrl = `https://www.tiktok.com/@${encodeURIComponent(u)}/video/${encodeURIComponent(vid)}`
          try {
            const twm = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, { headers: { 'Accept': 'application/json' } })
            if (!twm.ok) return v
            const jj = await twm.json().catch(()=>null)
            if (!jj || jj.code !== 0) return v
            const info = jj.data || {}
            return {
              ...v,
              play: v.play || info.play || v.play,
              play_count: v.play_count || info.play_count || info.views || v.play_count,
              digg_count: v.digg_count || info.like_count || v.digg_count,
              comment_count: v.comment_count || info.comment_count || v.comment_count,
              share_count: v.share_count || info.share_count || v.share_count,
              cover: v.cover || info.cover || v.cover,
            }
          } catch { return v }
        }))

        let views = 0, likes = 0, comments = 0, shares = 0, saves = 0, posts_total = 0
        const toUpsert: any[] = []
        for (const v of videos) {
          const ts = v.create_time ?? v.createTime ?? v.create_time_utc ?? v.create_date
          const d = parseTs(ts)
          if (!d) continue
          if (d < minDate) continue
          if (maxDate && d > maxDate) continue
          const vid = v.aweme_id || v.video_id || v.id
          const vViews = Number(v.play_count || v.views || 0) || 0
          const vLikes = Number(v.digg_count || v.like_count || 0) || 0
          const vComments = Number(v.comment_count || 0) || 0
          const vShares = Number(v.share_count || 0) || 0
          const vSaves = Number(v.collect_count || v.save_count || 0) || 0
          views += vViews; likes += vLikes; comments += vComments; shares += vShares; saves += vSaves; posts_total += 1
          if (vid) {
            toUpsert.push({
              video_id: String(vid),
              username: u,
              sec_uid: null,
              post_date: d.toISOString().slice(0,10),
              play_count: vViews,
              digg_count: vLikes,
              comment_count: vComments,
              share_count: vShares,
              save_count: vSaves,
            })
          }
        }
        let upsertErrors: string[] = []
        if (toUpsert.length) {
          const chunkSize = 500
          for (let i = 0; i < toUpsert.length; i += chunkSize) {
            const chunk = toUpsert.slice(i, i + chunkSize)
            try {
              const { error: upErr } = await supabaseAdmin.from('tiktok_posts_daily').upsert(chunk, { onConflict: 'video_id' })
              if (upErr) upsertErrors.push(upErr.message)
            } catch (e: any) {
              upsertErrors.push(String(e?.message || e))
            }
          }
        }

        // Fetch followers from external user info
        let followers = 0
        try {
          const infoUrl = new URL('http://202.10.44.90/api/v1/user/info')
          infoUrl.searchParams.set('username', u)
          const infoRes = await fetch(infoUrl.toString(), { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
          if (infoRes.ok) {
            const info = await infoRes.json().catch(()=>null)
            followers = Number(info?.data?.stats?.followerCount || 0) || 0
          }
        } catch {}

        // Save snapshot via RPC
        try {
          await supabaseAdmin.rpc('upsert_group_participant_snapshot', {
            p_group_id: id,
            p_tiktok_username: u,
            p_followers: followers,
            p_views: views,
            p_likes: likes,
            p_comments: comments,
            p_shares: shares,
            p_saves: saves,
            p_posts_total: posts_total,
            p_metrics_json: null,
          })
        } catch {}

        return { username: u, ok: true, followers, views, likes, comments, shares, saves, posts_total, upsertErrors }
      } catch (e: any) {
        return { username: u, ok: false, error: String(e?.message || e) }
      }
    }

    for (let i = 0; i < usernames.length; i += limit) {
      const chunk = usernames.slice(i, i + limit)
      const settled = await Promise.allSettled(chunk.map(u => processOne(u)))
      for (const s of settled) results.push(s.status === 'fulfilled' ? s.value : { ok: false, error: String((s as any).reason) })
    }

    return NextResponse.json({ updated: results.length, results })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
