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
  return data?.role === 'admin';
}

export async function GET(_: Request, context: any) {
  try {
    const { id } = await context.params as { id: string };
    const supabaseAdmin = adminClient();
    const { data } = await supabaseAdmin
      .from('campaign_prizes')
      .select('first_prize, second_prize, third_prize')
      .eq('campaign_id', id)
      .maybeSingle();
    return NextResponse.json(data || { first_prize: 0, second_prize: 0, third_prize: 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params as { id: string };
    const body = await req.json().catch(() => ({}));
    const first = Number(body?.first_prize) || 0;
    const second = Number(body?.second_prize) || 0;
    const third = Number(body?.third_prize) || 0;

    const supabaseAdmin = adminClient();
    const { data, error } = await supabaseAdmin
      .from('campaign_prizes')
      .upsert({ campaign_id: id, first_prize: first, second_prize: second, third_prize: third }, { onConflict: 'campaign_id' })
      .select('first_prize, second_prize, third_prize')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
