// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AGGREGATOR_BASE = Deno.env.get('AGGREGATOR_BASE') || 'http://202.10.44.90/api/v1'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const safeInt = (v: any) => Number.parseInt(String(v ?? 0)) || 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function readStat(post: any, key: 'play'|'digg'|'comment'|'share'|'save') {
  const tryKeys: string[] = []
  if (key === 'play') tryKeys.push('playCount','play_count','play','views')
  if (key === 'digg') tryKeys.push('diggCount','likeCount','likes','digg_count')
  if (key === 'comment') tryKeys.push('commentCount','comments','comment_count')
  if (key === 'share') tryKeys.push('shareCount','shares','share_count')
  if (key === 'save') tryKeys.push('saveCount','collectCount','favoriteCount','save_count')
  const sources = [post?.statsV2, post?.stats, post?.statistics, post] as any[]
  for (const src of sources) {
    if (!src) continue
    for (const k of tryKeys) {
      const v = src[k]
      if (v !== undefined && v !== null) return safeInt(v)
    }
  }
  return 0
}

function getQueryParam(url: string, key: string): string | undefined {
  try { const u = new URL(url); const v = u.searchParams.get(key); return v || undefined } catch { return undefined }
}

function deriveVideoId(post: any): string | undefined {
  const direct = post?.id || post?.aweme_id || post?.item_id || post?.video_id || post?.video?.id
  if (direct) return String(direct)
  const urls: string[] = []
  const push = (val: any) => { if (!val) return; if (Array.isArray(val)) urls.push(...val); else urls.push(val) }
  push(post?.urlList); push(post?.video?.urlList); push(post?.playAddr?.urlList)
  for (const u of urls) {
    if (typeof u !== 'string') continue
    const item = getQueryParam(u, 'item_id'); if (item) return item
    const vid = getQueryParam(u, 'video_id'); if (vid) return vid
    const file = getQueryParam(u, 'file_id'); if (file) return file
  }
  return undefined
}

const parseMs = (ts: any): number => {
  if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000
  const n = Number(ts)
  if (!Number.isNaN(n) && n > 0) return n > 1e12 ? n : n * 1000
  return Date.parse(String(ts))
}

async function fetchAggregatorPage(url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' }); if (r.ok) return await r.json().catch(()=>null) } catch {}
    await sleep(250 * (attempt + 1))
  }
  return null
}

async function fetchAllFromAggregator(user: string, startStr?: string | null, endStr?: string | null, perPage = 1000) {
  const out: any[] = []
  const seen = new Set<string>()
  const startBound = startStr ? new Date(startStr + 'T00:00:00Z') : null
  const endBound = endStr ? new Date(endStr + 'T23:59:59Z') : null
  let cursor: string | undefined = undefined
  let sameCursor = 0
  let noNew = 0

  while (true) {
    const url = new URL(`${AGGREGATOR_BASE}/user/posts`)
    url.searchParams.set('username', user)
    url.searchParams.set('count', String(perPage))
    if (startStr) url.searchParams.set('start', startStr)
    if (endStr) url.searchParams.set('end', endStr)
    if (cursor) url.searchParams.set('cursor', cursor)
    const j = await fetchAggregatorPage(url.toString())
    if (!j) break
    const vlist: any[] = Array.isArray(j?.data?.videos) ? j.data.videos : []
    const before = out.length
    let oldest = Number.POSITIVE_INFINITY
    for (const v of vlist) {
      const vid = v.aweme_id || v.video_id || v.id
      const key = String(vid || '')
      if (!key || seen.has(key)) continue
      const ms = parseMs(v.create_time ?? v.createTime ?? v.create_time_utc ?? v.create_date)
      if (!Number.isFinite(ms)) continue
      const d = new Date(ms)
      if (startBound && d < startBound) continue
      if (endBound && d > endBound) continue
      oldest = Math.min(oldest, ms)
      seen.add(key); out.push(v)
    }
    if (out.length === before) noNew += 1; else noNew = 0
    if (noNew >= 3) break
    const apiCursor = j?.data?.cursor ? String(j.data.cursor) : undefined
    const fallback = Number.isFinite(oldest) ? String(Math.max(0, Math.floor(oldest) - 1)) : undefined
    const nextCursor = apiCursor && apiCursor !== cursor ? apiCursor : fallback
    if (!j?.data?.hasMore || !nextCursor) break
    if (cursor && nextCursor === cursor) { sameCursor += 1; if (sameCursor >= 3) break } else sameCursor = 0
    cursor = nextCursor
    await sleep(200)
  }

  // If still small and far past start, sweep 21-day windows backward
  const farPast = startBound && ((Date.now() - startBound.getTime()) > 60*24*60*60*1000)
  if (out.length <= perPage && farPast) {
    const end = endBound ? new Date(endBound) : new Date()
    const start = new Date(startBound!)
    let winEnd = new Date(end)
    let stall = 0
    while (winEnd > start) {
      const winStart = new Date(Math.max(start.getTime(), winEnd.getTime() - 21*24*60*60*1000 + 1))
      const url = new URL(`${AGGREGATOR_BASE}/user/posts`)
      url.searchParams.set('username', user)
      url.searchParams.set('count', String(perPage))
      url.searchParams.set('start', winStart.toISOString().slice(0,10))
      url.searchParams.set('end', winEnd.toISOString().slice(0,10))
      const j = await fetchAggregatorPage(url.toString())
      const vlist: any[] = Array.isArray(j?.data?.videos) ? j.data.videos : []
      const before = out.length
      for (const v of vlist) {
        const vid = v.aweme_id || v.video_id || v.id
        const key = String(vid || '')
        if (!key || seen.has(key)) continue
        const ms = parseMs(v.create_time ?? v.createTime ?? v.create_time_utc ?? v.create_date)
        if (!Number.isFinite(ms)) continue
        const d = new Date(ms)
        if (d < start || d > end) continue
        seen.add(key); out.push(v)
      }
      const added = out.length - before
      stall = added === 0 ? stall + 1 : 0
      if (stall >= 3) break
      winEnd = new Date(winStart.getTime() - 1)
      await sleep(200)
    }
  }
  return out
}

