import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSSR } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300; // 5 minutes - backfills historical posts data

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
  return data?.role === 'admin' || data?.role === 'super_admin'
}

// Simple async pool
async function asyncPool<T, R>(items: T[], limit: number, worker: (t: T, idx: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = []
  const executing: Promise<void>[] = []
  let i = 0
  const enqueue = () => {
    if (i >= items.length) return
    const idx = i++
    const p = worker(items[idx], idx)
      .then((r) => { ret[idx] = r as any })
      .catch((e) => { (ret as any)[idx] = { error: String(e?.message || e) } })
      .then(() => { executing.splice(executing.indexOf(p as any), 1) }) as any
    executing.push(p as any)
    if (executing.length < limit) enqueue()
  }
  for (let k = 0; k < Math.min(limit, items.length); k++) enqueue()
  await Promise.all(executing)
  // drain
  while (i < items.length) {
    enqueue()
    await Promise.race(executing)
  }
  await Promise.all(executing)
  return ret
}

function monthChunks(startISO: string, endISO: string): Array<{ start: string, end: string }> {
  const out: Array<{ start: string, end: string }> = []
  const s = new Date(startISO + 'T00:00:00Z')
  const e = new Date(endISO + 'T23:59:59Z')
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1))
  while (d <= e) {
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    const start = new Date(Date.UTC(y, m, 1))
    const end = new Date(Date.UTC(y, m + 1, 0))
    const startStr = start.toISOString().slice(0,10)
    const endStr = end.toISOString().slice(0,10)
    out.push({ start: startStr, end: endStr })
    d.setUTCMonth(m + 1)
  }
  return out
}

