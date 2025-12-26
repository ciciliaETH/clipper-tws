// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// RapidAPI hosts (defaults)
const IG_HOST = Deno.env.get('RAPIDAPI_INSTAGRAM_HOST') || 'instagram120.p.rapidapi.com'
const IG_SCRAPER_HOST = Deno.env.get('RAPIDAPI_IG_SCRAPER_HOST') || 'instagram-scraper-api11.p.rapidapi.com'
// Optional provider (user_id -> reels): instagram-api-fast-reliable-data-scraper
const IG_FAST_HOST = Deno.env.get('RAPIDAPI_IG_FAST_HOST') || ''
// Additional fallback provider (user_id -> feed): instagram-best-experience
const IG_BEST_HOST = Deno.env.get('RAPIDAPI_IG_BEST_HOST') || 'instagram-best-experience.p.rapidapi.com'
// Optional username provider (getreel/{username})
const IG_PROFILE1_HOST = Deno.env.get('RAPIDAPI_IG_PROFILE1_HOST') || 'instagram-profile1.p.rapidapi.com'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// --- RapidAPI key rotation helpers (Deno/Edge compatible) ---
const RAPID_KEYS = (Deno.env.get('RAPID_API_KEYS') || Deno.env.get('RAPIDAPI_KEYS') || Deno.env.get('RAPID_KEY_BACKFILL') || Deno.env.get('RAPIDAPI_KEY') || '')
  .split(',').map(s=>s.trim()).filter(Boolean)
const _cooldownUntil = new Map<number, number>() // index -> epoch ms
function isRateLimitStatus(status: number) { return status === 429 || status === 403 }
function looksLikeQuota(text: string) {
  const t = text.toLowerCase()
  return t.includes('rate limit') || t.includes('quota') || t.includes('exceeded') || t.includes('too many requests')
}
function hashStr(s: string) { let h = 2166136261>>>0; for (let i=0;i<s.length;i++){h^=s.charCodeAt(i); h=Math.imul(h,16777619)} return h>>>0 }
async function fetchRapidJson(url: string, host: string, init: RequestInit & { timeoutMs?: number } = {}) : Promise<any> {
  const keys = RAPID_KEYS
  if (!keys.length) throw new Error('No RapidAPI keys configured (RAPID_API_KEYS)')
  const timeoutMs = init.timeoutMs ?? 20000
  const bucket = Math.floor(Date.now() / (10*60*1000))
  const seed = (bucket + hashStr(url)) >>> 0
  let start = seed % keys.length
  const errs: string[] = []
  const now = Date.now()
  for (let off=0; off<keys.length; off++) {
    const idx = (start + off) % keys.length
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
          ...(init.method==='POST'?{'content-type':'application/json'}:{}),
          'accept':'application/json',
        }
      })
      clearTimeout(timer)
      if (isRateLimitStatus(res.status)) {
        let text=''; try{text=await res.text()}catch{}
        _cooldownUntil.set(idx, Date.now() + 15*60*1000)
        errs.push(`key#${idx+1} limited ${res.status}`)
        continue
      }
      if (!res.ok) {
        const text = await res.text().catch(()=> '')
        if (looksLikeQuota(text)) { _cooldownUntil.set(idx, Date.now()+15*60*1000); errs.push(`key#${idx+1} quota`); continue }
        errs.push(`key#${idx+1} ${res.status}`); continue
      }
      const txt = await res.text(); try { return JSON.parse(txt) } catch { return txt }
    } catch (e) {
      clearTimeout(timer)
      errs.push(`key#${idx+1} ex`); continue
    }
  }
  throw new Error(`All RapidAPI keys failed: ${errs.join(' | ')}`)
}

