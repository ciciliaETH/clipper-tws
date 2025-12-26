import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSSR } from '@/lib/supabase/server';

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
  const supabase = await createServerSSR();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}

export async function POST(req: Request, ctx: any) {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await ctx.params;
    const supa = adminClient();

    // List employees in this group
    const { data: eg } = await supa.from('employee_groups').select('employee_id').eq('campaign_id', id);
    const empIds: string[] = Array.from(new Set((eg||[]).map((r:any)=> String(r.employee_id))));
    if (!empIds.length) return NextResponse.json({ assigned: 0, employees: 0, message: 'No employees in group' });

    // Existing IG assignments to avoid duplicates
    const { data: existing } = await supa
      .from('employee_instagram_participants')
      .select('employee_id, instagram_username')
      .eq('campaign_id', id);
    const existSet = new Set<string>((existing||[]).map((r:any)=> `${r.employee_id}::${String(r.instagram_username).toLowerCase()}`));

    // Collect IG handles from profile + alias tables
    const { data: users } = await supa
      .from('users')
      .select('id, instagram_username')
      .in('id', empIds);
    const { data: aliases } = await supa
      .from('user_instagram_usernames')
      .select('user_id, instagram_username')
      .in('user_id', empIds);
    const aliasMap = new Map<string, string[]>();
    for (const r of aliases||[]) {
      const arr = aliasMap.get((r as any).user_id) || [];
      const u = String((r as any).instagram_username||'').trim().replace(/^@/, '').toLowerCase();
      if (u) arr.push(u);
      aliasMap.set((r as any).user_id, arr);
    }

    const rows: any[] = [];
    const campRows: any[] = [];
    for (const u of users||[]) {
      const uid = String((u as any).id);
      const set = new Set<string>();
      const main = String((u as any).instagram_username||'').trim().replace(/^@/, '').toLowerCase();
      if (main) set.add(main);
      for (const a of (aliasMap.get(uid)||[])) set.add(a);

      for (const handle of Array.from(set)) {
        const key = `${uid}::${handle}`;
        if (existSet.has(key)) continue;
        rows.push({ employee_id: uid, campaign_id: id, instagram_username: handle });
        campRows.push({ campaign_id: id, instagram_username: handle });
      }
    }

    if (campRows.length) await supa.from('campaign_instagram_participants').upsert(campRows, { onConflict: 'campaign_id,instagram_username', ignoreDuplicates: true });
    if (rows.length) await supa.from('employee_instagram_participants').upsert(rows, { onConflict: 'employee_id,campaign_id,instagram_username', ignoreDuplicates: true });

    return NextResponse.json({ assigned: rows.length, employees: empIds.length });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
