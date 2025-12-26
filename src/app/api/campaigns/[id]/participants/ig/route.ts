import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds to stay safe

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function ensureAdmin() {
  const supabase = await createSSR();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}

export async function GET(req: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const supabaseAdmin = adminClient();
    const { data, error } = await supabaseAdmin
      .from('campaign_instagram_participants')
      .select('instagram_username, created_at')
      .eq('campaign_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const body = await req.json().catch(()=>({}));
    const items: string[] = Array.isArray(body?.instagram_usernames) ? body.instagram_usernames : [];
    const rows = items.map(u => ({ campaign_id: id, instagram_username: String(u).replace(/^@/, '').toLowerCase() })).filter(r => r.instagram_username);
    if (!rows.length) return NextResponse.json({ error: 'instagram_usernames required' }, { status: 400 });
    const supabaseAdmin = adminClient();
    const { data, error } = await supabaseAdmin
      .from('campaign_instagram_participants')
      .upsert(rows, { onConflict: 'campaign_id,instagram_username', ignoreDuplicates: true })
      .select('*');
    if (error) throw error;
    return NextResponse.json({ inserted: data?.length || 0, participants: data }, { status: 201 });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
