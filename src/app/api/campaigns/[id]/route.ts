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

export async function DELETE(_: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params as { id: string };
    const supabaseAdmin = adminClient();

    // Delete campaign (cascade deletes participants)
    const { error } = await supabaseAdmin.from('campaigns').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params as { id: string };
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const supabaseAdmin = adminClient();

    if (action === 'end') {
      const today = new Date().toISOString().slice(0,10);
      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .update({ end_date: today })
        .eq('id', id)
        .select('id, name, start_date, end_date')
        .single();
      if (error) throw error;
      return NextResponse.json({ ended: true, campaign: data });
    }

    // generic partial update (e.g., set specific end_date, name, required_hashtags)
    const patch: any = {};
    if (body?.end_date) patch.end_date = body.end_date;
    if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (body?.required_hashtags !== undefined) {
      // Allow setting to null or array
      patch.required_hashtags = Array.isArray(body.required_hashtags) && body.required_hashtags.length > 0 
        ? body.required_hashtags 
        : null;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update(patch)
      .eq('id', id)
      .select('id, name, start_date, end_date, required_hashtags')
      .single();
    if (error) throw error;
    return NextResponse.json({ updated: true, campaign: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