Deno.serve(async (req) => {
  try {
    const { username, start, end, count } = await req.json().catch(() => {
      const u = new URL(req.url)
      return { username: u.searchParams.get('username'), start: u.searchParams.get('start'), end: u.searchParams.get('end'), count: u.searchParams.get('count') }
    })
    if (!username) return new Response(JSON.stringify({ error: 'username required' }), { status: 400 })

    const normalized = String(username).replace(/^@/, '').toLowerCase()
    const perPage = Math.max(50, Math.min(1000, Number(count ?? '1000') || 1000))

    // Ensure user (or create minimal)
    let { data: user } = await supabase
      .from('users')
      .select('id, tiktok_username')
      .eq('tiktok_username', normalized)
      .maybeSingle()
    if (!user) {
      const { data: inserted } = await supabase
        .from('users')
        .insert({ tiktok_username: normalized, username: normalized, role: 'umum', email: `${normalized}@example.com` })
        .select('id, tiktok_username')
        .single()
      user = inserted as any
    }
    const userId = user?.id as string | undefined

    // Fetch from external aggregator (robust pagination + sweep)
    const posts = await fetchAllFromAggregator(normalized, start, end, perPage)

    // Followers best-effort from external user info
    let followers = 0
    try {
      const infoUrl = new URL(`${AGGREGATOR_BASE}/user/info`)
      infoUrl.searchParams.set('username', normalized)
      const infoRes = await fetch(infoUrl.toString(), { headers: { Accept: 'application/json' }, cache: 'no-store' })
      if (infoRes.ok) {
        const info = await infoRes.json().catch(()=>null)
        followers = safeInt(info?.data?.stats?.followerCount)
      }
    } catch {}

    const minDate = start ? new Date(String(start)) : new Date(Date.now() - 90*24*60*60*1000)
    const maxDate = end ? new Date(String(end)) : undefined

    // Upsert deduped posts
    const seen = new Set<string>()
    let views = 0, likes = 0, comments = 0, shares = 0, saves = 0, total = 0
    for (const post of Array.isArray(posts) ? posts : []) {
      const ms = parseMs(post.create_time ?? post.createTime ?? post.create_time_utc ?? post.create_date)
      if (!Number.isFinite(ms)) continue
      const d = new Date(ms)
      if (d < minDate) continue
      if (maxDate && d > maxDate) continue

      const videoId = deriveVideoId(post)
      if (!videoId || seen.has(videoId)) continue
      seen.add(videoId)

      const row = {
        video_id: String(videoId),
        username: normalized,
        sec_uid: null as any,
        taken_at: d.toISOString(),
        comment_count: readStat(post,'comment'),
        play_count: readStat(post,'play'),
        share_count: readStat(post,'share'),
        digg_count: readStat(post,'digg'),
        save_count: readStat(post,'save'),
      }
      const { error: upErr } = await supabase.from('tiktok_posts_daily').upsert(row, { onConflict: 'video_id' })
      if (upErr) console.warn('[tiktok_fetch] upsert warn:', upErr.message)
      views += row.play_count; likes += row.digg_count; comments += row.comment_count; shares += row.share_count; saves += row.save_count; total += 1
    }

    if (userId) {
      await supabase.from('social_metrics').upsert({ user_id: userId, platform: 'tiktok', followers, likes, views, comments, shares, saves, last_updated: new Date().toISOString() }, { onConflict: 'user_id,platform' })
      await supabase.from('social_metrics_history').insert({ user_id: userId, platform: 'tiktok', followers, likes, views, comments, shares, saves, captured_at: new Date().toISOString() }).catch(()=>{})
    }

    return new Response(JSON.stringify({ ok: true, username: normalized, followers, views, likes, comments, shares, saves, posts_total: total, source: 'external', mode: 'aggregator' }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
