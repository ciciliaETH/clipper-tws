import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes - processes up to 28 days of historical data

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function isAuthorized(req: Request) {
  // allow admin session or Bearer CRON_SECRET
  const supa = await createSSR();
  const { data: { user } } = await supa.auth.getUser();
  if (user) {
    const { data } = await supa.from('users').select('role').eq('id', user.id).single();
    if ((data as any)?.role === 'admin' || (data as any)?.role === 'super_admin') return true;
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token && token === (process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY)) return true;
  return false;
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthorized(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(req.url);
    const body = await req.json().catch(()=>({}));
    const days = Number(url.searchParams.get('days') || body.days || 28);
    const campaignId = url.searchParams.get('campaign_id') || body.campaign_id || null;

    const supa = admin();
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - (Math.max(1, days)-1));
    const startISO = start.toISOString().slice(0,10);
    const endISO = today.toISOString().slice(0,10);

    // resolve employee IDs
    let employeeIds: string[] = [];
    if (campaignId) {
      const { data: eg } = await supa.from('employee_groups').select('employee_id').eq('campaign_id', campaignId);
      employeeIds = Array.from(new Set((eg||[]).map((r:any)=> String(r.employee_id))));
    } else {
      const { data: users } = await supa.from('users').select('id').eq('role','karyawan');
      employeeIds = (users||[]).map((u:any)=> String(u.id));
    }
    if (employeeIds.length === 0) return NextResponse.json({ updated: 0, message: 'no employees' });

    // Build handle sets
    const { data: userRows } = await supa.from('users').select('id, tiktok_username, instagram_username').in('id', employeeIds);
    const ttMap = new Map<string,string[]>(); const igMap = new Map<string,string[]>();
    for (const u of userRows||[]) {
      const id = String((u as any).id);
      const t = (u as any).tiktok_username ? [String((u as any).tiktok_username).replace(/^@/,'').toLowerCase()] : [];
      const i = (u as any).instagram_username ? [String((u as any).instagram_username).replace(/^@/,'').toLowerCase()] : [];
      ttMap.set(id, t); igMap.set(id, i);
    }
    const { data: aliasTT } = await supa.from('user_tiktok_usernames').select('user_id, tiktok_username').in('user_id', employeeIds);
    for (const r of aliasTT||[]) { const id=String((r as any).user_id); const h=String((r as any).tiktok_username).replace(/^@/,'').toLowerCase(); const a=ttMap.get(id)||[]; if (!a.includes(h)) a.push(h); ttMap.set(id,a); }
    const { data: aliasIG } = await supa.from('user_instagram_usernames').select('user_id, instagram_username').in('user_id', employeeIds);
    for (const r of aliasIG||[]) { const id=String((r as any).user_id); const h=String((r as any).instagram_username).replace(/^@/,'').toLowerCase(); const a=igMap.get(id)||[]; if (!a.includes(h)) a.push(h); igMap.set(id,a); }

    // helper aggregate posts_daily per date
    const aggregatePlatform = async (platform:'tiktok'|'instagram') => {
      const map = new Map<string, Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>>(); // userId -> date -> values
      const handleMap = platform==='tiktok' ? ttMap : igMap;
      const handles = Array.from(new Set(Array.from(handleMap.values()).flat())).filter(Boolean);
      if (!handles.length) return map;
      if (platform==='tiktok') {
        const { data: rows } = await supa
          .from('tiktok_posts_daily')
          .select('username, post_date, play_count, digg_count, comment_count, share_count, save_count')
          .in('username', handles)
          .gte('post_date', startISO)
          .lte('post_date', endISO);
        const ownerByHandle = new Map<string,string>();
        for (const [uid, arr] of handleMap.entries()) for (const h of arr) ownerByHandle.set(h, uid);
        for (const r of rows||[]) {
          const u = String((r as any).username).toLowerCase(); const owner = ownerByHandle.get(u); if (!owner) continue;
          const date = String((r as any).post_date);
          const userMap = map.get(owner) || new Map();
          const cur = userMap.get(date) || { views:0, likes:0, comments:0, shares:0, saves:0 };
          cur.views += Number((r as any).play_count)||0; cur.likes += Number((r as any).digg_count)||0; cur.comments += Number((r as any).comment_count)||0; cur.shares += Number((r as any).share_count)||0; cur.saves += Number((r as any).save_count)||0;
          userMap.set(date, cur); map.set(owner, userMap);
        }
      } else {
        const { data: rows } = await supa
          .from('instagram_posts_daily')
          .select('username, post_date, play_count, like_count, comment_count')
          .in('username', handles)
          .gte('post_date', startISO)
          .lte('post_date', endISO);
        const ownerByHandle = new Map<string,string>();
        for (const [uid, arr] of handleMap.entries()) for (const h of arr) ownerByHandle.set(h, uid);
        for (const r of rows||[]) {
          const u = String((r as any).username).toLowerCase(); const owner = ownerByHandle.get(u); if (!owner) continue;
          const date = String((r as any).post_date);
          const userMap = map.get(owner) || new Map();
          const cur = userMap.get(date) || { views:0, likes:0, comments:0, shares:0, saves:0 };
          cur.views += Number((r as any).play_count)||0; cur.likes += Number((r as any).like_count)||0; cur.comments += Number((r as any).comment_count)||0;
          userMap.set(date, cur); map.set(owner, userMap);
        }
      }
      return map;
    };

    const ttAgg = await aggregatePlatform('tiktok');
    const igAgg = await aggregatePlatform('instagram');

    // upsert cumulative snapshots per day into social_metrics_history
    const sleep = (ms:number)=> new Promise(res=>setTimeout(res, ms));
    let inserts = 0;
    for (const uid of employeeIds) {
      for (const plat of ['tiktok','instagram'] as const) {
        const dates = [] as string[];
        for (let d=new Date(startISO+'T00:00:00Z'); d <= new Date(endISO+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1)) dates.push(d.toISOString().slice(0,10));
        let views=0, likes=0, comments=0, shares=0, saves=0;
        for (const date of dates) {
          const src = (plat==='tiktok' ? ttAgg : igAgg).get(uid)?.get(date);
          if (src) { views+=src.views; likes+=src.likes; comments+=src.comments; shares+=src.shares; saves+=src.saves; }
          const captured_at = new Date(date+'T23:59:59Z').toISOString();
          await supa.from('social_metrics_history').upsert({ user_id: uid, platform: plat, views, likes, comments, shares, saves, captured_at }, { onConflict: 'user_id,platform,captured_at' });
          inserts++;
        }
        await sleep(100); // rate safety per user/platform
      }
    }

    return NextResponse.json({ ok: true, inserted: inserts, range: { start: startISO, end: endISO }, employees: employeeIds.length });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
