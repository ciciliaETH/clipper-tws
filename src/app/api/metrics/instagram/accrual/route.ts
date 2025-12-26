import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300; // 5 minutes - Instagram accrual calculations

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false }})
}

function norm(u: any) { return String(u||'').trim().replace(/^@+/, '').toLowerCase() }

export async function GET(req: Request) {
  try {
    const supa = admin()
    const { searchParams } = new URL(req.url)
    const start = searchParams.get('start') || ''
    const end = searchParams.get('end') || new Date().toISOString().slice(0,10)
    const employeeId = searchParams.get('employee_id') || ''
    const campaignId = searchParams.get('campaign_id') || ''
    const usernamesParam = searchParams.get('usernames') || ''

    if (!start) return NextResponse.json({ error: 'start required (YYYY-MM-DD)' }, { status: 400 })

    // Build handle set
    const set = new Set<string>()
    // explicit usernames (comma-separated)
    if (usernamesParam) {
      for (const u of usernamesParam.split(',')) if (u) set.add(norm(u))
    }
    // from employee
    if (employeeId) {
      try { const { data } = await supa.from('users').select('instagram_username').eq('id', employeeId).maybeSingle(); if (data?.instagram_username) set.add(norm(data.instagram_username)) } catch {}
      try { const { data } = await supa.from('user_instagram_usernames').select('instagram_username').eq('user_id', employeeId); for (const r of data||[]) set.add(norm((r as any).instagram_username)) } catch {}
      try { const { data } = await supa.from('employee_instagram_participants').select('instagram_username').eq('employee_id', employeeId); for (const r of data||[]) set.add(norm((r as any).instagram_username)) } catch {}
    }
    // from campaign
    if (campaignId) {
      try { const { data } = await supa.from('campaign_instagram_participants').select('instagram_username').eq('campaign_id', campaignId); for (const r of data||[]) set.add(norm((r as any).instagram_username)) } catch {}
    }

    const users = Array.from(set)
    if (!users.length) return NextResponse.json({ usernames: [], accrual: { views:0, likes:0, comments:0 }, posts: 0 })

    // Fetch history snapshots around window
    const startTS = new Date(start+'T00:00:00Z')
    const endTS = new Date(end+'T23:59:59Z')

    // To compute baseline (snapshot just before start), we need a small back window
    const backTS = new Date(startTS.getTime() - 7*24*60*60*1000)

    const { data: rows, error } = await supa
      .from('instagram_post_metrics_history')
      .select('post_id, username, captured_at, play_count, like_count, comment_count')
      .in('username', users)
      .gte('captured_at', backTS.toISOString())
      .lte('captured_at', endTS.toISOString())
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    type Snap = { post_id: string, username: string, captured_at: string, play_count: number, like_count: number, comment_count: number }
    const byPost = new Map<string, Snap[]>()
    for (const r of rows||[]) {
      const id = String((r as any).post_id)
      const arr = byPost.get(id) || []
      arr.push(r as any)
      byPost.set(id, arr)
    }

    let viewsDelta = 0, likesDelta = 0, commentsDelta = 0
    let postsCounted = 0

    for (const [postId, snaps] of byPost.entries()) {
      // sort by captured_at asc
      snaps.sort((a,b)=> new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime())
      // baseline: latest snapshot before startTS
      let base = null as Snap | null
      for (const s of snaps) {
        if (new Date(s.captured_at) < startTS) base = s
        else break
      }
      // end: latest snapshot <= endTS
      let endSnap = null as Snap | null
      for (let i=snaps.length-1; i>=0; i--) {
        const s = snaps[i]
        if (new Date(s.captured_at) <= endTS) { endSnap = s; break }
      }
      if (!endSnap) continue
      const dv = (endSnap.play_count||0) - (base?.play_count||0)
      const dl = (endSnap.like_count||0) - (base?.like_count||0)
      const dc = (endSnap.comment_count||0) - (base?.comment_count||0)
      // Only count positive deltas
      const pv = Math.max(dv, 0), pl = Math.max(dl, 0), pc = Math.max(dc, 0)
      if (pv>0 || pl>0 || pc>0) postsCounted++
      viewsDelta += pv; likesDelta += pl; commentsDelta += pc
    }

    return NextResponse.json({ usernames: users, accrual: { views: viewsDelta, likes: likesDelta, comments: commentsDelta }, posts: postsCounted })
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}