const sleep = (ms:number)=> new Promise(res=>setTimeout(res, ms))
const normalize = (u: string)=> String(u||'').trim().replace(/^@+/, '').toLowerCase()
const parseMs = (v:any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const n = Number(v); if (!Number.isNaN(n) && n>0) return n>1e12 ? n : n*1000;
    const t = Date.parse(v); if (!Number.isNaN(t)) return t;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.max(1, Math.min(1000, Number(searchParams.get('limit')||'200')))
    const concurrency = Math.max(1, Math.min(10, Number(searchParams.get('concurrency')||'6')))
    const debug = searchParams.get('debug') === '1'

    // Accept body overrides for testing/targeting
    let body: any = null
    try { body = await req.json() } catch {}
    const oneUsername = (searchParams.get('username') || body?.username || '').toString().trim()
    const many = Array.isArray(body?.usernames) ? (body.usernames as any[]).map(x=>String(x||'')).filter(Boolean) : []

    // Build target list
    const set = new Set<string>()
    if (oneUsername) set.add(normalize(oneUsername))
    for (const u of many) set.add(normalize(u))
    if (set.size === 0) {
      // Collect from tables only when no explicit usernames passed
      try { const { data } = await supabase.from('campaign_instagram_participants').select('instagram_username').limit(limit); for (const r of data||[]) if ((r as any).instagram_username) set.add(normalize((r as any).instagram_username)) } catch {}
      try { const { data } = await supabase.from('user_instagram_usernames').select('instagram_username').limit(limit); for (const r of data||[]) if ((r as any).instagram_username) set.add(normalize((r as any).instagram_username)) } catch {}
      try { const { data } = await supabase.from('users').select('instagram_username').not('instagram_username','is',null).limit(limit); for (const r of data||[]) if ((r as any).instagram_username) set.add(normalize((r as any).instagram_username)) } catch {}
    }

    const users = Array.from(set).slice(0, limit)
    if (!users.length) return new Response(JSON.stringify({ processed:0, results:[] }), { headers:{'Content-Type':'application/json'} })

    const results:any[] = []

    for (let i=0; i<users.length; i+=concurrency) {
      const batch = users.slice(i, i+concurrency)
      const settled = await Promise.allSettled(batch.map(async (u) => {
        const telemetry: any = { username: u, tried: [] as string[], counts: {} as Record<string,number>, errors: [] as string[] }
        // Strict: Resolve user_id first; optional username fallbacks gated by env
        let edges: any[] = []
        {
          try {
            // First: check cached mapping table instagram_user_ids
            let userId: string | undefined
            try {
              const { data: cached } = await supabase.from('instagram_user_ids').select('instagram_user_id').eq('instagram_username', u).maybeSingle();
              if (cached?.instagram_user_id) {
                userId = String(cached.instagram_user_id)
                telemetry.tried.push('db:cache:found'); telemetry.counts['db:cache'] = 1
              }
            } catch (e:any) { /* ignore cache errors */ }

            // Try scraper link endpoint to resolve and persist user_id (requested flow)
            if (!userId) {
              try {
                const link = encodeURIComponent(`https://www.instagram.com/${u}`)
                const url = `https://${IG_SCRAPER_HOST}/get_instagram_user_id?link=${link}`
                const j = await fetchRapidJson(url, IG_SCRAPER_HOST, { timeoutMs: 15000 })
                const pk = j?.user_id || j?.id || j?.data?.user_id || j?.data?.id
                if (pk) {
                  userId = String(pk)
                  try { await supabase.from('instagram_user_ids').upsert({ instagram_username: u, instagram_user_id: userId, created_at: new Date().toISOString() }, { onConflict: 'instagram_username' }) } catch {}
                  telemetry.tried.push('scraper:resolve:link')
                }
              } catch (e:any) { telemetry.errors.push(`scraper:resolve link ${String(e?.message||e)}`) }
            }

            // resolve user id via multiple endpoints (only if not cached)
            const candidates = [
              `https://${IG_HOST}/api/instagram/user?username=${encodeURIComponent(u)}`,
              `https://${IG_HOST}/api/instagram/userinfo?username=${encodeURIComponent(u)}`,
              `https://${IG_HOST}/api/instagram/username?username=${encodeURIComponent(u)}`,
            ]
            
            for (const url of candidates) {
              try {
                const ij = await fetchRapidJson(url, IG_HOST, { timeoutMs: 15000 })
                const cand = ij?.result?.user || ij?.user || ij?.result || {}
                const pk = cand?.pk || cand?.id || cand?.pk_id || ij?.result?.pk || ij?.result?.id
                if (pk) { userId = String(pk); break }
              } catch (e:any) { telemetry.errors.push(`host:resolve uname ${String(e?.message||e)}`) }
            }
            if (userId) {
              try { await supabase.from('instagram_user_ids').upsert({ instagram_username: u, instagram_user_id: String(userId), created_at: new Date().toISOString() }, { onConflict: 'instagram_username' }) } catch {}
            }
            // Try alternate scraper endpoints to resolve user_id if still missing
            if (!userId) {
              const alt = [
                `https://${IG_SCRAPER_HOST}/get_instagram_user_id?link=${encodeURIComponent(`https://www.instagram.com/${u}`)}`,
                `https://${IG_SCRAPER_HOST}/get_user_id?user_name=${encodeURIComponent(u)}`,
                `https://${IG_SCRAPER_HOST}/get_user_id_from_username?user_name=${encodeURIComponent(u)}`,
                `https://${IG_SCRAPER_HOST}/get_instagram_user_id_from_username?username=${encodeURIComponent(u)}`,
                `https://${IG_SCRAPER_HOST}/get_instagram_profile_info?username=${encodeURIComponent(u)}`,
                `https://${IG_SCRAPER_HOST}/get_instagram_profile_details?username=${encodeURIComponent(u)}`,
              ]
              for (const url of alt) {
                try {
                  const j = await fetchRapidJson(url, IG_SCRAPER_HOST, { timeoutMs: 15000 })
                  const pk = j?.user_id || j?.id || j?.data?.user_id || j?.data?.id || j?.data?.user?.id || j?.user?.id
                  if (pk) { userId = String(pk); break }
                } catch (e:any) { telemetry.errors.push(`scraper:resolve uname ${String(e?.message||e)}`) }
              }
            }
            if (userId) {
              // Persist mapping for future runs (best-effort)
              try {
                await supabase.from('instagram_user_ids').upsert({ instagram_username: u, instagram_user_id: String(userId), created_at: new Date().toISOString() }, { onConflict: 'instagram_username' })
                telemetry.tried.push('db:cache:upsert')
              } catch (e:any) { /* ignore DB upsert errors */ }
              // 2a) Try Fast Reliable Data Scraper host (if configured)
              if (IG_FAST_HOST && (!Array.isArray(edges) || edges.length === 0)) {
                try {
                  const fr = await fetchRapidJson(`https://${IG_FAST_HOST}/reels?user_id=${encodeURIComponent(userId)}&include_feed_video=true`, IG_FAST_HOST, { timeoutMs: 20000 })
                  const items: any[] = Array.isArray(fr?.data?.items) ? fr.data.items : (Array.isArray(fr?.items) ? fr.items : [])
                  if (Array.isArray(items) && items.length) {
                    edges = items.map((it:any)=> ({ media: it?.media || it }))
                    telemetry.tried.push('fast:reels:user_id'); telemetry.counts['fast:reels:user_id'] = items.length
                  }
                } catch (e:any) { telemetry.errors.push(`fast:reels ${String(e?.message||e)}`) }
              }

              // 2b) Try scraper host generic reels-by-id
              const sj = await fetchRapidJson(`https://${IG_SCRAPER_HOST}/get_instagram_reels_details_from_id?user_id=${encodeURIComponent(userId)}`, IG_SCRAPER_HOST, { timeoutMs: 20000 })
              const reels: any[] = (sj?.data?.reels || sj?.reels || sj?.data?.items || sj?.items || []) as any[]
              // transform reels into edge-like entries
              edges = reels.map((it:any)=>({ media: it }))
              telemetry.tried.push('scraper:reels:user_id'); telemetry.counts['scraper:reels:user_id'] = Array.isArray(edges)?edges.length:0
              // If still empty, try primary host reels by user id
              if ((!edges || edges.length === 0)) {
                try {
                  const rj = await fetchRapidJson(`https://${IG_HOST}/api/instagram/reels`, IG_HOST, { method:'POST', body: JSON.stringify({ userid: userId, user_id: userId, maxId: '' }), timeoutMs: 20000 })
                  const items = (rj?.result?.edges || rj?.result?.items || rj?.edges || rj?.items || rj?.data?.edges || rj?.data?.items || []) as any[]
                  if (Array.isArray(items) && items.length) edges = items
                  telemetry.tried.push('host:reels:user_id:POST'); telemetry.counts['host:reels:user_id:POST'] = Array.isArray(items)?items.length:0
                } catch (e:any) { telemetry.errors.push(`host:reels user_id ${String(e?.message||e)}`) }
              }
              // If still empty, try BEST provider feed by user_id and convert to edges
              if ((!edges || edges.length === 0)) {
                try {
                  const bj = await fetchRapidJson(`https://${IG_BEST_HOST}/feed?user_id=${encodeURIComponent(userId)}`, IG_BEST_HOST, { timeoutMs: 20000 })
                  const items: any[] = (bj?.items || bj?.data?.items || bj?.result?.items || (Array.isArray(bj) ? bj : [])) as any[]
                  if (Array.isArray(items) && items.length) {
                    edges = items.map((it:any)=> ({ media: it }))
                    telemetry.tried.push('best:feed:user_id'); telemetry.counts['best:feed:user_id'] = items.length
                  }
                } catch (e:any) { telemetry.errors.push(`best:feed ${String(e?.message||e)}`) }
              }
            }
          } catch (e:any) { telemetry.errors.push(`block:resolve ${String(e?.message||e)}`) }
        }

        let upserts: any[] = []
        const allowUsernameFallback = (Deno.env.get('IG_ALLOW_USERNAME_FALLBACK') === '1')
        const resolveCounts = async (code?: string, id?: string): Promise<{play:number, like:number, comment:number} | null> => {
          const urls: string[] = []
          if (code) {
            urls.push(
              `https://${IG_HOST}/api/instagram/post_info?code=${encodeURIComponent(code)}`,
              `https://${IG_HOST}/api/instagram/media_info?code=${encodeURIComponent(code)}`,
            )
          }
          if (id) {
            urls.push(
              `https://${IG_HOST}/api/instagram/media_info?id=${encodeURIComponent(id)}`,
              `https://${IG_HOST}/api/instagram/post_info?id=${encodeURIComponent(id)}`,
            )
          }
          for (const url of urls) {
            try {
              const j = await fetchRapidJson(url, IG_HOST, { timeoutMs: 20000 })
              const m = j?.result?.items?.[0] || j?.result?.media || j?.result || j?.item || j
              const play = Number(m?.play_count || m?.view_count || m?.video_view_count || 0) || 0
              const like = Number(m?.like_count || m?.edge_liked_by?.count || 0) || 0
              const comment = Number(m?.comment_count || m?.edge_media_to_comment?.count || 0) || 0
              if (play>0 || like>0 || comment>0) return { play, like, comment }
            } catch {}
          }
          return null
        }
        let totals = { views:0, likes:0, comments:0, posts_total:0 }
        for (const e of edges||[]) {
          const node = e?.node || e?.media || e
          const media = node?.media || node
          const id = String(media?.pk || media?.id || media?.code || '')
          if (!id) continue
          const ms = parseMs(media?.taken_at) || parseMs(media?.taken_at_ms) || parseMs(media?.device_timestamp) || parseMs(node?.timestamp) || null
          if (!ms) continue
          const post_date = new Date(ms).toISOString().slice(0,10)
          let play = Number(media?.play_count ?? media?.view_count ?? media?.video_view_count ?? 0) || 0
          let like = Number(media?.like_count ?? media?.edge_liked_by?.count ?? 0) || 0
          let comment = Number(media?.comment_count ?? media?.edge_media_to_comment?.count ?? 0) || 0
          if ((play+like+comment) === 0) {
            const code = String(media?.code || node?.code || '')
            const fixed = await resolveCounts(code || undefined, id)
            if (fixed) { play = fixed.play; like = fixed.like; comment = fixed.comment }
          }
          if ((play+like+comment) === 0) continue
          totals.views += play; totals.likes += like; totals.comments += comment; totals.posts_total += 1
          upserts.push({ id, username: u, post_date, play_count: play, like_count: like, comment_count: comment })
        }

        // Username-based fallbacks (optional)
        if (allowUsernameFallback) {
          // 2c) instagram-profile1 getreel/{username}
          if (upserts.length === 0) {
            try {
              const pj = await fetchRapidJson(`https://${IG_PROFILE1_HOST}/getreel/${encodeURIComponent(u)}`, IG_PROFILE1_HOST, { timeoutMs: 20000 })
              const medias: any[] = (pj?.data?.media || pj?.media || pj?.items || []) as any[]
              for (const m of medias) {
                const id = String(m?.id || m?.shortcode || '')
                if (!id) continue
                const ms = parseMs(m?.timestamp) || parseMs(m?.taken_at)
                if (!ms) continue
                const post_date = new Date(ms).toISOString().slice(0,10)
                let views = Number(m?.video_views || m?.play_count || m?.view_count || m?.video_view_count || 0) || 0
                let likes = Number(m?.like || m?.like_count || 0) || 0
                let comments = Number(m?.comment_count || 0) || 0
                if ((views+likes+comments) === 0) {
                  const fixed = await resolveCounts(m?.shortcode || undefined, id)
                  if (fixed) { views = fixed.play; likes = fixed.like; comments = fixed.comment }
                }
                if ((views+likes+comments) === 0) continue
                totals.views += views; totals.likes += likes; totals.comments += comments; totals.posts_total += 1
                const caption = String(m?.caption?.text || m?.title || '')
                upserts.push({ id, username: u, post_date, play_count: views, like_count: likes, comment_count: comments, caption })
              }
              if (medias?.length) { telemetry.tried.push('profile1:getreel'); telemetry.counts['profile1:getreel'] = medias.length }
            } catch (e:any) { telemetry.errors.push(`profile1:getreel ${String(e?.message||e)}`) }
          }

          // 3) Links fallback (parse reels page links for takenAt & counters)
          if (upserts.length === 0) {
            try {
              const pref = [
                `https://www.instagram.com/${u}/reels/`,
                `https://www.instagram.com/${u}/reels`,
                `https://www.instagram.com/${u}/`
              ]
              let arr: any[] = []
              for (const p of pref) {
                const lj = await fetchRapidJson(`https://${IG_HOST}/api/instagram/links`, IG_HOST, { method:'POST', body: JSON.stringify({ url: p }), timeoutMs: 20000 })
                const tmp: any[] = lj?.urls || lj?.result?.urls || lj?.data || []
                if (Array.isArray(tmp) && tmp.length) { arr = tmp; break }
              }
              for (const it of (Array.isArray(arr) ? arr : [])) {
                const sc = String(it?.shortcode || it?.meta?.shortcode || '')
                const ts = parseMs(it?.takenAt || it?.meta?.takenAt)
                if (!sc || !ts) continue
                const post_date = new Date(ts).toISOString().slice(0,10)
                let views = Number(it?.playCount || it?.viewCount || 0) || 0
                let likes = Number(it?.likeCount || 0) || 0
                let comments = Number(it?.commentCount || 0) || 0
                if ((views+likes+comments) === 0) {
                  const fixed = await resolveCounts(sc)
                  if (fixed) { views = fixed.play; likes = fixed.like; comments = fixed.comment }
                }
                if ((views+likes+comments) === 0) continue
                totals.views += views; totals.likes += likes; totals.comments += comments; totals.posts_total += 1
                const caption = String(it?.caption || it?.meta?.caption || '')
                upserts.push({ id: sc, username: u, post_date, play_count: views, like_count: likes, comment_count: comments, caption })
              }
            } catch {}
          }

          // 3b) Profile root links + detail fetch if reels page gave nothing
          if (upserts.length === 0) {
            try {
              const pref = [
                `https://www.instagram.com/${u}/`,
                `https://instagram.com/${u}/`
              ]
              let arr: any[] = []
              for (const p of pref) {
                const lj = await fetchRapidJson(`https://${IG_HOST}/api/instagram/links`, IG_HOST, { method:'POST', body: JSON.stringify({ url: p }), timeoutMs: 20000 })
                const tmp: any[] = lj?.urls || lj?.result?.urls || lj?.data || []
                if (Array.isArray(tmp) && tmp.length) { arr = tmp; break }
              }
              for (const it of (Array.isArray(arr) ? arr : [])) {
                const sc = String(it?.shortcode || it?.meta?.shortcode || '')
                if (!sc) continue
                let ms = parseMs(it?.takenAt || it?.meta?.takenAt)
                if (!ms) {
                  try {
                    const info = await fetchRapidJson(`https://${IG_HOST}/api/instagram/post_info?code=${encodeURIComponent(sc)}`, IG_HOST, { timeoutMs: 15000 })
                    const m = info?.result?.items?.[0] || info?.result?.media || info?.result || info?.item || info
                    ms = parseMs(m?.taken_at) || parseMs(m?.taken_at_ms)
                    const post_date = ms ? new Date(ms).toISOString().slice(0,10) : null
                    let views = Number(m?.play_count || m?.view_count || m?.video_view_count || 0) || 0
                    let likes = Number(m?.like_count || m?.edge_liked_by?.count || 0) || 0
                    let comments = Number(m?.comment_count || m?.edge_media_to_comment?.count || 0) || 0
                    if ((views+likes+comments) === 0) {
                      const fixed = await resolveCounts(sc)
                      if (fixed) { views = fixed.play; likes = fixed.like; comments = fixed.comment }
                    }
                    if (post_date && (views+likes+comments)>0) {
                      totals.views += views; totals.likes += likes; totals.comments += comments; totals.posts_total += 1
                      const caption = String(m?.caption?.text || m?.title || it?.caption || '')
                      upserts.push({ id: sc, username: u, post_date, play_count: views, like_count: likes, comment_count: comments, caption })
                    }
                  } catch {}
                } else {
                  const post_date = new Date(ms).toISOString().slice(0,10)
                  let views = Number(it?.playCount || it?.viewCount || 0) || 0
                  let likes = Number(it?.likeCount || 0) || 0
                  let comments = Number(it?.commentCount || 0) || 0
                  if ((views+likes+comments) === 0) {
                    const fixed = await resolveCounts(sc)
                    if (fixed) { views = fixed.play; likes = fixed.like; comments = fixed.comment }
                  }
                  if ((views+likes+comments) === 0) continue
                  totals.views += views; totals.likes += likes; totals.comments += comments; totals.posts_total += 1
                  const caption = String(it?.caption || it?.meta?.caption || '')
                  upserts.push({ id: sc, username: u, post_date, play_count: views, like_count: likes, comment_count: comments, caption })
                }
              }
            } catch {}
          }
        }

        if (upserts.length) {
          const chunk = 500
          for (let k=0; k<upserts.length; k+=chunk) {
            const part = upserts.slice(k, k+chunk)
            await supabase.from('instagram_posts_daily').upsert(part, { onConflict: 'id' })
          }
        }
        // Try map to a user_id if exists
        let userId: string | null = null
        try {
          const { data: u1 } = await supabase.from('users').select('id').eq('instagram_username', u).maybeSingle(); if (u1?.id) userId = u1.id
          if (!userId) { const { data: u2 } = await supabase.from('user_instagram_usernames').select('user_id').eq('instagram_username', u).maybeSingle(); if (u2?.user_id) userId = u2.user_id as string }
        } catch {}
        if (userId) {
          try {
            // aggregate from DB across all IG handles for this user over last 60 days
            const handles = new Set<string>()
            try { const { data: urow } = await supabase.from('users').select('instagram_username').eq('id', userId).maybeSingle(); if (urow?.instagram_username) handles.add(String(urow.instagram_username).replace(/^@+/, '').toLowerCase()) } catch {}
            try { const { data: extras } = await supabase.from('user_instagram_usernames').select('instagram_username').eq('user_id', userId); for (const r of extras||[]) handles.add(String((r as any).instagram_username).replace(/^@+/, '').toLowerCase()) } catch {}
            if (handles.size) {
              const list = Array.from(handles)
              const start = new Date(); start.setUTCDate(start.getUTCDate()-59); const startISO = start.toISOString().slice(0,10)
              const { data: rows } = await supabase
                .from('instagram_posts_daily')
                .select('play_count, like_count, comment_count, username, post_date')
                .in('username', list)
                .gte('post_date', startISO)
              const agg = (rows||[]).reduce((a:any,r:any)=>({
                views: a.views + (Number(r.play_count)||0),
                likes: a.likes + (Number(r.like_count)||0),
                comments: a.comments + (Number(r.comment_count)||0),
              }), { views:0, likes:0, comments:0 })
              const nowIso = new Date().toISOString()
              await supabase.from('social_metrics').upsert({ user_id: userId, platform: 'instagram', followers: 0, likes: agg.likes, views: agg.views, comments: agg.comments, shares: 0, saves: 0, last_updated: nowIso }, { onConflict: 'user_id,platform' })
              await supabase.from('social_metrics_history').insert({ user_id: userId, platform: 'instagram', followers: 0, likes: agg.likes, views: agg.views, comments: agg.comments, shares: 0, saves: 0, captured_at: nowIso }).catch(()=>{})
            }
          } catch {}
        }
        return debug ? { username: u, inserted: upserts.length, totals, telemetry } : { username: u, inserted: upserts.length, totals }
      }))
      for (const s of settled) { results.push(s.status==='fulfilled'? s.value : { ok:false, error: String((s as any).reason?.message||'rejected') }) }
      if (i+concurrency < users.length) await sleep(1000)
    }

    return new Response(JSON.stringify({ processed: users.length, results }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
