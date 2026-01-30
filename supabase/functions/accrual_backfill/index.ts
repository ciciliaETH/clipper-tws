// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const json = (status: number, body: any) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise((r)=> setTimeout(r, ms))

async function buildHandleMaps(employeeIds: string[]) {
  const ttMap = new Map<string,string[]>()
  const igMap = new Map<string,string[]>()
  const { data: users } = await supabase.from('users').select('id, tiktok_username, instagram_username').in('id', employeeIds)
  for (const u of users||[]) {
    const id = String((u as any).id)
    const t = (u as any).tiktok_username ? [String((u as any).tiktok_username).replace(/^@/, '').toLowerCase()] : []
    const i = (u as any).instagram_username ? [String((u as any).instagram_username).replace(/^@/, '').toLowerCase()] : []
    ttMap.set(id, t); igMap.set(id, i)
  }
  const { data: aliasTT } = await supabase.from('user_tiktok_usernames').select('user_id, tiktok_username').in('user_id', employeeIds)
  for (const r of aliasTT||[]) { const id=String((r as any).user_id); const h=String((r as any).tiktok_username).replace(/^@/,'').toLowerCase(); const a=ttMap.get(id)||[]; if (!a.includes(h)) a.push(h); ttMap.set(id,a) }
  const { data: aliasIG } = await supabase.from('user_instagram_usernames').select('user_id, instagram_username').in('user_id', employeeIds)
  for (const r of aliasIG||[]) { const id=String((r as any).user_id); const h=String((r as any).instagram_username).replace(/^@/,'').toLowerCase(); const a=igMap.get(id)||[]; if (!a.includes(h)) a.push(h); igMap.set(id,a) }
  return { ttMap, igMap }
}