export async function POST(req: Request) {
  try {
    // Allow either Admin session or Bearer CRON_SECRET token
    let authorized = await ensureAdmin()
    if (!authorized) {
      const auth = req.headers.get('authorization') || ''
      const token = auth.replace(/^Bearer\s+/i, '')
      const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
      if (token && cronSecret && token === cronSecret) authorized = true
    }
    if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = adminClient()
    const body = await req.json().catch(()=> ({}))
    const start = String(body?.start || '') || null
    const end = String(body?.end || '') || null
    const useGroups = body?.groups !== false
    const useCampaigns = body?.campaigns !== false
    const inputUsernames: string[] = Array.isArray(body?.usernames) ? body.usernames : []
    const inputIGUsernames: string[] = Array.isArray(body?.instagram_usernames) ? body.instagram_usernames : []
    const limit = Number(process.env.FULL_BACKFILL_CONCURRENCY || body?.concurrency || 4)
    const igCleanupToday = (body?.ig_cleanup_today ?? (process.env.BACKFILL_IG_CLEANUP_TODAY === '1')) || false
    // Default: single unlimited paging (faster, lebih stabil jika API abaikan start/end)
    const chunkMonthly: boolean = (body?.chunkMonthly ?? (process.env.BACKFILL_CHUNK_MONTHLY === '1')) || false

    // Default to "all-time" window when not provided to force time-window sweep
    const todayISO = new Date().toISOString().slice(0,10)
    const defaultStart = process.env.BACKFILL_DEFAULT_START || '2025-02-01'
    const effStart = start || defaultStart
    const effEnd = end || todayISO

    // Gather usernames from DB
    const set = new Set<string>()
    inputUsernames.forEach(u => { if (u) set.add(String(u).replace(/^@/, '').toLowerCase()) })
    if (useGroups) {
      const { data: gp } = await supabase.from('group_participants').select('tiktok_username')
      for (const r of gp || []) set.add(String(r.tiktok_username).replace(/^@/, '').toLowerCase())
    }
    if (useCampaigns) {
      const { data: cp } = await supabase.from('campaign_participants').select('tiktok_username')
      for (const r of cp || []) set.add(String(r.tiktok_username).replace(/^@/, '').toLowerCase())
    }
    const usernames = Array.from(set).filter(Boolean)
    if (!usernames.length) return NextResponse.json({ updated: 0, results: [], message: 'No usernames found' })

    // Collect Instagram usernames: input + all campaigns ig participants (optional)
    const setIG = new Set<string>()
    inputIGUsernames.forEach(u => { if (u) setIG.add(String(u).replace(/^@/, '').toLowerCase()) })
    if (useCampaigns) {
      try {
        const { data: igp } = await supabase.from('campaign_instagram_participants').select('instagram_username')
        for (const r of igp || []) setIG.add(String(r.instagram_username).replace(/^@/, '').toLowerCase())
      } catch {}
      // Fallback: derive IG usernames from employees assigned to campaigns
      try {
        const { data: eps } = await supabase.from('employee_participants').select('employee_id').neq('employee_id', null)
        const empIds = Array.from(new Set((eps||[]).map((r:any)=> String(r.employee_id))));
        if (empIds.length) {
          const { data: igMap } = await supabase.from('user_instagram_usernames').select('instagram_username, user_id').in('user_id', empIds)
          for (const r of igMap || []) setIG.add(String(r.instagram_username).replace(/^@/, '').toLowerCase())
        }
      } catch {}
      // Fallback: add employees assigned to campaign via employee_groups
      try {
        const { data: eg } = await supabase.from('employee_groups').select('employee_id')
        const empIds = Array.from(new Set((eg||[]).map((r:any)=> String(r.employee_id))));
        if (empIds.length) {
          const { data: igMap2 } = await supabase.from('user_instagram_usernames').select('instagram_username, user_id').in('user_id', empIds)
          for (const r of igMap2 || []) setIG.add(String(r.instagram_username).replace(/^@/, '').toLowerCase())
          const { data: usersIG } = await supabase.from('users').select('instagram_username, id').in('id', empIds)
          for (const u of usersIG || []) if (u.instagram_username) setIG.add(String(u.instagram_username).replace(/^@/, '').toLowerCase())
        }
      } catch {}
    }
    // Fallback: for each TikTok username, find owning user by tiktok_username or user_tiktok_usernames, then add their IG usernames
    try {
      if (usernames.length) {
        const { data: owners } = await supabase.from('users').select('id, instagram_username, tiktok_username').in('tiktok_username', usernames)
        const ownerIds = new Set<string>((owners||[]).map((u:any)=> String(u.id)))
        // via alias mapping
        const { data: alias } = await supabase.from('user_tiktok_usernames').select('user_id').in('tiktok_username', usernames)
        for (const a of alias||[]) ownerIds.add(String((a as any).user_id))
        if (ownerIds.size) {
          const ids = Array.from(ownerIds)
          const { data: igs } = await supabase.from('user_instagram_usernames').select('instagram_username, user_id').in('user_id', ids)
          for (const r of igs || []) setIG.add(String(r.instagram_username).replace(/^@/, '').toLowerCase())
          const { data: usr } = await supabase.from('users').select('id, instagram_username').in('id', ids)
          for (const u of usr || []) if (u.instagram_username) setIG.add(String(u.instagram_username).replace(/^@/, '').toLowerCase())
        }
      }
    } catch {}
    const igUsernames = Array.from(setIG).filter(Boolean)

    const { protocol, host } = new URL(req.url)
    const base = `${protocol}//${host}`

    const results = await asyncPool(usernames, limit, async (u) => {
      const chunks = chunkMonthly ? monthChunks(effStart, effEnd) : []
      const summary: any = { username: u, ok: true, status: 200, totals: { views:0, likes:0, comments:0, shares:0, saves:0, posts_total:0 }, followers: 0, chunks: [] }
      if (chunks.length === 0) {
        // Single unlimited fetch; biarkan fetch-metrics menyapu histori (cursor + sweep)
        const url = new URL(`${base}/api/fetch-metrics/${encodeURIComponent(u)}`)
        url.searchParams.set('pages','0')
        // Kirim start sebagai hint (tidak wajib bila API abaikan)
        if (effStart) url.searchParams.set('start', effStart)
        if (effEnd) url.searchParams.set('end', effEnd)
        // Force Rapid cursor mode for backfill to avoid aggregator dependency
        url.searchParams.set('rapid','1')
        const prov = process.env.BACKFILL_RAPID_PROVIDER || ''
        if (prov) url.searchParams.set('provider', prov)
        const res = await fetch(url.toString(), { cache: 'no-store' })
        const json = await res.json().catch(()=> ({}))
        summary.ok = res.ok; summary.status = res.status
        if (json?.tiktok) {
          const t = json.tiktok
          summary.totals.views += Number(t.views)||0
          summary.totals.likes += Number(t.likes)||0
          summary.totals.comments += Number(t.comments)||0
          summary.totals.shares += Number(t.shares)||0
          summary.totals.saves += Number(t.saves)||0
          summary.totals.posts_total += Number(t.posts_total)||0
          summary.followers = Number(t.followers)||summary.followers
        }
        // Attach telemetry (if any)
        if (json?.telemetry) summary.telemetry = json.telemetry
        return summary
      } else {
        // Process chunks sequentially per user to reduce rate-limit issues
        for (const c of chunks) {
          const url = new URL(`${base}/api/fetch-metrics/${encodeURIComponent(u)}`)
          url.searchParams.set('start', c.start)
          url.searchParams.set('end', c.end)
          url.searchParams.set('pages','0')
          url.searchParams.set('rapid','1')
          const prov = process.env.BACKFILL_RAPID_PROVIDER || ''
          if (prov) url.searchParams.set('provider', prov)
          const res = await fetch(url.toString(), { cache: 'no-store' })
          const json = await res.json().catch(()=> ({}))
          summary.chunks.push({ start: c.start, end: c.end, ok: res.ok, status: res.status, data: (json?.tiktok ? { posts: json.tiktok.posts_total, views: json.tiktok.views } : json) })
          if (!res.ok) { summary.ok = false; summary.status = res.status }
          if (json?.tiktok) {
            const t = json.tiktok
            summary.totals.views += Number(t.views)||0
            summary.totals.likes += Number(t.likes)||0
            summary.totals.comments += Number(t.comments)||0
            summary.totals.shares += Number(t.shares)||0
            summary.totals.saves += Number(t.saves)||0
            summary.totals.posts_total += Number(t.posts_total)||0
            summary.followers = Number(t.followers)||summary.followers
          }
          if (json?.telemetry) summary.telemetry = json.telemetry
        }
        return summary
      }
    })

    // IG backfill (best-effort, no monthly chunking; Rapid/aggregator behavior in fetch-ig)
      const igResults = await asyncPool(igUsernames, Math.max(1, Math.min(8, limit)), async (u) => {
        try {
          const url = new URL(`${base}/api/fetch-ig/${encodeURIComponent(u)}`)
          if (igCleanupToday) url.searchParams.set('cleanup','today')
          const res = await fetch(url.toString(), { cache: 'no-store' })
          const json = await res.json().catch(()=> ({}))
          return { username: u, ok: res.ok, status: res.status, data: json }
        } catch (e: any) {
          return { username: u, ok: false, error: String(e?.message || e) }
        }
      })

      return NextResponse.json({ updated: results.length, results, instagram: { updated: igResults.length, results: igResults } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
