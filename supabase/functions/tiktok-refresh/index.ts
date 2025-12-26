// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Helper to normalize username
const normalize = (u: string) => String(u || '').trim().replace(/^@+/, '').toLowerCase()

Deno.serve(async (req) => {
  try {
    const { searchParams } = new URL(req.url)
    const includeInactive = searchParams.get('all') === '1'
    const limitParam = parseInt(searchParams.get('limit') ?? '0', 10)
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined
    const concurrency = Math.max(1, Math.min(10, parseInt(searchParams.get('concurrency') ?? '6', 10)))

    // 1) Tentukan list username: peserta dari campaign aktif.
    const today = new Date().toISOString().slice(0, 10)

    // Ambil campaign aktif (start<=today<=end or end null)
    let activeIds: string[] = []
    if (!includeInactive) {
      const { data: camps, error: cErr } = await supabase
        .from('campaigns')
        .select('id, start_date, end_date')
        .lte('start_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`)
      if (cErr) {
        console.warn('[tiktok-refresh] gagal ambil campaigns:', cErr.message)
      } else {
        activeIds = (camps || []).map((c: any) => c.id)
      }
    }

    type Job = { username: string, start?: string | null, end?: string | null, campaign_id?: string }
    const jobs: Job[] = []

    if (activeIds.length) {
      // Load campaigns with windows so we can pass start/end per participant
      const { data: camps, error: ce } = await supabase
        .from('campaigns')
        .select('id,start_date,end_date')
        .in('id', activeIds)
      if (ce) throw ce

      // Map id -> window
      const win = new Map<string, { start: string, end: string | null }>()
      for (const c of camps || []) win.set(c.id, { start: c.start_date, end: c.end_date })

      const { data: parts, error: pErr } = await supabase
        .from('campaign_participants')
        .select('campaign_id,tiktok_username')
        .in('campaign_id', activeIds)
      if (pErr) throw pErr

      for (const p of parts || []) {
        const username = normalize(p.tiktok_username)
        if (!username) continue
  const w = win.get(p.campaign_id)
  jobs.push({ username, start: w?.start ?? null, end: w?.end ?? null, campaign_id: p.campaign_id })
      }
    } else {
      // Fallback: semua user yang punya tiktok_username (tanpa window khusus)
      const { data: users, error: uErr } = await supabase
        .from('users')
        .select('tiktok_username')
        .not('tiktok_username', 'is', null)
      if (uErr) throw uErr
      for (const u of users || []) {
        const username = normalize(u.tiktok_username)
        if (username) jobs.push({ username })
      }
    }

    // Deduplicate by username+window and apply optional limit
    const signature = (j: Job) => `${j.username}|${j.start ?? ''}|${j.end ?? ''}`
    const uniqMap = new Map<string, Job>()
    for (const j of jobs) if (!uniqMap.has(signature(j))) uniqMap.set(signature(j), j)
    const list = Array.from(uniqMap.values())
    const finalList = typeof limit === 'number' ? list.slice(0, limit) : list

    // 2) Panggil edge function tiktok-fetch untuk setiap username dengan batasan paralel
    const fn = Deno.env.get('SUPABASE_FUNCTION_TIKTOK_FETCH') || 'tiktok-fetch'
    const funcUrl = `${SUPABASE_URL}/functions/v1/${fn}`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
    }

    const results: any[] = []

    for (let i = 0; i < finalList.length; i += concurrency) {
      const chunk = finalList.slice(i, i + concurrency)
      const settled = await Promise.allSettled(
        chunk.map(async (job) => {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 20000) // 20s timeout per user
          try {
            const res = await fetch(funcUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ username: job.username, start: job.start, end: job.end, rapid: '1' }),
              signal: controller.signal,
            })
            const json = await res.json().catch(() => ({}))
            if (res.ok && job.campaign_id) {
              // Persist totals directly from tiktok-fetch response (no dependency on tiktok_posts_daily)
              const t = json?.tiktok || json // support both shapes
              await supabase
                .from('campaign_participants')
                .update({
                  followers: Number(t?.followers) || 0,
                  views: Number(t?.views) || 0,
                  likes: Number(t?.likes) || 0,
                  comments: Number(t?.comments) || 0,
                  shares: Number(t?.shares) || 0,
                  saves: Number(t?.saves) || 0,
                  posts_total: Number(t?.posts_total) || null,
                  sec_uid: t?.secUid || null,
                  metrics_json: json,
                  last_refreshed: new Date().toISOString(),
                })
                .eq('campaign_id', job.campaign_id)
                .ilike('tiktok_username', job.username)
            }
            return { username: job.username, ok: res.ok, status: res.status, json }
          } catch (e) {
            return { username: job.username, ok: false, error: String(e) }
          } finally {
            clearTimeout(timeout)
          }
        })
      )
      for (const s of settled) {
        if (s.status === 'fulfilled') results.push(s.value)
        else results.push({ ok: false, error: String(s.reason) })
      }
    }
  return new Response(JSON.stringify({ processed: finalList.length, results }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
