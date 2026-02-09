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

    // Fetch Heads (is_head=true) for this group - REMOVED strictly to use Global Users Role
    /*
    const { data: heads } = await supabaseAdmin
      .from('employee_groups')
      .select('employee_id')
      .eq('campaign_id', id)
      .eq('is_head', true);
      
    const headUsernames = new Set<string>();
    if (heads && heads.length > 0) {
       const userIds = heads.map(h => h.employee_id);
       // Get usernames from users table
       const { data: u1 } = await supabaseAdmin.from('users').select('tiktok_username').in('id', userIds);
       u1?.forEach(u => u.tiktok_username && headUsernames.add(u.tiktok_username.toLowerCase().replace(/^@/,'')));
       
       // Get usernames from aliases
       const { data: u2 } = await supabaseAdmin.from('user_tiktok_usernames').select('tiktok_username').in('user_id', userIds);
       u2?.forEach(u => u.tiktok_username && headUsernames.add(u.tiktok_username.toLowerCase().replace(/^@/,'')));
    }
    */
    
    const { data, error } = await supabaseAdmin
      .from('group_participant_snapshots')
      .select('tiktok_username, followers, views, likes, comments, shares, saves, posts_total, last_refreshed')
      .eq('group_id', id)
      
    if (error) throw error

    // Fetch user roles
    // We need to resolve usernames to roles.
    // fetch all users with role 'leader' or 'admin'
    const { data: keyUsers } = await supabaseAdmin
       .from('users')
       .select('id, tiktok_username, role')
       .in('role', ['leader','admin','super_admin'])
       
    // Also fetch aliases for these key users
    const keyUserIds = (keyUsers||[]).map(u => u.id);
    const { data: keyAliases } = await supabaseAdmin
       .from('user_tiktok_usernames')
       .select('user_id, tiktok_username')
       .in('user_id', keyUserIds)
       
    const roleMap = new Map<string, string>();
    for (const u of keyUsers || []) {
       if (u.tiktok_username) roleMap.set(u.tiktok_username.toLowerCase().replace(/^@/,''), u.role);
    }
    for (const a of keyAliases || []) {
       // find role
       const role = keyUsers?.find(u => u.id === a.user_id)?.role;
       if (role && a.tiktok_username) roleMap.set(a.tiktok_username.toLowerCase().replace(/^@/,''), role);
    }

    const rows = (data || []).map(r => {
      const role = roleMap.get(r.tiktok_username.toLowerCase().replace(/^@/,'')) || 'member';
      return {
        username: r.tiktok_username,
        isHead: role === 'leader',
        role: role,
        followers: Number(r.followers) || 0,
        views: Number(r.views) || 0,
        likes: Number(r.likes) || 0,
        comments: Number(r.comments) || 0,
        shares: Number(r.shares) || 0,
        saves: Number(r.saves) || 0,
        posts: Number(r.posts_total) || 0,
        total: (Number(r.views)||0)+(Number(r.likes)||0)+(Number(r.comments)||0)+(Number(r.shares)||0)+(Number(r.saves)||0),
        last_refreshed: r.last_refreshed,
      }
    })
    const sorted = rows.sort((a,b)=> b.total - a.total).slice(0, top)
    return NextResponse.json({ groupId: id, top, data: sorted })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
