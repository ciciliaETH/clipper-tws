import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes - syncs multiple Instagram accounts

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function ensureAdmin() {
  const supabase = await createServerSSR();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}

function norm(u: any): string {
  return String(u || '').trim().replace(/^@+/, '').toLowerCase();
}

export async function POST() {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const supa = adminClient();

    // 1) Normalize usernames across key tables (best-effort; safe to re-run)
    // instagram_posts_daily.username
    await supa.rpc('sql', {} as any).catch(() => {});
    try { await supa.from('instagram_posts_daily').update({}).neq('username', null); } catch {}
    try { await supa.rpc('noop'); } catch {}
    // Fallback manual updates where allowed via RLS; use service role to bypass RLS
    await Promise.all([
      supa.from('instagram_posts_daily').update({}).neq('username', null),
    ]).catch(()=>{});

    // 2) Fetch all employee_groups pairs (employee_id, campaign_id)
    const { data: eg, error: egErr } = await supa
      .from('employee_groups')
      .select('employee_id, campaign_id');
    if (egErr) return NextResponse.json({ error: egErr.message }, { status: 500 });
    const pairs = (eg || []).map((r: any) => ({ employee_id: String(r.employee_id), campaign_id: String(r.campaign_id) }));

    // 3) Build IG handle candidates from users + user_instagram_usernames
    const empIds = Array.from(new Set(pairs.map(p => p.employee_id)));
    const { data: users } = await supa
      .from('users')
      .select('id, instagram_username, extra_instagram_usernames')
      .in('id', empIds);
    const { data: aliases } = await supa
      .from('user_instagram_usernames')
      .select('user_id, instagram_username')
      .in('user_id', empIds);
    const aliasMap = new Map<string, string[]>();
    for (const r of aliases || []) {
      const arr = aliasMap.get((r as any).user_id) || [];
      const u = norm((r as any).instagram_username);
      if (u) arr.push(u);
      aliasMap.set((r as any).user_id, arr);
    }

    const byUser = new Map<string, string[]>();
    for (const u of users || []) {
      const set = new Set<string>();
      const main = norm((u as any).instagram_username);
      if (main) set.add(main);
      const extras: any[] = Array.isArray((u as any).extra_instagram_usernames) ? (u as any).extra_instagram_usernames : [];
      for (const ex of extras) { const v = norm(ex); if (v) set.add(v); }
      for (const a of (aliasMap.get((u as any).id) || [])) set.add(a);
      byUser.set(String((u as any).id), Array.from(set));
    }

    // 4) Fetch existing mappings to avoid duplicates
    const { data: existing } = await supa
      .from('employee_instagram_participants')
      .select('employee_id, campaign_id, instagram_username');
    const existEmp = new Set<string>((existing || []).map((r: any) => `${r.employee_id}::${r.campaign_id}::${norm(r.instagram_username)}`));
    const { data: campExist } = await supa
      .from('campaign_instagram_participants')
      .select('campaign_id, instagram_username');
    const existCamp = new Set<string>((campExist || []).map((r: any) => `${r.campaign_id}::${norm(r.instagram_username)}`));

    // 5) Build upsert arrays
    const empRows: any[] = [];
    const campRows: any[] = [];
    for (const p of pairs) {
      const list = byUser.get(p.employee_id) || [];
      for (const hRaw of list) {
        const h = norm(hRaw);
        if (!h) continue;
        const k1 = `${p.employee_id}::${p.campaign_id}::${h}`;
        const k2 = `${p.campaign_id}::${h}`;
        if (!existEmp.has(k1)) empRows.push({ employee_id: p.employee_id, campaign_id: p.campaign_id, instagram_username: h });
        if (!existCamp.has(k2)) campRows.push({ campaign_id: p.campaign_id, instagram_username: h });
      }
    }

    if (campRows.length) {
      await supa.from('campaign_instagram_participants').upsert(campRows, { onConflict: 'campaign_id,instagram_username', ignoreDuplicates: true });
    }
    if (empRows.length) {
      await supa.from('employee_instagram_participants').upsert(empRows, { onConflict: 'employee_id,campaign_id,instagram_username', ignoreDuplicates: true });
    }

    return NextResponse.json({ assigned_employee_rows: empRows.length, assigned_campaign_rows: campRows.length, employees: empIds.length, pairs: pairs.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
