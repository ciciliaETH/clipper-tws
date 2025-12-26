// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Support multi-key rotation
const RAPID_KEYS = (Deno.env.get('RAPID_API_KEYS')
  || Deno.env.get('RAPIDAPI_KEYS')
  || Deno.env.get('RAPID_KEY_BACKFILL')
  || Deno.env.get('RAPIDAPI_KEY')
  || ''
).split(',').map(s=>s.trim()).filter(Boolean)
const RAPIDAPI_TIKTOK_HOST = Deno.env.get('RAPIDAPI_TIKTOK_HOST')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const AGGREGATOR_BASE = Deno.env.get('AGGREGATOR_BASE') || 'http://202.10.44.90/api/v1'

const safe = (v: any) => Number.parseInt(String(v ?? 0)) || 0

// --- RapidAPI key rotation helpers (Deno/Edge compatible) ---
const _cooldownUntil = new Map<number, number>() // index -> epoch ms
function isRateLimitStatus(status: number) { return status === 429 || status === 403 }
function looksLikeQuota(text: string) {
  const t = text.toLowerCase()
  return t.includes('rate limit') || t.includes('quota') || t.includes('exceeded') || t.includes('too many requests')
}
function hashStr(s: string) {
  let h = 2166136261 >>> 0
  for (let i=0; i<s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
async function fetchRapidJson(url: string, host: string, init: RequestInit & { timeoutMs?: number } = {}) : Promise<any> {
  const keys = RAPID_KEYS
  if (!keys.length) throw new Error('No RapidAPI key configured (set RAPID_API_KEYS or RAPIDAPI_KEY)')
  const timeoutMs = init.timeoutMs ?? 20000
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
  const seed = (bucket + hashStr(url)) >>> 0
  let start = seed % keys.length
  const errs: string[] = []
  const now = Date.now()
  for (let offset=0; offset<keys.length; offset++) {
    const idx = (start + offset) % keys.length
    const key = keys[idx]
    const until = _cooldownUntil.get(idx) || 0
    if (until > now) { errs.push(`key#${idx+1} cooldown`); continue }
    const controller = new AbortController()
    const timer = setTimeout(()=>controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers||{}),
          'x-rapidapi-key': key,
          'x-rapidapi-host': host,
          'accept': 'application/json',
          ...(init.method === 'POST' ? { 'content-type':'application/json' } : {}),
        },
      })
      clearTimeout(timer)
      if (isRateLimitStatus(res.status)) {
        let text = ''
        try { text = await res.text() } catch {}
        _cooldownUntil.set(idx, Date.now() + 15*60*1000)
        errs.push(`key#${idx+1} limited ${res.status} ${text.slice(0,120)}`)
        continue
      }
      if (!res.ok) {
        const text = await res.text().catch(()=> '')
        if (looksLikeQuota(text)) { _cooldownUntil.set(idx, Date.now() + 15*60*1000); errs.push(`key#${idx+1} quota ${res.status}`); continue }
        // non-OK: try next key
        errs.push(`key#${idx+1} ${res.status}`)
        continue
      }
      const txt = await res.text()
      try { return JSON.parse(txt) } catch { return txt }
    } catch (e) {
      clearTimeout(timer)
      errs.push(`key#${idx+1} ex`)
      continue
    }
  }
  throw new Error(`All RapidAPI keys failed: ${errs.join(' | ')}`)
}

// Try to read a numeric stat from multiple possible shapes/keys
function readStat(post: any, key: 'play'|'digg'|'comment'|'share'|'save') {
  const tryKeys: string[] = []
  if (key === 'play') tryKeys.push('playCount','play_count','play')
  if (key === 'digg') tryKeys.push('diggCount','likeCount','likes','digg_count')
  if (key === 'comment') tryKeys.push('commentCount','comments','comment_count')
  if (key === 'share') tryKeys.push('shareCount','shares','share_count')
  if (key === 'save') tryKeys.push('saveCount','collectCount','favoriteCount','save_count')

  const sources = [post?.statsV2, post?.stats, post?.statistics, post] as any[]
  for (const src of sources) {
    if (!src) continue
    for (const k of tryKeys) {
      const v = src[k]
      if (v !== undefined && v !== null) return safe(v)
    }
  }
  return 0
}

