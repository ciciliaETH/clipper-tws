import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Build date keys
function buildKeys(interval: 'daily'|'weekly'|'monthly', s: string, e: string): string[] {
  const keys: string[] = [];
  const ds = new Date(s+'T00:00:00Z');
  const de = new Date(e+'T00:00:00Z');
  if (interval === 'daily') {
    for (let d=new Date(ds); d<=de; d.setUTCDate(d.getUTCDate()+1)) keys.push(d.toISOString().slice(0,10));
  } else if (interval === 'weekly') {
    const d = new Date(ds);
    const day = d.getUTCDay();
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((day+6)%7));
    for (let wk = new Date(monday); wk <= de; wk.setUTCDate(wk.getUTCDate()+7)) keys.push(wk.toISOString().slice(0,10));
  } else {
    const mStart = new Date(Date.UTC(ds.getUTCFullYear(), ds.getUTCMonth(), 1));
    const mEnd = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), 1));
    for (let d = new Date(mStart); d <= mEnd; d.setUTCMonth(d.getUTCMonth()+1)) keys.push(d.toISOString().slice(0,10));
  }
  return keys;
}

export async function GET(req: Request) {
  try {
    const supa = adminClient();
    const url = new URL(req.url);
    const startISO = String(url.searchParams.get('start') || '2026-01-02');
    const endISO = String(url.searchParams.get('end') || new Date().toISOString().slice(0,10));
    const interval = (String(url.searchParams.get('interval')||'weekly').toLowerCase()) as 'daily'|'weekly'|'monthly';

    const keys = buildKeys(interval, startISO, endISO);
    const historicalCutoffISO = '2026-01-23';
    const cutoffDate = new Date(historicalCutoffISO+'T00:00:00Z');

    // 1) Build alias sets for employees (karyawan)
    const handlesTT = new Set<string>();
    const handlesIG = new Set<string>();
    try {
      const { data: empUsers } = await supa
        .from('users')
        .select('id, tiktok_username, instagram_username')
        .eq('role','karyawan');
      const empIds = (empUsers||[]).map((u:any)=> String((u as any).id));
      for (const u of empUsers||[]) {
        const tt = String((u as any).tiktok_username||'').trim().replace(/^@+/,'').toLowerCase(); if (tt) handlesTT.add(tt);
        const ig = String((u as any).instagram_username||'').trim().replace(/^@+/,'').toLowerCase(); if (ig) handlesIG.add(ig);
      }
      if (empIds.length) {
        const { data: exT } = await supa.from('user_tiktok_usernames').select('tiktok_username, user_id').in('user_id', empIds);
        for (const r of exT||[]) { const u = String((r as any).tiktok_username||'').trim().replace(/^@+/,'').toLowerCase(); if (u) handlesTT.add(u); }
        const { data: exI } = await supa.from('user_instagram_usernames').select('instagram_username, user_id').in('user_id', empIds);
        for (const r of exI||[]) { const u = String((r as any).instagram_username||'').trim().replace(/^@+/,'').toLowerCase(); if (u) handlesIG.add(u); }
      }
    } catch {}

    // Helper to bucket date to weekly or daily key
    function keyFor(dStr:string): string {
      if (interval==='daily') return dStr;
      if (interval==='monthly') {
        const d=new Date(dStr+'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0,10);
      }
      const d=new Date(dStr+'T00:00:00Z'); const day=d.getUTCDay(); const monday=new Date(d); monday.setUTCDate(d.getUTCDate()-((day+6)%7)); return monday.toISOString().slice(0,10);
    }

    // 2) Historical: weekly_historical_data (< cutoff)
    const histMapTT = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
    const histMapIG = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
    if (new Date(startISO+'T00:00:00Z') < cutoffDate) {
      const histEndISO = new Date(Math.min(new Date(endISO+'T23:59:59Z').getTime(), cutoffDate.getTime())).toISOString().slice(0,10);
      const { data: ttHist } = await supa
        .from('weekly_historical_data')
        .select('start_date, end_date, views, likes, comments, shares, saves')
        .eq('platform','tiktok')
        .gte('start_date', startISO)
        .lt('start_date', historicalCutoffISO);
      const { data: igHist } = await supa
        .from('weekly_historical_data')
        .select('start_date, end_date, views, likes, comments')
        .eq('platform','instagram')
        .gte('start_date', startISO)
        .lt('start_date', historicalCutoffISO);
      const addWeekly = (wk:any, map:Map<string,any>, isTT:boolean)=>{
        const ws = String(wk.start_date); const we=String(wk.end_date);
        for (const k of keys) {
          if (k >= ws && k <= we) {
            const cur = map.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            cur.views += Number(wk.views)||0; cur.likes += Number(wk.likes)||0; cur.comments += Number(wk.comments)||0;
            if (isTT) { cur.shares += Number(wk.shares)||0; cur.saves += Number(wk.saves)||0; }
            map.set(k, cur);
          }
        }
      };
      for (const r of ttHist||[]) addWeekly(r, histMapTT, true);
      for (const r of igHist||[]) addWeekly(r, histMapIG, false);
    }

    // 3) Realtime: posts_daily (>= cutoff) aggregate by alias sets
    const rtMapTT = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
    const rtMapIG = new Map<string,{views:number;likes:number;comments:number}>();
    if (new Date(endISO+'T23:59:59Z') >= cutoffDate) {
      const rtStartISO = (new Date(startISO+'T00:00:00Z') < cutoffDate) ? historicalCutoffISO : startISO;
      if (handlesTT.size) {
        const { data: rows } = await supa
          .from('tiktok_posts_daily')
          .select('username, taken_at, play_count, digg_count, comment_count, share_count, save_count')
          .in('username', Array.from(handlesTT))
          .gte('taken_at', rtStartISO+'T00:00:00Z')
          .lte('taken_at', endISO+'T23:59:59Z');
        for (const r of rows||[]) {
          const k = keyFor(String((r as any).taken_at).slice(0,10));
          const cur = rtMapTT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
          cur.views += Number((r as any).play_count)||0; cur.likes += Number((r as any).digg_count)||0; cur.comments += Number((r as any).comment_count)||0; cur.shares += Number((r as any).share_count)||0; cur.saves += Number((r as any).save_count)||0;
          rtMapTT.set(k, cur);
        }
      }
      if (handlesIG.size) {
        const { data: rows } = await supa
          .from('instagram_posts_daily')
          .select('username, taken_at, play_count, like_count, comment_count')
          .in('username', Array.from(handlesIG))
          .gte('taken_at', rtStartISO+'T00:00:00Z')
          .lte('taken_at', endISO+'T23:59:59Z');
        for (const r of rows||[]) {
          const k = keyFor(String((r as any).taken_at).slice(0,10));
          const cur = rtMapIG.get(k) || { views:0, likes:0, comments:0 };
          cur.views += Number((r as any).play_count)||0; cur.likes += Number((r as any).like_count)||0; cur.comments += Number((r as any).comment_count)||0;
          rtMapIG.set(k, cur);
        }
      }
    }

    // 4) Build totals combining historical + realtime
    const total: any[] = []; const total_tiktok:any[]=[]; const total_instagram:any[]=[];
    for (const k of keys) {
      const date = k;
      const htt = histMapTT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const hig = histMapIG.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const rtt = rtMapTT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const rig = rtMapIG.get(k) || { views:0, likes:0, comments:0 };

      const tt = {
        views: htt.views + rtt.views,
        likes: htt.likes + rtt.likes,
        comments: htt.comments + rtt.comments,
        shares: htt.shares + rtt.shares,
        saves: htt.saves + rtt.saves
      };
      
      const ig = {
        views: hig.views + rig.views,
        likes: hig.likes + rig.likes,
        comments: hig.comments + rig.comments
      };

      total_tiktok.push({ date, ...tt });
      total_instagram.push({ date, ...ig });
      total.push({ 
        date, 
        views: tt.views + ig.views,
        likes: tt.likes + ig.likes,
        comments: tt.comments + ig.comments,
        shares: tt.shares, // IG has no shares in historical/aggregation usually
        saves: tt.saves
      });
    }

    const totals = total.reduce((a:any,s:any)=>({ views:a.views+s.views, likes:a.likes+s.likes, comments:a.comments+s.comments, shares:a.shares+s.shares, saves:a.saves+s.saves }), { views:0, likes:0, comments:0, shares:0, saves:0 });

    return NextResponse.json({ interval, start: startISO, end: endISO, total, total_tiktok, total_instagram, totals, groups: [] });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
