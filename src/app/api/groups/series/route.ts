import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasRequiredHashtag } from '@/lib/hashtag-filter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds to stay safe

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(req: Request) {
  try {
    const supa = adminClient();
    const url = new URL(req.url);
    // Force weekly + postdate mode
    const interval = 'weekly' as const;
    const mode = 'postdate';
    const respectHashtags = url.searchParams.get('respect_hashtags') === '1';
    const snapshotsOnly = url.searchParams.get('snapshots_only') !== '0';
    let startISO = url.searchParams.get('start');
    let endISO = url.searchParams.get('end');
    const daysQ = Number(url.searchParams.get('days')||'0');
    const windowDays = ([7,28,60] as number[]).includes(daysQ) ? daysQ : 0;
    if (mode==='accrual' && windowDays>0) {
      const end = new Date();
      const start = new Date(); start.setUTCDate(end.getUTCDate()-(windowDays-1));
      startISO = start.toISOString().slice(0,10);
      endISO = end.toISOString().slice(0,10);
    }
    if (!startISO || !endISO) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate()-30);
      startISO = start.toISOString().slice(0,10);
      endISO = end.toISOString().slice(0,10);
    }

    // Helper available for both modes: derive IG usernames for a campaign
    const deriveIGUsernamesForCampaign = async (client: ReturnType<typeof adminClient>, campaignId: string): Promise<string[]> => {
      // 1) Prefer explicit campaign IG participants
      try {
        const { data: igParts } = await client
          .from('campaign_instagram_participants')
          .select('instagram_username')
          .eq('campaign_id', campaignId);
        const arr = (igParts||[]).map((r:any)=> String(r.instagram_username||'')
          .trim().replace(/^@+/, '').toLowerCase()).filter(Boolean);
        if (arr.length) return Array.from(new Set(arr));
      } catch {}
      // 2) Fallback to employee_instagram_participants
      try {
        const { data: empIg } = await client
          .from('employee_instagram_participants')
          .select('instagram_username')
          .eq('campaign_id', campaignId);
        const arr = (empIg||[]).map((r:any)=> String(r.instagram_username||'')
          .trim().replace(/^@+/, '').toLowerCase()).filter(Boolean);
        if (arr.length) return Array.from(new Set(arr));
      } catch {}
      // 3) Derive from TikTok participants' owners → IG usernames
      try {
        const { data: ttParts } = await client
          .from('campaign_participants')
          .select('tiktok_username')
          .eq('campaign_id', campaignId);
        const ttHandles = (ttParts||[]).map((r:any)=> String(r.tiktok_username||'')
          .trim().replace(/^@+/, '').toLowerCase()).filter(Boolean);
        if (ttHandles.length) {
          const owners = new Set<string>();
          // explicit mapping table user_tiktok_usernames
          try {
            const { data: mapRows } = await client
              .from('user_tiktok_usernames')
              .select('user_id, tiktok_username')
              .in('tiktok_username', ttHandles);
            for (const r of mapRows||[]) owners.add(String((r as any).user_id));
          } catch {}
          // users.tiktok_username direct
          try {
            const { data: userRows } = await client
              .from('users')
              .select('id')
              .in('tiktok_username', ttHandles);
            for (const r of userRows||[]) owners.add(String((r as any).id));
          } catch {}
          if (owners.size) {
            const ids = Array.from(owners);
            const set = new Set<string>();
            try {
              const { data: igMap } = await client
                .from('user_instagram_usernames')
                .select('instagram_username, user_id')
                .in('user_id', ids);
              for (const r of igMap||[]) {
                const u = String((r as any).instagram_username||'').trim().replace(/^@+/, '').toLowerCase();
                if (u) set.add(u);
              }
            } catch {}
            try {
              const { data: igUsers } = await client
                .from('users')
                .select('instagram_username, id')
                .in('id', ids);
              for (const r of igUsers||[]) {
                const u = String((r as any).instagram_username||'').trim().replace(/^@+/, '').toLowerCase();
                if (u) set.add(u);
              }
            } catch {}
            if (set.size) return Array.from(set);
          }
        }
      } catch {}
      // 4) Last fallback: employees in this campaign (employee_groups) → IG aliases/profiles
      try {
        const { data: eg } = await client
          .from('employee_groups')
          .select('employee_id')
          .eq('campaign_id', campaignId);
        const empIds = Array.from(new Set((eg||[]).map((r:any)=> String(r.employee_id))));
        if (empIds.length) {
          const set = new Set<string>();
          try {
            const { data: igMap } = await client
              .from('user_instagram_usernames')
              .select('instagram_username, user_id')
              .in('user_id', empIds);
            for (const r of igMap||[]) {
              const u = String((r as any).instagram_username||'').trim().replace(/^@+/, '').toLowerCase();
              if (u) set.add(u);
            }
          } catch {}
          try {
            const { data: igUsers } = await client
              .from('users')
              .select('instagram_username, id')
              .in('id', empIds);
            for (const r of igUsers||[]) {
              const u = String((r as any).instagram_username||'').trim().replace(/^@+/, '').toLowerCase();
              if (u) set.add(u);
            }
          } catch {}
          if (set.size) return Array.from(set);
        }
      } catch {}
      return [];
    };

    // Accrual mode: aggregate from post_metrics_history (per-post LAG delta) across all employees
    // PART 1: Historical period (< 2026-01-23): Use weekly_historical_data
    // PART 2: Realtime period (>= 2026-01-23): Use post_metrics_history with LAG delta
    if (mode === 'accrual') {
      const start = startISO!; const end = endISO!;
      // keys (daily)
      const keys:string[] = []; const ds=new Date(start+'T00:00:00Z'); const de=new Date(end+'T00:00:00Z'); for (let d=new Date(ds); d<=de; d.setUTCDate(d.getUTCDate()+1)) keys.push(d.toISOString().slice(0,10));
      
      // Historical data ends on 2026-02-04; realtime begins 2026-02-05
      const historicalCutoff = new Date('2026-02-05T00:00:00Z');
      const historicalCutoffISO = '2026-02-05';

      // Helper: calculate series from post_metrics_history using LAG delta per post (for realtime period only)
      const calcSeriesPlatform = async (usernames: string[], plat: 'tiktok'|'instagram') => {
        const map = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
        if (!usernames.length) return keys.map(k => ({ date:k, views:0, likes:0, comments:0, shares:0, saves:0 }));
        
        // Check if we need realtime data
        if (new Date(end + 'T23:59:59Z') < historicalCutoff) {
          // All dates are historical, return zeros (will be filled by historical data later)
          return keys.map(k => ({ date:k, views:0, likes:0, comments:0, shares:0, saves:0 }));
        }
        
        const realtimeStart = new Date(Math.max(new Date(start + 'T00:00:00Z').getTime(), historicalCutoff.getTime()));
        const realtimeStartISO = realtimeStart.toISOString().slice(0, 10);
        
        const tableName = plat === 'tiktok' ? 'tiktok_post_metrics_history' : 'instagram_post_metrics_history';
        const usernameCol = plat === 'tiktok' ? 'tiktok_username' : 'instagram_username';
        
        // Query post metrics history for realtime period only
        const { data: rows } = await supa
          .from(tableName)
          .select('post_id, play_count, like_count, comment_count, share_count, save_count, captured_at')
          .in(usernameCol, usernames)
          .gte('captured_at', realtimeStartISO + 'T00:00:00Z')
          .lte('captured_at', end + 'T23:59:59Z')
          .order('post_id', { ascending: true })
          .order('captured_at', { ascending: true });
        
        // Group by post_id
        const byPost = new Map<string, any[]>();
        for (const r of rows||[]) {
          const pid = String((r as any).post_id);
          const arr = byPost.get(pid) || [];
          arr.push(r);
          byPost.set(pid, arr);
        }
        
        // Calculate LAG delta per post
        for (const [, snaps] of byPost.entries()) {
          snaps.sort((a, b) => new Date((a as any).captured_at).getTime() - new Date((b as any).captured_at).getTime());
          for (let i = 1; i < snaps.length; i++) {
            const prev = snaps[i-1];
            const curr = snaps[i];
            const date = new Date((curr as any).captured_at).toISOString().slice(0,10);
            if (date < start || date > end) continue;
            
            const deltaViews = Math.max(0, Number((curr as any).play_count||0) - Number((prev as any).play_count||0));
            const deltaLikes = Math.max(0, Number((curr as any).like_count||0) - Number((prev as any).like_count||0));
            const deltaComments = Math.max(0, Number((curr as any).comment_count||0) - Number((prev as any).comment_count||0));
            const deltaShares = Math.max(0, Number((curr as any).share_count||0) - Number((prev as any).share_count||0));
            const deltaSaves = Math.max(0, Number((curr as any).save_count||0) - Number((prev as any).save_count||0));
            
            const curAgg = map.get(date) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            curAgg.views += deltaViews;
            curAgg.likes += deltaLikes;
            curAgg.comments += deltaComments;
            curAgg.shares += deltaShares;
            curAgg.saves += deltaSaves;
            map.set(date, curAgg);
          }
        }
        
        return keys.map(k => ({ date:k, ...(map.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 }) }));
      };
      
      // Helper: derive TikTok usernames for a campaign from employee_tiktok_participants
      const deriveTTUsernames = async (campaignId: string): Promise<string[]> => {
        const set = new Set<string>();
        // From employee_tiktok_participants (new source of truth)
        try {
          const { data: participants } = await supa
            .from('employee_tiktok_participants')
            .select('tiktok_username')
            .eq('campaign_id', campaignId);
          for (const r of participants||[]) {
            const u = String((r as any).tiktok_username||'').trim().replace(/^@+/, '').toLowerCase();
            if (u) set.add(u);
          }
        } catch {}
        // Fallback to campaign_participants
        if (set.size === 0) {
          try {
            const { data: ttParts } = await supa
              .from('campaign_participants')
              .select('tiktok_username')
              .eq('campaign_id', campaignId);
            for (const r of ttParts||[]) {
              const u = String((r as any).tiktok_username||'').trim().replace(/^@+/, '').toLowerCase();
              if (u) set.add(u);
            }
          } catch {}
        }
        return Array.from(set);
      };

      // Helper: derive Instagram usernames for a campaign from employee_instagram_participants
      const deriveIGUsernames = async (campaignId: string): Promise<string[]> => {
        const set = new Set<string>();
        // From employee_instagram_participants (new source of truth)
        try {
          const { data: participants } = await supa
            .from('employee_instagram_participants')
            .select('instagram_username')
            .eq('campaign_id', campaignId);
          for (const r of participants||[]) {
            const u = String((r as any).instagram_username||'').trim().replace(/^@+/, '').toLowerCase();
            if (u) set.add(u);
          }
        } catch {}
        // Fallback to campaign_instagram_participants
        if (set.size === 0) {
          try {
            const { data: igParts } = await supa
              .from('campaign_instagram_participants')
              .select('instagram_username')
              .eq('campaign_id', campaignId);
            for (const r of igParts||[]) {
              const u = String((r as any).instagram_username||'').trim().replace(/^@+/, '').toLowerCase();
              if (u) set.add(u);
            }
          } catch {}
        }
        return Array.from(set);
      };

      // Accumulate totals while producing per-campaign series with fallbacks
      const groups:any[] = [];
      const totalMap = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
      const totalTTMap = new Map<string,{views:number;likes:number;comments:number;shares:number;saves:number}>();
      const totalIGMap = new Map<string,{views:number;likes:number;comments:number}>();
      
      // HISTORICAL DATA: Load weekly_historical_data for period < 2026-01-23
      const historicalMap = new Map<string, Map<string, {views:number;likes:number;comments:number;shares:number;saves:number}>>();
      
      if (new Date(start + 'T00:00:00Z') < historicalCutoff) {
        const historicalEnd = new Date(Math.min(new Date(end + 'T23:59:59Z').getTime(), historicalCutoff.getTime()));
        const historicalEndISO = historicalEnd.toISOString().slice(0, 10);
        
        // Query TikTok historical data
        const { data: ttHistRows } = await supa
          .from('weekly_historical_data')
          .select('week_label, start_date, end_date, platform, views, likes, comments, shares, saves')
          .eq('platform', 'tiktok')
          .gte('start_date', start)
          .lt('start_date', historicalCutoffISO);
        
        // Query Instagram historical data  
        const { data: igHistRows } = await supa
          .from('weekly_historical_data')
          .select('week_label, start_date, end_date, platform, views, likes, comments')
          .eq('platform', 'instagram')
          .gte('start_date', start)
          .lt('start_date', historicalCutoffISO);
        
        // Distribute weekly data across daily keys
        const distributeWeekly = (rows: any[], platform: 'tiktok'|'instagram') => {
          for (const r of rows||[]) {
            const weekStart = String((r as any).start_date);
            const weekEnd = String((r as any).end_date);
            const daysInWeek = Math.round((new Date(weekEnd).getTime() - new Date(weekStart).getTime()) / (24*60*60*1000)) + 1;
            
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k >= weekStart && k <= weekEnd) {
                const platformKey = platform;
                if (!historicalMap.has(platformKey)) historicalMap.set(platformKey, new Map());
                const map = historicalMap.get(platformKey)!;
                const cur = map.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
                
                // Distribute evenly across days in week
                cur.views += (Number((r as any).views)||0) / daysInWeek;
                cur.likes += (Number((r as any).likes)||0) / daysInWeek;
                cur.comments += (Number((r as any).comments)||0) / daysInWeek;
                if (platform === 'tiktok') {
                  cur.shares += (Number((r as any).shares)||0) / daysInWeek;
                  cur.saves += (Number((r as any).saves)||0) / daysInWeek;
                }
                map.set(k, cur);
              }
            }
          }
        };
        
        distributeWeekly(ttHistRows||[], 'tiktok');
        distributeWeekly(igHistRows||[], 'instagram');
      }

      // per-campaign breakdown
      const { data: campaigns } = await supa.from('campaigns').select('id, name').order('start_date', { ascending: true });
      if (campaigns && campaigns.length) {
        for (const camp of campaigns) {
          // Get TikTok and Instagram usernames from employee_*_participants tables
          const ttHandles = await deriveTTUsernames(camp.id);
          const igHandles = await deriveIGUsernames(camp.id);

          // Calculate realtime series from post_metrics_history using LAG delta
          const series_tiktok_realtime = await calcSeriesPlatform(ttHandles, 'tiktok');
          const series_instagram_realtime = await calcSeriesPlatform(igHandles, 'instagram');
          
          // Merge historical + realtime data
          const series_tiktok = keys.map(k => {
            const realtime = series_tiktok_realtime.find(s => s.date === k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            const historical = historicalMap.get('tiktok')?.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            return {
              date: k,
              views: realtime.views + historical.views,
              likes: realtime.likes + historical.likes,
              comments: realtime.comments + historical.comments,
              shares: realtime.shares + historical.shares,
              saves: realtime.saves + historical.saves,
            };
          });
          
          const series_instagram = keys.map(k => {
            const realtime = series_instagram_realtime.find(s => s.date === k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            const historical = historicalMap.get('instagram')?.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            return {
              date: k,
              views: realtime.views + historical.views,
              likes: realtime.likes + historical.likes,
              comments: realtime.comments + historical.comments,
              shares: 0, // Instagram doesn't have shares
              saves: 0,  // Instagram doesn't have saves in historical
            };
          });

          // Merge TikTok + Instagram into total series for this campaign
          const series = keys.map(k => {
            const tt = series_tiktok.find(s => s.date === k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            const ig = series_instagram.find(s => s.date === k) || { views:0, likes:0, comments:0 };
            return {
              date: k,
              views: (tt.views||0) + (ig.views||0),
              likes: (tt.likes||0) + (ig.likes||0),
              comments: (tt.comments||0) + (ig.comments||0),
              shares: tt.shares||0,
              saves: tt.saves||0,
            };
          });

          groups.push({ 
            id: camp.id, 
            name: camp.name || camp.id, 
            series, 
            series_tiktok, 
            series_instagram 
          });

          // Accumulate totals
          for (const k of keys) {
            const tt = series_tiktok.find(s => s.date === k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            const ig = series_instagram.find(s => s.date === k) || { views:0, likes:0, comments:0 };
            
            const cur = totalMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            cur.views += (tt.views||0) + (ig.views||0);
            cur.likes += (tt.likes||0) + (ig.likes||0);
            cur.comments += (tt.comments||0) + (ig.comments||0);
            cur.shares += tt.shares||0;
            cur.saves += tt.saves||0;
            totalMap.set(k, cur);
            
            const ttc = totalTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            ttc.views += tt.views||0; 
            ttc.likes += tt.likes||0; 
            ttc.comments += tt.comments||0; 
            ttc.shares += tt.shares||0; 
            ttc.saves += tt.saves||0;
            totalTTMap.set(k, ttc);
            
            const igc = totalIGMap.get(k) || { views:0, likes:0, comments:0 };
            igc.views += ig.views||0; 
            igc.likes += ig.likes||0; 
            igc.comments += ig.comments||0;
            totalIGMap.set(k, igc);
          }
        }
      }

      // Build total arrays from maps (already include fallbacks)
      let total = keys.map(k=> ({ date:k, ...(totalMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 }) }));
      let total_tiktok = keys.map(k=> ({ date:k, ...(totalTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 }) }));
      let total_instagram = keys.map(k=> ({ date:k, ...(totalIGMap.get(k) || { views:0, likes:0, comments:0 }) as any } as any));

      // Apply accrual cutoff to ALL platforms server-side for robustness
      const u = new URL(req.url);
      const cutoff = String(u.searchParams.get('cutoff') || process.env.ACCRUAL_CUTOFF_DATE || '2026-01-02');
      const trim = u.searchParams.get('trim') === '1';
      const zeroBefore = (arr:any[] = []) => arr.map((s:any)=> (String(s.date) <= cutoff ? { ...s, views:0, likes:0, comments:0, shares:0, saves:0 } : s));
      total = zeroBefore(total);
      total_tiktok = zeroBefore(total_tiktok);
      total_instagram = zeroBefore(total_instagram);
      if (trim) {
        const keep = (s:any)=> String(s.date) >= cutoff;
        total = total.filter(keep);
        total_tiktok = total_tiktok.filter(keep);
        total_instagram = total_instagram.filter(keep);
      }
      let maskedGroups = groups.map((g:any)=> ({
        ...g,
        series: zeroBefore(g.series||[]),
        series_tiktok: zeroBefore(g.series_tiktok||[]),
        series_instagram: zeroBefore(g.series_instagram||[]),
      }));
      if (trim) {
        const keep = (s:any)=> String(s.date) >= cutoff;
        maskedGroups = maskedGroups.map((g:any)=> ({
          ...g,
          series: (g.series||[]).filter(keep),
          series_tiktok: (g.series_tiktok||[]).filter(keep),
          series_instagram: (g.series_instagram||[]).filter(keep),
        }));
      }

      const totals = total.reduce((acc:any, s:any)=>({ views:acc.views+s.views, likes:acc.likes+s.likes, comments:acc.comments+s.comments, shares:acc.shares+s.shares, saves:acc.saves+s.saves }), { views:0, likes:0, comments:0, shares:0, saves:0 });

      return NextResponse.json({ interval: 'daily', start, end, groups: maskedGroups, total, total_tiktok, total_instagram, totals, mode:'accrual' });
    }

    // get all campaigns (groups) for post date series
    const { data: campaigns, error: cErr } = await supa
      .from('campaigns')
      .select('id, name')
      .order('start_date', { ascending: true });
    if (cErr) throw cErr;

    const groups: Array<{ id: string; name: string; series: Array<{date:string; views:number; likes:number; comments:number; shares:number; saves:number}>, series_tiktok?: Array<{date:string; views:number; likes:number; comments:number; shares:number; saves:number}>, series_instagram?: Array<{date:string; views:number; likes:number; comments:number}> }>=[];

    // accumulate total by date across groups
    const totalMap = new Map<string, { views:number; likes:number; comments:number; shares:number; saves:number }>();
    // also keep platform-separated totals for legend sync
    const totalTTMap = new Map<string, { views:number; likes:number; comments:number; shares:number; saves:number }>();
    const totalIGMap = new Map<string, { views:number; likes:number; comments:number }>();

    // helpers for zero-fill keys
    const buildKeys = (mode: 'daily'|'weekly'|'monthly', s: string, e: string): string[] => {
      const keys: string[] = [];
      const ds = new Date(s+'T00:00:00Z');
      const de = new Date(e+'T00:00:00Z');
      if (mode === 'daily') {
        for (let d = new Date(ds); d <= de; d.setUTCDate(d.getUTCDate()+1)) keys.push(d.toISOString().slice(0,10));
      } else if (mode === 'weekly') {
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
    };
    const keys = buildKeys(interval, startISO!, endISO!);
    
    // HISTORICAL DATA for Post Date mode: Load weekly_historical_data for period < 2026-01-23
    const historicalCutoffPostdate = new Date('2026-01-23T00:00:00Z');
    const historicalCutoffISOPostdate = '2026-01-23';
    const historicalMapPostdate = new Map<string, Map<string, {views:number;likes:number;comments:number;shares:number;saves:number}>>();
    
    if (new Date(startISO! + 'T00:00:00Z') < historicalCutoffPostdate) {
      // Query TikTok historical data
      const { data: ttHistRows } = await supa
        .from('weekly_historical_data')
        .select('week_label, start_date, end_date, platform, views, likes, comments, shares, saves')
        .eq('platform', 'tiktok')
        .gte('start_date', startISO!)
        .lt('start_date', historicalCutoffISOPostdate);
      
      // Query Instagram historical data  
      const { data: igHistRows } = await supa
        .from('weekly_historical_data')
        .select('week_label, start_date, end_date, platform, views, likes, comments')
        .eq('platform', 'instagram')
        .gte('start_date', startISO!)
        .lt('start_date', historicalCutoffISOPostdate);
      
      // Distribute weekly data across weekly keys (assign ONCE per week)
      const distributeWeeklyPostdate = (rows: any[], platform: 'tiktok'|'instagram') => {
        for (const r of rows||[]) {
          const weekStart = String((r as any).start_date);
          const weekEnd = String((r as any).end_date);
          // Find the first weekly key falling inside this historical week
          const targetKey = keys.find(k => k >= weekStart && k <= weekEnd);
          if (!targetKey) continue;
          const platformKey = platform;
          if (!historicalMapPostdate.has(platformKey)) historicalMapPostdate.set(platformKey, new Map());
          const map = historicalMapPostdate.get(platformKey)!;
          const cur = map.get(targetKey) || { views:0, likes:0, comments:0, shares:0, saves:0 };
          cur.views += Number((r as any).views)||0;
          cur.likes += Number((r as any).likes)||0;
          cur.comments += Number((r as any).comments)||0;
          if (platform === 'tiktok') {
            cur.shares += Number((r as any).shares)||0;
            cur.saves += Number((r as any).saves)||0;
          }
          map.set(targetKey, cur);
        }
      };
      
      distributeWeeklyPostdate(ttHistRows||[], 'tiktok');
      distributeWeeklyPostdate(igHistRows||[], 'instagram');
    }

    // (moved to deriveIGUsernamesForCampaign above)

    const aggInstagramSeries = async (handles: string[], startISO: string, endISO: string, interval: 'daily'|'weekly'|'monthly') => {
      if (!handles.length) return new Map<string, { views:number; likes:number; comments:number }>();
      const map = new Map<string, { views:number; likes:number; comments:number }>();
      const base = supa.from('instagram_posts_daily')
        .select('username, taken_at, play_count, like_count, comment_count')
        .in('username', handles)
        .gte('taken_at', startISO + 'T00:00:00Z')
        .lte('taken_at', endISO + 'T23:59:59Z');
      const { data: rows } = await base;
      for (const r of rows||[]) {
        let key: string;
        const dStr = new Date((r as any).taken_at).toISOString().slice(0,10);
        if (interval === 'monthly') {
          const d = new Date(dStr+'T00:00:00Z');
          key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0,10);
        } else if (interval === 'weekly') {
          const d = new Date(dStr+'T00:00:00Z');
          const day = d.getUTCDay();
          const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((day+6)%7));
          key = monday.toISOString().slice(0,10);
        } else {
          key = dStr;
        }
        const cur = map.get(key) || { views:0, likes:0, comments:0 };
        cur.views += Number((r as any).play_count)||0;
        cur.likes += Number((r as any).like_count)||0;
        cur.comments += Number((r as any).comment_count)||0;
        map.set(key, cur);
      }
      return map;
    };

    for (const camp of campaigns || []) {
      // TikTok series via RPC
      const { data: seriesRows } = await supa
        .rpc('campaign_series_v2', {
          campaign: camp.id,
          start_date: startISO,
          end_date: endISO,
          p_interval: interval,
        } as any);
      const ttRaw = (seriesRows || []).map((r:any)=>({
        date: String(r.bucket_date),
        views: Number(r.views)||0,
        likes: Number(r.likes)||0,
        comments: Number(r.comments)||0,
        shares: Number(r.shares)||0,
        saves: Number(r.saves)||0,
      }));
      const ttMap = new Map(ttRaw.map(s=>[s.date, s] as const));

      // Instagram series aggregated from instagram_posts_daily for this campaign
      const igHandles = await deriveIGUsernamesForCampaign(supa, camp.id);
      const igMap = await aggInstagramSeries(igHandles, startISO!, endISO!, interval);

      // zero-fill per date key and MERGE ONLY REALTIME per campaign (historical will be added once globally)
      const series = keys.map(k => {
        const rawTT = ttMap.get(k) || { date:k, views:0, likes:0, comments:0, shares:0, saves:0 };
        const rawIG = igMap.get(k) || { views:0, likes:0, comments:0 };
        // Hide realtime before cutoff
        const tt = (k >= historicalCutoffISOPostdate) ? rawTT : { date:k, views:0, likes:0, comments:0, shares:0, saves:0 };
        const ig = (k >= historicalCutoffISOPostdate) ? rawIG : { views:0, likes:0, comments:0 };
        return {
          date: k,
          views: tt.views + ig.views,
          likes: tt.likes + ig.likes,
          comments: tt.comments + ig.comments,
          shares: tt.shares,
          saves: tt.saves,
        };
      });
      // Platform-separated series for this campaign (for consistent UI legends)
      const series_tiktok = keys.map(k => {
        const base = ttMap.get(k) || { date:k, views:0, likes:0, comments:0, shares:0, saves:0 };
        const tt = (k >= historicalCutoffISOPostdate) ? base : { date:k, views:0, likes:0, comments:0, shares:0, saves:0 };
        return { date: k, views: tt.views, likes: tt.likes, comments: tt.comments, shares: tt.shares, saves: tt.saves };
      });
      const series_instagram = keys.map(k => {
        const base = igMap.get(k) || { views:0, likes:0, comments:0 };
        const ig = (k >= historicalCutoffISOPostdate) ? base : { views:0, likes:0, comments:0 };
        return { date: k, views: ig.views, likes: ig.likes, comments: ig.comments } as any;
      });

      groups.push({ id: camp.id, name: camp.name || camp.id, series, series_tiktok, series_instagram });
      for (const s of series) {
        const cur = totalMap.get(s.date) || { views:0, likes:0, comments:0, shares:0, saves:0 };
        cur.views += s.views; cur.likes += s.likes; cur.comments += s.comments; cur.shares += s.shares; cur.saves += s.saves;
        totalMap.set(s.date, cur);
      }
      // accumulate platform-separated totals (realtime only here; historical will be added once globally below)
      for (const k of keys) {
        const baseTT = ttMap.get(k) || { date:k, views:0, likes:0, comments:0, shares:0, saves:0 };
        const baseIG = igMap.get(k) || { views:0, likes:0, comments:0 };
        const tt = (k >= historicalCutoffISOPostdate) ? baseTT : { date:k, views:0, likes:0, comments:0, shares:0, saves:0 };
        const ig = (k >= historicalCutoffISOPostdate) ? baseIG : { views:0, likes:0, comments:0 };
        const ttCur = totalTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
        ttCur.views += tt.views; ttCur.likes += tt.likes; ttCur.comments += tt.comments; ttCur.shares += tt.shares; ttCur.saves += tt.saves;
        totalTTMap.set(k, ttCur);
        const igCur = totalIGMap.get(k) || { views:0, likes:0, comments:0 };
        igCur.views += ig.views; igCur.likes += ig.likes; igCur.comments += ig.comments;
        totalIGMap.set(k, igCur);
      }
    }

    // Build total series with zero-fill to ensure full range
    // After processing all groups, add historical ONCE globally to totals
    for (const k of keys) {
      const histTT = historicalMapPostdate.get('tiktok')?.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const histIG = historicalMapPostdate.get('instagram')?.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      const base = totalMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      base.views += (histTT.views||0) + (histIG.views||0);
      base.likes += (histTT.likes||0) + (histIG.likes||0);
      base.comments += (histTT.comments||0) + (histIG.comments||0);
      base.shares += (histTT.shares||0);
      base.saves += (histTT.saves||0);
      totalMap.set(k, base);
      const ttv = totalTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      ttv.views += histTT.views||0; ttv.likes += histTT.likes||0; ttv.comments += histTT.comments||0; ttv.shares += histTT.shares||0; ttv.saves += histTT.saves||0;
      totalTTMap.set(k, ttv);
      const igv = totalIGMap.get(k) || { views:0, likes:0, comments:0 };
      igv.views += histIG.views||0; igv.likes += histIG.likes||0; igv.comments += histIG.comments||0;
      totalIGMap.set(k, igv);
    }

    const totalFilled = keys.map(k => {
      const v = totalMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      return { date: k, ...v };
    });
    const totalTT = keys.map(k => {
      const v = totalTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
      return { date: k, ...v };
    });
    const totalIG = keys.map(k => {
      const v = totalIGMap.get(k) || { views:0, likes:0, comments:0 };
      return { date: k, views: v.views, likes: v.likes, comments: v.comments, shares: 0, saves: 0 };
    });

    // Totals summary computed from series for consistency with chart
    const totals = totalFilled.reduce((acc:any, s:any)=>({
      views: acc.views + (s.views||0),
      likes: acc.likes + (s.likes||0),
      comments: acc.comments + (s.comments||0),
      shares: acc.shares + (s.shares||0),
      saves: acc.saves + (s.saves||0),
    }), { views:0, likes:0, comments:0, shares:0, saves:0 });

    return NextResponse.json({ interval, start: startISO, end: endISO, groups, total: totalFilled, total_tiktok: totalTT, total_instagram: totalIG, totals });
  } catch (e:any) {
    // Tambahkan stack trace ke response agar error detail bisa dilihat
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}
