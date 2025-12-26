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

async function getSession() {
  const supabase = await createSSR();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  try {
    const { supabase, user } = await getSession();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: me } = await supabase.from('users').select('id, role').eq('id', user.id).single();
    if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (me.role !== 'karyawan') return NextResponse.json({ role: me.role, accounts: [] });

    const supabaseAdmin = adminClient();

    // Determine period: active campaign if exists, else last 7 days
    const today = new Date().toISOString().slice(0,10);
    const { data: activeCampaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id, start_date, end_date')
      .lte('start_date', today)
      .or('end_date.is.null,end_date.gte.' + today)
      .order('start_date', { ascending: false })
      .limit(1);
    const start = activeCampaigns?.[0]?.start_date || new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
    const end = activeCampaigns?.[0]?.end_date || today;

    // Fetch mapped accounts
    const { data: mappings, error: mapErr } = await supabaseAdmin
      .from('employee_accounts')
      .select('account_user_id')
      .eq('employee_id', me.id);
    if (mapErr) throw mapErr;

    const accountIds: string[] = (mappings || []).map((m: any) => m.account_user_id).filter(Boolean);
    let usernames: string[] = [];
    if (accountIds.length) {
      const { data: usersRows, error: usersErr } = await supabaseAdmin
        .from('users')
        .select('tiktok_username')
        .in('id', accountIds)
        .eq('role', 'umum');
      if (usersErr) throw usersErr;
      usernames = (usersRows || [])
        .map((u: any) => u.tiktok_username)
        .filter((u: any) => typeof u === 'string' && u.length > 0)
        .map((u: string) => u.toLowerCase());
    }

    if (!usernames.length) {
      return NextResponse.json({ role: me.role, start, end, accounts: [], totals: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 } });
    }

    const { data: totalsRows, error: tErr } = await supabaseAdmin
      .rpc('user_totals_in_range', { usernames, start_date: start, end_date: end });
    if (tErr) throw tErr;

    const accounts: Array<{ username: string; views: number; likes: number; comments: number; shares: number; saves: number; total: number }> = (totalsRows || []).map((r: any) => ({
      username: r.username,
      views: Number(r.views) || 0,
      likes: Number(r.likes) || 0,
      comments: Number(r.comments) || 0,
      shares: Number(r.shares) || 0,
      saves: Number(r.saves) || 0,
      total: (Number(r.views)||0)+(Number(r.likes)||0)+(Number(r.comments)||0)+(Number(r.shares)||0)+(Number(r.saves)||0),
    }));

    const totals = accounts.reduce((acc: { views: number; likes: number; comments: number; shares: number; saves: number }, cur) => ({
      views: acc.views + cur.views,
      likes: acc.likes + cur.likes,
      comments: acc.comments + cur.comments,
      shares: acc.shares + cur.shares,
      saves: acc.saves + cur.saves,
    }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });

    return NextResponse.json({ role: me.role, start, end, accounts, totals });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
