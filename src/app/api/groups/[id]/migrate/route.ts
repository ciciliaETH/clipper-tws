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
  const supabase = await createSSR()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (!data) return false
  return (data.role === 'admin' || data.role === 'super_admin')
}

export async function POST(req: Request, context: any) {
  try {
    const { id } = await context.params
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = adminClient();
    // campaign id already read from params above

    const { data: parts, error: pErr } = await supabase
      .from('campaign_participants')
      .select('tiktok_username')
      .eq('campaign_id', id);
    if (pErr) throw pErr;
    const usernames = (parts || []).map((p:any)=> String(p.tiktok_username).toLowerCase());

    if (usernames.length === 0) return NextResponse.json({ inserted: 0, message: 'No participants to migrate' });

    const { data: users } = await supabase
      .from('users')
      .select('id, tiktok_username')
      .in('tiktok_username', usernames);

    let count = 0;
    for (const u of users || []) {
      await supabase.from('employee_groups').upsert({ employee_id: u.id, campaign_id: id }, { onConflict: 'employee_id,campaign_id' });
      await supabase.from('employee_accounts').upsert({ employee_id: u.id, account_user_id: u.id }, { onConflict: 'employee_id,account_user_id' });
      count++;
    }

    return NextResponse.json({ inserted: count });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
