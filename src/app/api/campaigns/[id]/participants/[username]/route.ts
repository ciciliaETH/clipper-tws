import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSSR } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60; // 60 seconds to stay safe

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
  return data?.role === 'admin'
}

export async function GET(req: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin()
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = adminClient()
    const { id, username } = await context.params

    // get campaign window
    const { data: camp } = await supabase
      .from('campaigns')
      .select('start_date, end_date')
      .eq('id', id)
      .single()

    if (!camp) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const start = camp.start_date
  const end = camp.end_date || new Date().toISOString().slice(0,10)

    // group by date per username
    const { data: rows, error } = await supabase
      .from('tiktok_posts_daily')
      .select('post_date, play_count, digg_count, comment_count')
      .eq('username', String(username).toLowerCase())
      .gte('post_date', start)
      .lte('post_date', end)
      .order('post_date', { ascending: true })

    if (error) throw error

    // aggregate by day
    const map = new Map<string, { views:number, likes:number, comments:number }>()
    for (const r of rows || []) {
      const d = String(r.post_date)
      const cur = map.get(d) || { views:0, likes:0, comments:0 }
      cur.views += Number(r.play_count||0)
      cur.likes += Number(r.digg_count||0)
      cur.comments += Number(r.comment_count||0)
      map.set(d, cur)
    }

    // generate full series from start..end with zero fill
    const series: any[] = []
    const dStart = new Date(start + 'T00:00:00Z')
    const dEnd = new Date(end + 'T00:00:00Z')
    for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate()+1)) {
      const key = d.toISOString().slice(0,10)
      const v = map.get(key) || { views:0, likes:0, comments:0 }
      series.push({ date: key, ...v })
    }

    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