function getQueryParam(url: string, key: string): string | undefined {
  try {
    const u = new URL(url)
    const v = u.searchParams.get(key)
    return v || undefined
  } catch {
    return undefined
  }
}

function deriveVideoId(post: any): string | undefined {
  const direct = post?.id || post?.aweme_id || post?.item_id || post?.video_id || post?.video?.id
  if (direct) return String(direct)

  const urls: string[] = []
  const push = (val: any) => { if (!val) return; if (Array.isArray(val)) urls.push(...val); else urls.push(val) }
  push(post?.urlList)
  push(post?.video?.urlList)
  push(post?.playAddr?.urlList)

  for (const u of urls) {
    if (typeof u !== 'string') continue
    const item = getQueryParam(u, 'item_id'); if (item) return item
    const vid = getQueryParam(u, 'video_id'); if (vid) return vid
    const file = getQueryParam(u, 'file_id'); if (file) return file
  }
  return undefined
}

Deno.serve(async (req) => {
  try {
    const { username, start, end, rapid } = await req.json().catch(async () => {
      const u = new URL(req.url)
      return { username: u.searchParams.get('username'), start: u.searchParams.get('start'), end: u.searchParams.get('end'), rapid: u.searchParams.get('rapid') }
    })
    if (!username) return new Response(JSON.stringify({ error: 'username required' }), { status: 400 })

    const normalized = String(username).replace(/^@/, '').toLowerCase()

    // 1) Cari user jika ada (jangan paksa buat user baru; beberapa schema butuh id dari auth)
    let { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, tiktok_username, tiktok_sec_uid')
      .eq('tiktok_username', normalized)
      .maybeSingle()

    if (userErr) console.warn('[tiktok-fetch] user query error:', userErr?.message)

    // Jika tidak ada user, lanjutkan tanpa user_id (snapshot campaign tidak butuh user_id)
    const userId = (user?.id as string | undefined) || undefined
    const handleUsername = user?.tiktok_username || normalized
    let secUid = user?.tiktok_sec_uid as string | undefined
    let followers = 0

    // 2) Ambil secUid (best effort). Kalau gagal, lanjut pakai uniqueId
    if (!secUid) {
      try {
        const infoUrl = `https://${RAPIDAPI_TIKTOK_HOST}/api/user/info?uniqueId=${encodeURIComponent(handleUsername)}`
        const infoJson = await fetchRapidJson(infoUrl, RAPIDAPI_TIKTOK_HOST)
        const userInfo = infoJson?.userInfo
        const stats = userInfo?.stats || userInfo?.user?.stats
        secUid = userInfo?.user?.secUid || userInfo?.user?.sec_uid || userInfo?.user?.id
        followers = safe(stats?.followerCount)
        if (secUid) {
          if (userId) await supabase.from('users').update({ tiktok_sec_uid: secUid }).eq('id', userId)
          await supabase.from('tiktok_posts_daily').update({ sec_uid: secUid }).eq('username', normalized).is('sec_uid', null)
        }
      } catch (e) {
        console.warn('[tiktok-fetch] user info fetch fail, continue with uniqueId:', e)
      }
    }

    // Helper: robust external GET
    const getJson = async (url: string) => {
      for (let attempt=0; attempt<3; attempt++) {
        try { const j = await fetchRapidJson(url, RAPIDAPI_TIKTOK_HOST, { timeoutMs: 20000 }); return j } catch {}
        await new Promise(res=>setTimeout(res, 300*(attempt+1)))
      }
      return null
    }

    // Helper: aggregator page fetch with retries
    const fetchAggregatorPage = async (url: string) => {
      for (let attempt=0; attempt<3; attempt++) {
        try {
          const r = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
          if (r.ok) return await r.json().catch(()=>null)
        } catch {}
        await new Promise(res=>setTimeout(res, 250*(attempt+1)))
      }
      return null
    }

    // Full fetch from aggregator with cursor fallback and 21-day time-window sweep
    const fetchAllFromAggregator = async (user: string, startStr?: string | null, endStr?: string | null, perPage = 1000) => {
      const out: any[] = []
      const seen = new Set<string>()
      const startBound = startStr ? new Date(startStr+'T00:00:00Z') : null
      const endBound = endStr ? new Date(endStr+'T23:59:59Z') : null
      let cursor: string | undefined = undefined
      let sameCursor = 0
      let noNew = 0
      const parseMs = (ts: any) => {
        if (typeof ts === 'number') return ts > 1e12 ? ts : ts*1000
        const n = Number(ts); if (!Number.isNaN(n) && n>0) return n > 1e12 ? n : n*1000
        return Date.parse(String(ts))
      }
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
        const fallback = Number.isFinite(oldest) ? String(Math.max(0, Math.floor(oldest)-1)) : undefined
        const next = apiCursor && apiCursor !== cursor ? apiCursor : fallback
        if (!j?.data?.hasMore || !next) break
        if (cursor && next === cursor) { sameCursor += 1; if (sameCursor >= 3) break } else sameCursor = 0
        cursor = next
        await new Promise(res => setTimeout(res, 200))
      }
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
          stall = added === 0 ? stall+1 : 0
          if (stall >= 3) break
          winEnd = new Date(winStart.getTime() - 1)
          await new Promise(res => setTimeout(res, 200))
        }
      }
      return out
    }

    // 3) Ambil posts
    let posts: any[] = []
    let mode: 'aggregator' | 'rapid-continuation' | 'legacy' = 'legacy'
    if (String(rapid||'') !== '1' && String(rapid||'') !== 'true') {
      try {
        posts = await fetchAllFromAggregator(normalized, start, end, 1000)
        // followers from aggregator user info (best effort)
        try {
          const infoUrl = new URL(`${AGGREGATOR_BASE}/user/info`)
          infoUrl.searchParams.set('username', normalized)
          const infoRes = await fetch(infoUrl.toString(), { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
          if (infoRes.ok) {
            const info = await infoRes.json().catch(()=>null)
            followers = followers || safe(info?.data?.stats?.followerCount)
          }
        } catch {}
        mode = 'aggregator'
      } catch (e) {
        console.warn('[tiktok-fetch] aggregator failed, fallback to RapidAPI path:', e)
      }
    }

    if (!Array.isArray(posts) || posts.length === 0) {
      // Rapid paths
      if (String(rapid||'') === '1' || String(rapid||'') === 'true') {
      // RapidAPI v6 style: /user/details -> /user/videos -> /user/videos/continuation
      const detailsUrl = `https://${RAPIDAPI_TIKTOK_HOST}/user/details?username=${encodeURIComponent(handleUsername)}`
      const details = await getJson(detailsUrl)
      const secondaryId = details?.data?.secondary_id || details?.secondary_id || details?.user?.secondary_id
      const firstUrl = `https://${RAPIDAPI_TIKTOK_HOST}/user/videos?username=${encodeURIComponent(handleUsername)}`
      const first = await getJson(firstUrl)
      let token = first?.data?.continuation_token || first?.continuation_token || first?.data?.cursor || first?.cursor
      const firstItems = first?.data?.videos || first?.videos || first?.data?.items || []
      if (Array.isArray(firstItems)) posts.push(...firstItems)
      let advanceGuard = 0
      while (secondaryId && token) {
        mode = 'rapid-continuation'
        const contUrl = `https://${RAPIDAPI_TIKTOK_HOST}/user/videos/continuation?username=${encodeURIComponent(handleUsername)}&secondary_id=${encodeURIComponent(secondaryId)}&continuation_token=${encodeURIComponent(String(token))}`
        const j = await getJson(contUrl)
        const items = j?.data?.videos || j?.videos || j?.data?.items || []
        const next = j?.data?.continuation_token || j?.continuation_token || j?.data?.cursor || j?.cursor
        const before = posts.length
        if (Array.isArray(items)) posts.push(...items)
        if (!next || posts.length === before) advanceGuard += 1; else advanceGuard = 0
        token = next
        if (advanceGuard >= 3) break
        await new Promise(res=>setTimeout(res, 250))
      }
      // followers from details if present
      followers = followers || safe(details?.data?.followerCount || details?.data?.stats?.followerCount || details?.user?.stats?.followerCount)
      } else {
      // Legacy path using secUid/uniqueId
      const postsUrl = secUid
        ? `https://${RAPIDAPI_TIKTOK_HOST}/api/user/posts?secUid=${secUid}`
        : `https://${RAPIDAPI_TIKTOK_HOST}/api/user/posts?uniqueId=${encodeURIComponent(handleUsername)}`

      const postsJson = await getJson(postsUrl)
      const list = postsJson?.aweme_list || postsJson?.data?.aweme_list || postsJson?.data?.itemList || postsJson?.items || []
      if (Array.isArray(list)) posts = list
      followers = followers || safe(postsJson?.authorStats?.followerCount || postsJson?.author?.stats?.followerCount)
      }
    }

  // Process posts from the last 90 days (avoid missing stats due to hard-coded date)
  // Window: honor start/end if provided, else default to last 90 days
  const minDate = start ? new Date(String(start)) : new Date()
  if (!start) minDate.setDate(minDate.getDate() - 90)
  const maxDate = end ? new Date(String(end)) : undefined

    let views = 0, likes = 0, comments = 0, shares = 0, saves = 0, count = 0
    // Dedupe by video id
    const seen = new Set<string>()
    for (const post of Array.isArray(posts) ? posts : []) {
      const ts = post.createTime || post.create_time || post.create_time_utc || post.create_time_local
      if (!ts) continue
      const postDate = new Date(Number(ts) * 1000)
  if (postDate < minDate) continue
  if (maxDate && postDate > maxDate) continue

      const videoId = deriveVideoId(post)
      if (!videoId) continue
      if (seen.has(videoId)) continue
      seen.add(videoId)

      const row = {
        video_id: String(videoId),
        username: normalized,
        sec_uid: secUid,
        post_date: postDate.toISOString().slice(0,10),
        comment_count: readStat(post,'comment'),
        play_count: readStat(post,'play'),
        share_count: readStat(post,'share'),
        digg_count: readStat(post,'digg'),
        save_count: readStat(post,'save'),
        title: String((post as any)?.title || (post as any)?.desc || ''),
      }
      // Upsert per video; jika schema belum siap, log saja agar aggregate tetap tersimpan
      const { error: upErr } = await supabase.from('tiktok_posts_daily').upsert(row, { onConflict: 'video_id' })
      if (upErr) console.warn('[tiktok-fetch] upsert tiktok_posts_daily warn:', upErr.message)
      views += row.play_count; likes += row.digg_count; comments += row.comment_count; shares += row.share_count; saves += row.save_count; count += 1
    }

    // 4) Simpan aggregate + snapshot (selalu jalan)
    if (userId) {
      await supabase.from('social_metrics').upsert({
        user_id: userId, platform: 'tiktok',
        followers, likes, views, comments, shares, saves,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'user_id,platform' })

      await supabase.from('social_metrics_history').insert({
        user_id: userId, platform: 'tiktok',
        followers, likes, views, comments, shares, saves,
        captured_at: new Date().toISOString(),
      })
    }

    return new Response(JSON.stringify({
      ok: true,
      username: normalized,
      secUid: secUid || null,
      followers,
      views,
      likes,
      comments,
      shares,
      saves,
      posts_total: count,
      mode,
      source: mode === 'aggregator' ? 'external' : 'rapidapi',
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
