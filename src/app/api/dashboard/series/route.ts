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

// Build date keys - for weekly, split into Monday-aligned (historical) and cutoff-aligned (realtime)
function buildKeys(interval: 'daily'|'weekly'|'monthly', s: string, e: string, cutoffISO?: string): string[] {
  const keys: string[] = [];
  const ds = new Date(s+'T00:00:00Z');
  const de = new Date(e+'T00:00:00Z');
  if (interval === 'daily') {
    for (let d=new Date(ds); d<=de; d.setUTCDate(d.getUTCDate()+1)) keys.push(d.toISOString().slice(0,10));
  } else if (interval === 'weekly') {
    if (cutoffISO) {
      const cutoff = new Date(cutoffISO+'T00:00:00Z');
      // Historical portion: Monday-aligned keys before cutoff
      if (ds < cutoff) {
        const histEnd = new Date(Math.min(de.getTime(), cutoff.getTime() - 86400000));
        const day = ds.getUTCDay();
        const monday = new Date(ds); monday.setUTCDate(ds.getUTCDate() - ((day+6)%7));
        for (let wk = new Date(monday); wk <= histEnd; wk.setUTCDate(wk.getUTCDate()+7)) keys.push(wk.toISOString().slice(0,10));
      }
      // Realtime portion: cutoff-aligned keys (so first realtime week starts exactly at cutoff)
      if (de >= cutoff) {
        const rtStart = ds >= cutoff ? ds : cutoff;
        for (let d = new Date(rtStart); d <= de; d.setUTCDate(d.getUTCDate()+7)) keys.push(d.toISOString().slice(0,10));
      }
    } else {
      const d = new Date(ds);
      const day = d.getUTCDay();
      const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((day+6)%7));
      for (let wk = new Date(monday); wk <= de; wk.setUTCDate(wk.getUTCDate()+7)) keys.push(wk.toISOString().slice(0,10));
    }
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
    // Default historical window starts 2025-08-02
    const startISO = String(url.searchParams.get('start') || '2025-08-02');
    const endISO = String(url.searchParams.get('end') || new Date().toISOString().slice(0,10));
    const interval = (String(url.searchParams.get('interval')||'weekly').toLowerCase()) as 'daily'|'weekly'|'monthly';

    // Historical data ends on 2026-02-04; realtime begins 2026-02-05
    const historicalCutoffISO = '2026-02-05';
    const keys = buildKeys(interval, startISO, endISO, historicalCutoffISO);
    const cutoffDate = new Date(historicalCutoffISO+'T00:00:00Z');

    // 1) Build alias sets for employees (karyawan) + per-user handle maps for group resolution
    const handlesTT = new Set<string>();
    const handlesIG = new Set<string>();
    const handlesYT = new Set<string>();
    // Per-user handle maps (for per-group fallback resolution)
    const perUserTT = new Map<string, string[]>();
    const perUserIG = new Map<string, string[]>();
    const perUserYT = new Map<string, string[]>();
    let allEmpIds: string[] = [];

    try {
      const { data: empUsers } = await supa
        .from('users')
        .select('id, tiktok_username, instagram_username')
        .eq('role','karyawan');

      allEmpIds = (empUsers||[]).map((u:any)=> String((u as any).id));

      // Collect main usernames + build per-user maps
      for (const u of empUsers||[]) {
        const uid = String((u as any).id);
        const tt = String((u as any).tiktok_username||'').trim().replace(/^@+/,'').toLowerCase();
        if (tt) { handlesTT.add(tt); const arr = perUserTT.get(uid) || []; arr.push(tt); perUserTT.set(uid, arr); }
        const ig = String((u as any).instagram_username||'').trim().replace(/^@+/,'').toLowerCase();
        if (ig) { handlesIG.add(ig); const arr = perUserIG.get(uid) || []; arr.push(ig); perUserIG.set(uid, arr); }
      }

      if (allEmpIds.length) {
        const { data: exT } = await supa.from('user_tiktok_usernames').select('tiktok_username, user_id').in('user_id', allEmpIds);
        for (const r of exT||[]) {
          const u = String((r as any).tiktok_username||'').trim().replace(/^@+/,'').toLowerCase();
          if (u) { handlesTT.add(u); const uid = String((r as any).user_id); const arr = perUserTT.get(uid) || []; arr.push(u); perUserTT.set(uid, arr); }
        }

        const { data: exI } = await supa.from('user_instagram_usernames').select('instagram_username, user_id').in('user_id', allEmpIds);
        for (const r of exI||[]) {
          const u = String((r as any).instagram_username||'').trim().replace(/^@+/,'').toLowerCase();
          if (u) { handlesIG.add(u); const uid = String((r as any).user_id); const arr = perUserIG.get(uid) || []; arr.push(u); perUserIG.set(uid, arr); }
        }

        // Fetch YouTube Channels from user_youtube_channels
        const { data: exY } = await supa.from('user_youtube_channels').select('youtube_channel_id, user_id').in('user_id', allEmpIds);
        for (const r of exY||[]) {
          const cid = String((r as any).youtube_channel_id||'').trim();
          if (cid) { handlesYT.add(cid); const uid = String((r as any).user_id); const arr = perUserYT.get(uid) || []; arr.push(cid); perUserYT.set(uid, arr); }
        }

        // Fallback: users.youtube_channel_id
        try {
          const { data: ytProfiles } = await supa.from('users').select('id, youtube_channel_id').in('id', allEmpIds);
          for (const r of ytProfiles||[]) {
            const cid = String((r as any).youtube_channel_id||'').trim();
            if (cid) { handlesYT.add(cid); const uid = String((r as any).id); const arr = perUserYT.get(uid) || []; arr.push(cid); perUserYT.set(uid, arr); }
          }
        } catch {}
      }
    } catch {}

    // Also collect YouTube channels from campaign-level and employee-level assignments
    try {
      const { data: campYT } = await supa.from('campaign_youtube_participants').select('youtube_channel_id');
      for (const r of campYT||[]) { const cid = String((r as any).youtube_channel_id||'').trim(); if (cid) handlesYT.add(cid); }
    } catch {}
    try {
      const { data: empYT } = await supa.from('employee_youtube_participants').select('youtube_channel_id');
      for (const r of empYT||[]) { const cid = String((r as any).youtube_channel_id||'').trim(); if (cid) handlesYT.add(cid); }
    } catch {}

    // === PER-GROUP HANDLE RESOLUTION ===
    // Maps: handle → set of campaign IDs (same resolution chain as /api/groups/[id]/members)
    const handleToCampsTT = new Map<string, Set<string>>();
    const handleToCampsIG = new Map<string, Set<string>>();
    const handleToCampsYT = new Map<string, Set<string>>();
    const campaignNames = new Map<string, string>();
    try {
      const { data: allCampaigns } = await supa.from('campaigns').select('id, name');
      for (const c of allCampaigns || []) campaignNames.set(c.id, c.name || c.id);
      const campaignIds = Array.from(campaignNames.keys());

      if (campaignIds.length > 0) {
        // Employee-campaign membership
        const { data: empGroups } = await supa.from('employee_groups').select('campaign_id, employee_id').in('campaign_id', campaignIds);

        // Employee-level assignments per campaign (same tables as members API)
        const { data: empPartTT } = await supa.from('employee_participants').select('campaign_id, employee_id, tiktok_username').in('campaign_id', campaignIds);
        let empPartIG: any[] = [];
        try { const { data } = await supa.from('employee_instagram_participants').select('campaign_id, employee_id, instagram_username').in('campaign_id', campaignIds); empPartIG = data || []; } catch {}
        let empPartYT: any[] = [];
        try { const { data } = await supa.from('employee_youtube_participants').select('campaign_id, employee_id, youtube_channel_id').in('campaign_id', campaignIds); empPartYT = data || []; } catch {}

        // Campaign-level participants (fallback, same as members API)
        const { data: campPartTT } = await supa.from('campaign_participants').select('campaign_id, tiktok_username').in('campaign_id', campaignIds);
        let campPartIG: any[] = [];
        try { const { data } = await supa.from('campaign_instagram_participants').select('campaign_id, instagram_username').in('campaign_id', campaignIds); campPartIG = data || []; } catch {}
        let campPartYT: any[] = [];
        try { const { data } = await supa.from('campaign_youtube_participants').select('campaign_id, youtube_channel_id').in('campaign_id', campaignIds); campPartYT = data || []; } catch {}

        // Resolve handles per employee per campaign (matching members API resolution chain)
        for (const cId of campaignIds) {
          const empIdsInCamp = (empGroups || []).filter(eg => eg.campaign_id === cId).map(eg => eg.employee_id);
          // Pre-filter campaign-level data for this campaign
          const cEmpTT = (empPartTT || []).filter(r => r.campaign_id === cId);
          const cCampTT = (campPartTT || []).filter(r => r.campaign_id === cId).map(r => String(r.tiktok_username||'').replace(/^@+/,'').toLowerCase()).filter(Boolean);
          const cEmpIG = empPartIG.filter(r => r.campaign_id === cId);
          const cCampIG = campPartIG.filter(r => r.campaign_id === cId).map(r => String((r as any).instagram_username||'').replace(/^@+/,'').toLowerCase()).filter(Boolean);
          const cEmpYT = empPartYT.filter(r => r.campaign_id === cId);
          const cCampYT = campPartYT.filter(r => r.campaign_id === cId).map(r => String((r as any).youtube_channel_id||'').trim()).filter(Boolean);

          for (const empId of empIdsInCamp) {
            // TikTok: employee_participants → campaign_participants → user profile handles
            let ttHandles = cEmpTT
              .filter(r => r.employee_id === empId)
              .map(r => String(r.tiktok_username||'').replace(/^@+/,'').toLowerCase())
              .filter(Boolean);
            if (!ttHandles.length && cCampTT.length) ttHandles = cCampTT;
            if (!ttHandles.length) ttHandles = Array.from(new Set(perUserTT.get(empId) || []));
            for (const h of ttHandles) {
              const set = handleToCampsTT.get(h) || new Set(); set.add(cId); handleToCampsTT.set(h, set);
            }

            // Instagram: employee_instagram_participants → campaign_instagram_participants → user profile handles
            let igHandles = cEmpIG
              .filter(r => (r as any).employee_id === empId)
              .map(r => String((r as any).instagram_username||'').replace(/^@+/,'').toLowerCase())
              .filter(Boolean);
            if (!igHandles.length && cCampIG.length) igHandles = cCampIG;
            if (!igHandles.length) igHandles = Array.from(new Set(perUserIG.get(empId) || []));
            for (const h of igHandles) {
              const set = handleToCampsIG.get(h) || new Set(); set.add(cId); handleToCampsIG.set(h, set);
            }

            // YouTube: employee_youtube_participants → campaign_youtube_participants → user profile channels
            let ytChannels = cEmpYT
              .filter(r => (r as any).employee_id === empId)
              .map(r => String((r as any).youtube_channel_id||'').trim())
              .filter(Boolean);
            if (!ytChannels.length && cCampYT.length) ytChannels = cCampYT;
            if (!ytChannels.length) ytChannels = Array.from(new Set(perUserYT.get(empId) || []));
            for (const ch of ytChannels) {
              const set = handleToCampsYT.get(ch) || new Set(); set.add(cId); handleToCampsYT.set(ch, set);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SERIES] Failed to build per-group handles:', e);
    }

    // Helper to bucket date to weekly or daily key
    // Weekly: cutoff-aligned for realtime dates (>= 2026-02-05), Monday-aligned for historical
    function keyFor(dStr:string): string {
      if (interval==='daily') return dStr;
      if (interval==='monthly') {
        const d=new Date(dStr+'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0,10);
      }
      const d=new Date(dStr+'T00:00:00Z');
      if (d >= cutoffDate) {
        // Cutoff-aligned: weeks starting from Feb 5, Feb 12, Feb 19, etc.
        const daysSinceCutoff = Math.floor((d.getTime() - cutoffDate.getTime()) / 86400000);
        const weekNum = Math.floor(daysSinceCutoff / 7);
        const weekStart = new Date(cutoffDate.getTime() + weekNum * 7 * 86400000);
        return weekStart.toISOString().slice(0,10);
      }
      // Historical: Monday-aligned
      const day=d.getUTCDay(); const monday=new Date(d); monday.setUTCDate(d.getUTCDate()-((day+6)%7)); return monday.toISOString().slice(0,10);
    }

    // 2) Historical: weekly_historical_data (< cutoff)
    const histMapTT = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
    const histMapIG = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
    const histMapYT = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();

    if (new Date(startISO+'T00:00:00Z') < cutoffDate) {
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
      const { data: ytHist } = await supa
        .from('weekly_historical_data')
        .select('start_date, end_date, views, likes, comments')
        .ilike('platform','youtube')
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
      for (const r of ytHist||[]) addWeekly(r, histMapYT, false);
    }

    // 3) Realtime: posts_daily (>= cutoff) aggregate by alias sets + per-group
    const rtMapTT = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
    const rtMapIG = new Map<string,{views:number;likes:number;comments:number}>();
    const rtMapYT = new Map<string,{views:number;likes:number;comments:number}>();
    // Per-group realtime maps: campaignId → dateKey → metrics
    const groupRtTT = new Map<string, Map<string, {views:number;likes:number;comments:number;shares:number;saves:number}>>();
    const groupRtIG = new Map<string, Map<string, {views:number;likes:number;comments:number}>>();
    const groupRtYT = new Map<string, Map<string, {views:number;likes:number;comments:number}>>();

    // IMPORTANT: Always fetch ALL realtime data from cutoff to TODAY (not endISO)
    // This ensures the same weekly bucket always gets the same value regardless of
    // the user-selected date range. We filter to the requested keys afterwards.
    const todayISO = new Date().toISOString().slice(0,10);
    if (new Date(endISO+'T23:59:59Z') >= cutoffDate) {
      const rtStartISO = (new Date(startISO+'T00:00:00Z') < cutoffDate) ? historicalCutoffISO : startISO;
      // Always fetch up to today so that dedup/bucketing is stable
      const rtFetchEndISO = todayISO > endISO ? todayISO : endISO;
      if (handlesTT.size) {
        const { data: rows } = await supa
          .from('tiktok_posts_daily')
          .select('video_id, username, taken_at, play_count, digg_count, comment_count, share_count, save_count')
          .in('username', Array.from(handlesTT))
          .gte('taken_at', rtStartISO+'T00:00:00Z')
          .lte('taken_at', rtFetchEndISO+'T23:59:59Z')
          .limit(50000);
        // Deduplicate by video_id (PK, defensive)
        const seenTT = new Map<string, any>();
        for (const r of rows||[]) {
          const vid = String((r as any).video_id || '');
          if (vid && !seenTT.has(vid)) seenTT.set(vid, r);
        }
        for (const r of seenTT.values()) {
          const k = keyFor(String((r as any).taken_at).slice(0,10));
          // Skip if bucket falls outside the requested key range
          if (k > endISO) continue;
          const v = Number((r as any).play_count)||0;
          const l = Number((r as any).digg_count)||0;
          const c = Number((r as any).comment_count)||0;
          const s = Number((r as any).share_count)||0;
          const sv = Number((r as any).save_count)||0;
          // Global aggregation
          const cur = rtMapTT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
          cur.views += v; cur.likes += l; cur.comments += c; cur.shares += s; cur.saves += sv;
          rtMapTT.set(k, cur);
          // Per-group aggregation
          const uname = String((r as any).username||'').toLowerCase();
          const camps = handleToCampsTT.get(uname);
          if (camps) {
            for (const cId of camps) {
              const cMap = groupRtTT.get(cId) || new Map();
              const cur2 = cMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
              cur2.views += v; cur2.likes += l; cur2.comments += c; cur2.shares += s; cur2.saves += sv;
              cMap.set(k, cur2); groupRtTT.set(cId, cMap);
            }
          }
        }
      }
      if (handlesIG.size) {
        const { data: rows } = await supa
          .from('instagram_posts_daily')
          .select('id, code, username, taken_at, play_count, like_count, comment_count')
          .in('username', Array.from(handlesIG))
          .gte('taken_at', rtStartISO+'T00:00:00Z')
          .lte('taken_at', rtFetchEndISO+'T23:59:59Z')
          .limit(50000);
        // Deduplicate by id/code
        const seenIG = new Map<string, any>();
        for (const r of rows||[]) {
          const vid = String((r as any).id || (r as any).code || '');
          if (vid && !seenIG.has(vid)) seenIG.set(vid, r);
        }
        for (const r of seenIG.values()) {
          const k = keyFor(String((r as any).taken_at).slice(0,10));
          if (k > endISO) continue;
          const v = Number((r as any).play_count)||0;
          const l = Number((r as any).like_count)||0;
          const c = Number((r as any).comment_count)||0;
          // Global aggregation
          const cur = rtMapIG.get(k) || { views:0, likes:0, comments:0 };
          cur.views += v; cur.likes += l; cur.comments += c;
          rtMapIG.set(k, cur);
          // Per-group aggregation
          const uname = String((r as any).username||'').toLowerCase();
          const camps = handleToCampsIG.get(uname);
          if (camps) {
            for (const cId of camps) {
              const cMap = groupRtIG.get(cId) || new Map();
              const cur2 = cMap.get(k) || { views:0, likes:0, comments:0 };
              cur2.views += v; cur2.likes += l; cur2.comments += c;
              cMap.set(k, cur2); groupRtIG.set(cId, cMap);
            }
          }
        }
      }
      if (handlesYT.size) {
        const { data: rows } = await supa
          .from('youtube_posts_daily')
          .select('video_id, channel_id, post_date, views, likes, comments')
          .in('channel_id', Array.from(handlesYT))
          .gte('post_date', rtStartISO)
          .lte('post_date', rtFetchEndISO)
          .limit(50000);
        // Deduplicate by video_id — keep EARLIEST post_date per video so it stays
        // in the correct weekly bucket regardless of later scrapes
        const seenYT = new Map<string, any>();
        for (const r of rows||[]) {
          const vid = String((r as any).video_id || '');
          if (!vid) continue;
          const existing = seenYT.get(vid);
          if (!existing) {
            seenYT.set(vid, r);
          } else {
            // Keep the entry with earliest post_date (original publication)
            // but prefer higher view count if same date
            const existDate = String((existing as any).post_date||'').slice(0,10);
            const newDate = String((r as any).post_date||'').slice(0,10);
            if (newDate < existDate) {
              seenYT.set(vid, r);
            } else if (newDate === existDate && (Number((r as any).views)||0) > (Number((existing as any).views)||0)) {
              seenYT.set(vid, r);
            }
          }
        }
        for (const r of seenYT.values()) {
          const k = keyFor(String((r as any).post_date).slice(0,10));
          if (k > endISO) continue;
          const v = Number((r as any).views)||0;
          const l = Number((r as any).likes)||0;
          const c = Number((r as any).comments)||0;
          // Global aggregation
          const cur = rtMapYT.get(k) || { views:0, likes:0, comments:0 };
          cur.views += v; cur.likes += l; cur.comments += c;
          rtMapYT.set(k, cur);
          // Per-group aggregation
          const chId = String((r as any).channel_id||'').trim();
          const camps = handleToCampsYT.get(chId);
          if (camps) {
            for (const cId of camps) {
              const cMap = groupRtYT.get(cId) || new Map();
              const cur2 = cMap.get(k) || { views:0, likes:0, comments:0 };
              cur2.views += v; cur2.likes += l; cur2.comments += c;
              cMap.set(k, cur2); groupRtYT.set(cId, cMap);
            }
          }
        }
      }
    }

    // 4) Build totals combining historical + realtime
    const total: any[] = []; const total_tiktok:any[]=[]; const total_instagram:any[]=[]; const total_youtube:any[]=[];
    for (const k of keys) {
      const date = k;
      const htt = histMapTT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const hig = histMapIG.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const hyt = histMapYT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const rtt = rtMapTT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const rig = rtMapIG.get(k) || { views:0, likes:0, comments:0 };
      const ryt = rtMapYT.get(k) || { views:0, likes:0, comments:0 };

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

      const yt = {
        views: hyt.views + ryt.views,
        likes: hyt.likes + ryt.likes,
        comments: hyt.comments + ryt.comments
      };

      total_tiktok.push({ date, ...tt });
      total_instagram.push({ date, ...ig });
      total_youtube.push({ date, ...yt });
      total.push({
        date,
        views: tt.views + ig.views + yt.views,
        likes: tt.likes + ig.likes + yt.likes,
        comments: tt.comments + ig.comments + yt.comments,
        shares: tt.shares, // Only TikTok has shares
        saves: tt.saves
      });
    }

    const totals = total.reduce((a:any,s:any)=>({ views:a.views+s.views, likes:a.likes+s.likes, comments:a.comments+s.comments, shares:a.shares+s.shares, saves:a.saves+s.saves }), { views:0, likes:0, comments:0, shares:0, saves:0 });

    // 5) Build per-group series from realtime data
    const groups: any[] = [];
    for (const [cId, cName] of campaignNames.entries()) {
      const gTT = groupRtTT.get(cId) || new Map();
      const gIG = groupRtIG.get(cId) || new Map();
      const gYT = groupRtYT.get(cId) || new Map();

      const series: any[] = [];
      const series_tiktok: any[] = [];
      const series_instagram: any[] = [];
      const series_youtube: any[] = [];

      for (const k of keys) {
        const tt = gTT.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
        const ig = gIG.get(k) || { views:0, likes:0, comments:0 };
        const yt = gYT.get(k) || { views:0, likes:0, comments:0 };

        series_tiktok.push({ date: k, views: tt.views, likes: tt.likes, comments: tt.comments, shares: tt.shares, saves: tt.saves });
        series_instagram.push({ date: k, views: ig.views, likes: ig.likes, comments: ig.comments });
        series_youtube.push({ date: k, views: yt.views, likes: yt.likes, comments: yt.comments });
        series.push({
          date: k,
          views: tt.views + ig.views + yt.views,
          likes: tt.likes + ig.likes + yt.likes,
          comments: tt.comments + ig.comments + yt.comments,
          shares: tt.shares,
          saves: tt.saves
        });
      }

      groups.push({ id: cId, name: cName, series, series_tiktok, series_instagram, series_youtube });
    }

    return NextResponse.json({ interval, start: startISO, end: endISO, total, total_tiktok, total_instagram, total_youtube, totals, groups });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
