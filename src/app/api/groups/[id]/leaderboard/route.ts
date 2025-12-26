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

async function canViewCampaign(id: string) {
  const supabase = await createSSR()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = (data as any)?.role
  if (role === 'admin' || role === 'super_admin') return true
  const admin = adminClient()
  const { data: eg } = await admin
    .from('employee_groups')
    .select('employee_id')
    .eq('campaign_id', id)
    .eq('employee_id', user.id)
    .maybeSingle()
  return !!eg
}

export async function GET(req: Request, context: any) {
  try {
    const { id } = await context.params
    const allowed = await canViewCampaign(id)
    if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = new URL(req.url)
    const top = Math.max(1, Math.min(100, Number(url.searchParams.get('top')) || 20))
    const supabaseAdmin = adminClient()
    const { data, error } = await supabaseAdmin
      .from('group_participant_snapshots')
      .select('tiktok_username, followers, views, likes, comments, shares, saves, posts_total, last_refreshed')
      .eq('group_id', id)
    if (error) throw error
    const rows = (data || []).map(r => ({
      username: r.tiktok_username,
      followers: Number(r.followers) || 0,
      views: Number(r.views) || 0,
      likes: Number(r.likes) || 0,
      comments: Number(r.comments) || 0,
      shares: Number(r.shares) || 0,
      saves: Number(r.saves) || 0,
      posts: Number(r.posts_total) || 0,
      total: (Number(r.views)||0)+(Number(r.likes)||0)+(Number(r.comments)||0)+(Number(r.shares)||0)+(Number(r.saves)||0),
      last_refreshed: r.last_refreshed,
    }))
    const sorted = rows.sort((a,b)=> b.total - a.total).slice(0, top)
    return NextResponse.json({ groupId: id, top, data: sorted })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