async function aggregatePostsDaily(platform:'tiktok'|'instagram', handles: string[], startISO: string, endISO: string) {
  const map = new Map<string, Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>>() // userId -> date -> values
  if (!handles.length) return map
  if (platform==='tiktok') {
    const { data: rows } = await supabase.from('tiktok_posts_daily').select('username, taken_at, play_count, digg_count, comment_count, share_count, save_count').in('username', handles).gte('taken_at', startISO + 'T00:00:00Z').lte('taken_at', endISO + 'T23:59:59Z')
    const ownerByHandle = new Map<string,string>()
    // fetch owner map
    const { data: alias } = await supabase.from('user_tiktok_usernames').select('user_id, tiktok_username').in('tiktok_username', handles)
    for (const h of handles) ownerByHandle.set(h, '') // placeholders
    for (const r of alias||[]) ownerByHandle.set(String((r as any).tiktok_username), String((r as any).user_id))
    const { data: prim } = await supabase.from('users').select('id, tiktok_username').in('tiktok_username', handles)
    for (const r of prim||[]) ownerByHandle.set(String((r as any).tiktok_username), String((r as any).id))
    for (const r of rows||[]) {
      const h = String((r as any).username).toLowerCase(); const owner = ownerByHandle.get(h); if (!owner) continue
      const date = new Date((r as any).taken_at).toISOString().slice(0,10)
      const uMap = map.get(owner) || new Map()
      const cur = uMap.get(date) || { views:0, likes:0, comments:0, shares:0, saves:0 }
      cur.views += Number((r as any).play_count)||0; cur.likes += Number((r as any).digg_count)||0; cur.comments += Number((r as any).comment_count)||0; cur.shares += Number((r as any).share_count)||0; cur.saves += Number((r as any).save_count)||0
      uMap.set(date, cur); map.set(owner, uMap)
    }
  } else {
    const { data: rows } = await supabase.from('instagram_posts_daily').select('username, taken_at, play_count, like_count, comment_count').in('username', handles).gte('taken_at', startISO + 'T00:00:00Z').lte('taken_at', endISO + 'T23:59:59Z')
    const ownerByHandle = new Map<string,string>()
    const { data: alias } = await supabase.from('user_instagram_usernames').select('user_id, instagram_username').in('instagram_username', handles)
    for (const h of handles) ownerByHandle.set(h, '')
    for (const r of alias||[]) ownerByHandle.set(String((r as any).instagram_username), String((r as any).user_id))
    const { data: prim } = await supabase.from('users').select('id, instagram_username').in('instagram_username', handles)
    for (const r of prim||[]) ownerByHandle.set(String((r as any).instagram_username), String((r as any).id))
    for (const r of rows||[]) {
      const h = String((r as any).username).toLowerCase(); const owner = ownerByHandle.get(h); if (!owner) continue
      const date = new Date((r as any).taken_at).toISOString().slice(0,10)
      const uMap = map.get(owner) || new Map()
      const cur = uMap.get(date) || { views:0, likes:0, comments:0, shares:0, saves:0 }
      cur.views += Number((r as any).play_count)||0; cur.likes += Number((r as any).like_count)||0; cur.comments += Number((r as any).comment_count)||0
      uMap.set(date, cur); map.set(owner, uMap)
    }
  }
  return map
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const days = Number(url.searchParams.get('days') || '28')
    const campaignId = url.searchParams.get('campaign_id')
    const parts = Number(url.searchParams.get('parts') || '1') // shard total
    const part = Number(url.searchParams.get('part') || '1')   // 1..parts
    const today = new Date(); today.setUTCHours(0,0,0,0)
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - (Math.max(1, days)-1))
    const startISO = start.toISOString().slice(0,10)
    const endISO = today.toISOString().slice(0,10)

    let employeeIds: string[] = []
    if (campaignId) {
      const { data: eg } = await supabase.from('employee_groups').select('employee_id').eq('campaign_id', campaignId)
      employeeIds = Array.from(new Set((eg||[]).map((r:any)=> String(r.employee_id))))
    } else {
      const { data: users } = await supabase.from('users').select('id').eq('role','karyawan')
      employeeIds = (users||[]).map((u:any)=> String(u.id))
    }
    if (!employeeIds.length) return json(200, { ok: true, inserted: 0, message:'no employees' })
    // shard employees if requested
    const p = Math.max(1, parts|0); const k = Math.min(Math.max(1, part|0), p)
    if (p > 1) employeeIds = employeeIds.filter((_, idx) => (idx % p) === (k-1))

    const { ttMap, igMap } = await buildHandleMaps(employeeIds)
    const ttHandles = Array.from(new Set(Array.from(ttMap.values()).flat())).filter(Boolean)
    const igHandles = Array.from(new Set(Array.from(igMap.values()).flat())).filter(Boolean)
    const ttAgg = await aggregatePostsDaily('tiktok', ttHandles, startISO, endISO)
    const igAgg = await aggregatePostsDaily('instagram', igHandles, startISO, endISO)

    let inserts = 0
    for (const uid of employeeIds) {
      const dates: string[] = []
      for (let d=new Date(startISO+'T00:00:00Z'); d <= new Date(endISO+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1)) dates.push(d.toISOString().slice(0,10))
      for (const plat of ['tiktok','instagram'] as const) {
        let views=0, likes=0, comments=0, shares=0, saves=0
        for (const date of dates) {
          const src = (plat==='tiktok' ? ttAgg : igAgg).get(uid)?.get(date)
          if (src) { views+=src.views; likes+=src.likes; comments+=src.comments; shares+=src.shares; saves+=src.saves }
          const captured_at = new Date(date+'T23:59:59Z').toISOString()
          await supabase.from('social_metrics_history').upsert({ user_id: uid, platform: plat, views, likes, comments, shares, saves, captured_at }, { onConflict: 'user_id,platform,captured_at' })
          inserts++
        }
        await sleep(50)
      }
    }
    return json(200, { ok:true, inserted: inserts, range:{ start:startISO, end:endISO }, employees: employeeIds.length, shard:{ part:k, parts:p } })
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
