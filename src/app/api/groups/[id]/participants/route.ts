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
  if (!data) return false
  return (data.role === 'admin' || data.role === 'super_admin')
}

export async function GET(req: Request, context: any) {
  try {
    const { id } = await context.params
    const isAdmin = await ensureAdmin()
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabaseAdmin = adminClient()
    const { data, error } = await supabaseAdmin
      .from('group_participants')
      .select('id, tiktok_username, created_at')
      .eq('group_id', id)
      .order('created_at', { ascending: true })
    if (error) throw error
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request, context: any) {
  try {
    const { id } = await context.params
    const isAdmin = await ensureAdmin()
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    let usernames: string[] = Array.isArray(body?.usernames) ? body.usernames : []
    if (!usernames.length) return NextResponse.json({ error: 'usernames array is required' }, { status: 400 })
    const cleaned = Array.from(new Set(usernames.map((u: string) => String(u).trim().replace(/^@/, '').toLowerCase()).filter(Boolean)))
    const rows = cleaned.map(u => ({ group_id: id, tiktok_username: u }))
    const supabaseAdmin = adminClient()
    const { error } = await supabaseAdmin
      .from('group_participants')
      .upsert(rows, { onConflict: 'group_id,tiktok_username', ignoreDuplicates: true })
    if (error) throw error
    return NextResponse.json({ inserted: cleaned.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
