import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function ensureAdmin() {
  const supa = await createSSR();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return false;
  const { data } = await supa.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}

// Table expected:
// create table if not exists analytics_tracked_accounts (
//   id uuid primary key default gen_random_uuid(),
//   platform text not null check (platform in ('tiktok','instagram')),
//   username text not null,
//   label text,
//   created_at timestamptz default now(),
//   unique(platform, username)
// );

export async function GET() {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const supa = adminClient();
    const { data, error } = await supa.from('analytics_tracked_accounts').select('id, platform, username, label').order('created_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message, hint: 'Create table analytics_tracked_accounts first' }, { status: 500 });
    return NextResponse.json({ accounts: data || [] });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const platform = String(body?.platform||'').toLowerCase();
    const username = String(body?.username||'').trim().replace(/^@+/, '').toLowerCase();
    const label = String(body?.label||'').trim() || null;
    if (!['tiktok','instagram'].includes(platform) || !username) {
      return NextResponse.json({ error: 'platform (tiktok|instagram) and username required' }, { status: 400 });
    }
    const supa = adminClient();
    const { data, error } = await supa.from('analytics_tracked_accounts').upsert({ platform, username, label }, { onConflict: 'platform,username' }).select('id, platform, username, label').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ account: data });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const platform = url.searchParams.get('platform');
    const username = url.searchParams.get('username');
    if (!id && !(platform && username)) return NextResponse.json({ error: 'id or (platform+username) required' }, { status: 400 });
    const supa = adminClient();
    let q = supa.from('analytics_tracked_accounts').delete();
    if (id) q = q.eq('id', id);
    if (platform && username) q = q.eq('platform', platform).eq('username', username);
    const { error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
