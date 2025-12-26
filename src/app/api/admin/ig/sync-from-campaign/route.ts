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
  const supa = await createSSR();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return false;
  const { data } = await supa.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}

async function rapidJson(url: string, host: string, timeoutMs = 15000) {
  const keys = (process.env.RAPID_API_KEYS || process.env.RAPIDAPI_KEYS || process.env.RAPID_KEY_BACKFILL || process.env.RAPIDAPI_KEY || '').split(',').map(s=>s.trim()).filter(Boolean);
  const key = keys[0];
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'x-rapidapi-key': key||'', 'x-rapidapi-host': host, 'accept':'application/json' }, signal: ctl.signal });
    const txt = await r.text(); if (!r.ok) throw new Error(`${r.status} ${txt.slice(0,200)}`);
    try { return JSON.parse(txt); } catch { return txt; }
  } finally { clearTimeout(t); }
}

export async function POST(req: Request) {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const supa = adminClient();
    const body = await req.json().catch(()=>({}));
    const limit = Math.max(1, Math.min(5000, Number(body?.limit || 2000)));
    const host = process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram120.p.rapidapi.com';
    const scraper = process.env.RAPIDAPI_IG_SCRAPER_HOST || 'instagram-scraper-api11.p.rapidapi.com';

    // 1) Ambil semua username IG dari campaign_instagram_participants (canonical)
    const { data: rows } = await supa
      .from('campaign_instagram_participants')
      .select('instagram_username')
      .limit(limit);
    const usernames = Array.from(new Set((rows||[]).map((r:any)=> String(r.instagram_username||'').trim().replace(/^@+/, '').toLowerCase()).filter(Boolean)));
    if (!usernames.length) return NextResponse.json({ users:0, inserted_map:0, resolved_ids:0 });

    let insertedMap = 0; let resolvedIds = 0;

    for (const uname of usernames) {
      // 2) Pastikan mapping user_instagram_usernames ada: cari pemilik via employee_instagram_participants atau users.instagram_username
      try {
        const { data: exists } = await supa
          .from('user_instagram_usernames')
          .select('user_id')
          .eq('instagram_username', uname)
          .maybeSingle();
        if (!exists?.user_id) {
          let userId: string | undefined;
          // prefer explicit mapping per-employee
          const { data: eip } = await supa
            .from('employee_instagram_participants')
            .select('employee_id')
            .eq('instagram_username', uname)
            .maybeSingle();
          if (eip?.employee_id) userId = String(eip.employee_id);
          if (!userId) {
            const { data: prof } = await supa.from('users').select('id').eq('instagram_username', uname).maybeSingle();
            if (prof?.id) userId = String(prof.id);
          }
          if (userId) {
            await supa.from('user_instagram_usernames').upsert({ user_id: userId, instagram_username: uname }, { onConflict: 'user_id,instagram_username', ignoreDuplicates: true });
            insertedMap += 1;
          }
        }
      } catch {}

      // 3) Pastikan instagram_user_ids ada; resolve jika kosong
      try {
        const { data: idRow } = await supa
          .from('instagram_user_ids')
          .select('instagram_user_id')
          .eq('instagram_username', uname)
          .maybeSingle();
        if (!idRow?.instagram_user_id) {
          // prefer link endpoint
          let pk: string | undefined;
          try {
            const j = await rapidJson(`https://${scraper}/get_instagram_user_id?link=${encodeURIComponent('https://www.instagram.com/'+uname)}`, scraper, 15000);
            pk = j?.user_id || j?.id || j?.data?.user_id || j?.data?.id;
          } catch {}
          if (!pk) {
            const endpoints = [
              `https://${host}/api/instagram/user?username=${encodeURIComponent(uname)}`,
              `https://${host}/api/instagram/userinfo?username=${encodeURIComponent(uname)}`,
              `https://${host}/api/instagram/username?username=${encodeURIComponent(uname)}`,
            ];
            for (const url of endpoints) {
              try {
                const ij = await rapidJson(url, host, 15000);
                const cand = ij?.result?.user || ij?.user || ij?.result || {};
                const id = cand?.pk || cand?.id || cand?.pk_id || ij?.result?.pk || ij?.result?.id;
                if (id) { pk = String(id); break; }
              } catch {}
            }
          }
          if (pk) {
            await supa.from('instagram_user_ids').upsert({ instagram_username: uname, instagram_user_id: pk }, { onConflict: 'instagram_username' });
            resolvedIds += 1;
          }
        }
      } catch {}
    }

    return NextResponse.json({ users: usernames.length, inserted_map: insertedMap, resolved_ids: resolvedIds });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
