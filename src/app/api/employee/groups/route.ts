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

export async function GET() {
  try {
    const supa = await createSSR();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: me } = await supa.from('users').select('id, role').eq('id', user.id).single();
    if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = adminClient();
    const { data: rows } = await admin
      .from('employee_groups')
      .select('campaign_id, campaigns!inner(name, start_date, end_date)')
      .eq('employee_id', me.id);

    const groups = (rows || []).map((r: any) => ({
      id: r.campaign_id,
      name: r.campaigns?.name || r.campaign_id,
      start_date: r.campaigns?.start_date || null,
      end_date: r.campaigns?.end_date || null,
    }));
    return NextResponse.json({ groups });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
