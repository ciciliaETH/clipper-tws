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
  return data?.role === 'admin' || data?.role === 'super_admin'
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const kind = url.searchParams.get('kind')
    const supabaseAdmin = adminClient()

    // Identify current user and role
    const supabaseSSR = await createSSR()
    const { data: { user } } = await supabaseSSR.auth.getUser()
    const userId = user?.id || null
    let role: string | null = null
    if (userId) {
      const { data: r } = await supabaseSSR.from('users').select('role').eq('id', userId).single()
      role = r?.role || null
    }

    if (kind === 'groups') {
      // New groups table: for now, show all to admins; filter by membership is not defined
      if (role && (role === 'admin' || role === 'super_admin')) {
        const { data, error } = await supabaseAdmin
          .from('groups')
          .select('id, name, description, created_at, updated_at')
          .order('created_at', { ascending: false })
        if (error) throw error
        return NextResponse.json({ data })
      }
      // Non-admins: return empty until group_members policy is defined
      return NextResponse.json({ data: [] })
    }

    // Legacy campaigns act as groups
    let campaigns: any[] = []
    if (role && (role === 'admin' || role === 'super_admin')) {
      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      campaigns = data || []
    } else if (userId) {
      // Non-admin: return only campaigns the user is assigned to via employee_groups
      const { data: eg, error: egErr } = await supabaseAdmin
        .from('employee_groups')
        .select('campaign_id')
        .eq('employee_id', userId)
      if (egErr) throw egErr
      const ids = Array.from(new Set((eg || []).map((x: any) => x.campaign_id)))
      if (ids.length === 0) return NextResponse.json([])
      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .in('id', ids)
        .order('created_at', { ascending: false })
      if (error) throw error
      campaigns = data || []
    } else {
       return NextResponse.json([], { status: 200 })
    }

    // Attach Head info
    if (campaigns.length > 0) {
       const cIds = campaigns.map(c => c.id);
       const { data: heads } = await supabaseAdmin
         .from('employee_groups')
         .select('campaign_id, employee_id, is_head')
         .in('campaign_id', cIds)
         .eq('is_head', true);
       
       if (heads && heads.length > 0) {
          const eIds = heads.map(h => h.employee_id);
          const { data: users } = await supabaseAdmin
            .from('users')
            .select('id, full_name, username')
            .in('id', eIds);
            
          const userMap = new Map<string, string>();
          users?.forEach(u => userMap.set(u.id, u.full_name || u.username || 'Unknown'));
          
          const headMap = new Map<string, string[]>();
          heads.forEach(h => {
             const name = userMap.get(h.employee_id);
             if (name) {
                const list = headMap.get(h.campaign_id) || [];
                list.push(name);
                headMap.set(h.campaign_id, list);
             }
          });
          
          campaigns = campaigns.map(c => ({
             ...c,
             heads: headMap.get(c.id) || []
          }));
       }
    }
    
    return NextResponse.json(campaigns)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const isAdmin = await ensureAdmin()
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = new URL(req.url)
    const kind = url.searchParams.get('kind')
    const body = await req.json().catch(()=>({})) as any
    const supabaseAdmin = adminClient()
    if (kind === 'groups') {
      const name = body?.name
      const description = body?.description ?? null
      if (!name || String(name).trim().length === 0) {
        return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      }
      const { data, error } = await supabaseAdmin
        .from('groups')
        .insert({ name: String(name).trim(), description })
        .select('id, name, description')
        .single()
      if (error) throw error
      return NextResponse.json({ data })
    }
    // default: legacy create campaign (for /dashboard/campaigns compatibility)
    const name = body?.name as string | undefined
    let start_date = body?.start_date as string | undefined
    const end_date = body?.end_date as string | undefined
    const required_hashtags = body?.required_hashtags as string[] | undefined
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (!start_date) start_date = new Date().toISOString().slice(0,10)
    const { data: created, error } = await supabaseAdmin
      .from('campaigns')
      .insert({ 
        name, 
        start_date, 
        end_date: end_date || null,
        required_hashtags: required_hashtags && required_hashtags.length > 0 ? required_hashtags : null
      })
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json(created, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
