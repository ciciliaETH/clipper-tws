import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

export async function GET(req: Request) {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const supa = adminClient();
    const url = new URL(req.url);
    const startISO = String(url.searchParams.get('start') || '2025-08-02'); // Default: 2 Agustus 2025
    const endISO = String(url.searchParams.get('end') || new Date().toISOString().slice(0,10)); // Default: hari ini
    // Force weekly + postdate everywhere
    const interval = 'weekly';
    const mode = 'postdate';
    const cutoff = String(url.searchParams.get('cutoff') || process.env.ACCRUAL_CUTOFF_DATE || '2026-01-02');

    // Get accounts from existing tables
    const { data: ttRows } = await supa.from('user_tiktok_usernames').select('tiktok_username');
    const { data: igRows } = await supa.from('user_instagram_usernames').select('instagram_username');
    const { data: ytRows } = await supa.from('user_youtube_channels').select('youtube_channel_id');
    
    const accounts: { platform: string; username: string; label: string | null }[] = [];
    for (const r of ttRows || []) {
      if (r.tiktok_username) accounts.push({ platform: 'tiktok', username: String(r.tiktok_username).trim().toLowerCase(), label: null });
    }
    for (const r of igRows || []) {
      if (r.instagram_username) accounts.push({ platform: 'instagram', username: String(r.instagram_username).trim().toLowerCase(), label: null });
    }
    for (const r of ytRows || []) {
      if (r.youtube_channel_id) accounts.push({ platform: 'youtube', username: String(r.youtube_channel_id).trim(), label: null });
    }
    
    if (!accounts.length) return NextResponse.json({ accounts: [], series: [], start: startISO, end: endISO, interval, mode });

    const keys: string[] = [];
    const ds = new Date(startISO+'T00:00:00Z');
    const de = new Date(endISO+'T00:00:00Z');
    for (let d=new Date(ds); d<=de; d.setUTCDate(d.getUTCDate()+1)) keys.push(d.toISOString().slice(0,10));

    type Point = { date:string; views:number; likes:number; comments:number; shares?:number; saves?:number };
    const byAccount: Record<string, Point[]> = {};

    const fillZeros = ():Point[] => keys.map(k=>({ date:k, views:0, likes:0, comments:0, shares:0, saves:0 }));

    if (mode === 'postdate') {
      // Mode postdate combines:
      // 1. HISTORICAL DATA (2025-08-02 to 2026-02-04): From weekly_historical_data table
      // 2. REALTIME DATA (after 2026-02-04): From posts_daily aggregated by taken_at
      
      const historicalCutoff = new Date('2026-02-05T00:00:00Z');
      const cutoffDate = new Date(cutoff + 'T00:00:00Z');
      
      const ttHandles = accounts.filter(a=>a.platform==='tiktok').map(a=>a.username);
      const igHandles = accounts.filter(a=>a.platform==='instagram').map(a=>a.username);
      const ytHandles = accounts.filter(a=>a.platform==='youtube').map(a=>a.username);
      
      // PART 1: Query weekly_historical_data for dates < 2026-02-05
      const historicalStart = new Date(startISO + 'T00:00:00Z');
      const historicalEnd = new Date(Math.min(new Date(endISO + 'T23:59:59Z').getTime(), historicalCutoff.getTime()));
      
      if (historicalStart < historicalCutoff) {
        // Query TikTok historical data
        if (ttHandles.length) {
          const { data: rows } = await supa
            .from('weekly_historical_data')
            .select('week_label, start_date, end_date, platform, views, likes, comments, shares, saves')
            .eq('platform', 'tiktok')
            .gte('start_date', startISO)
            .lt('start_date', '2026-02-05');
          
          for (const a of accounts.filter(a=>a.platform==='tiktok')) {
            const key = `tiktok:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const weekStart = String((r as any).start_date);
            const weekEnd = String((r as any).end_date);
            
            // Calculate number of days in this week range
            const dStart = new Date(weekStart);
            const dEnd = new Date(weekEnd);
            const daysInWeek = Math.round((dEnd.getTime() - dStart.getTime()) / (1000*60*60*24)) + 1;
            
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k >= weekStart && k <= weekEnd) {
                // Distribute weekly total across all days (divide by days)
                const dailyViews = Math.round(Number((r as any).views) / daysInWeek);
                const dailyLikes = Math.round(Number((r as any).likes) / daysInWeek);
                const dailyComments = Math.round(Number((r as any).comments) / daysInWeek);
                const dailyShares = Math.round(Number((r as any).shares) / daysInWeek);
                const dailySaves = Math.round(Number((r as any).saves) / daysInWeek);
                
                // Assign to each user account (historical data: NO cutoff filter)
                for (const a of accounts.filter(a=>a.platform==='tiktok')) {
                  const key = `tiktok:${a.username}`;
                  const arr = byAccount[key];
                  if (!arr) continue;
                  
                  arr[i].views += dailyViews;
                  arr[i].likes += dailyLikes;
                  arr[i].comments += dailyComments;
                  arr[i].shares = (arr[i].shares||0) + dailyShares;
                  arr[i].saves = (arr[i].saves||0) + dailySaves;
                }
              }
            }
          }
        }
        
        // Query YouTube historical data
        if (ytHandles.length) {
          const { data: rows } = await supa
            .from('weekly_historical_data')
            .select('week_label, start_date, end_date, platform, views, likes, comments')
            .ilike('platform', 'youtube')
            .gte('start_date', startISO)
            .lt('start_date', '2026-02-05');
          
          for (const a of accounts.filter(a=>a.platform==='youtube')) {
            const key = `youtube:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const weekStart = String((r as any).start_date);
            const weekEnd = String((r as any).end_date);
            
            // Calculate number of days in this week range
            const dStart = new Date(weekStart);
            const dEnd = new Date(weekEnd);
            const daysInWeek = Math.round((dEnd.getTime() - dStart.getTime()) / (1000*60*60*24)) + 1;
            
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k >= weekStart && k <= weekEnd) {
                // Distribute weekly total across all days (divide by days)
                const dailyViews = Math.round(Number((r as any).views) / daysInWeek);
                const dailyLikes = Math.round(Number((r as any).likes) / daysInWeek);
                const dailyComments = Math.round(Number((r as any).comments) / daysInWeek);
                
                // Assign to each user account (historical data: NO cutoff filter)
                for (const a of accounts.filter(a=>a.platform==='youtube')) {
                  const key = `youtube:${a.username}`;
                  const arr = byAccount[key];
                  if (!arr) continue;
                  
                  arr[i].views += dailyViews;
                  arr[i].likes += dailyLikes;
                  arr[i].comments += dailyComments;
                }
              }
            }
          }
        }
        
        // Query Instagram historical data
        if (igHandles.length) {
          const { data: rows } = await supa
            .from('weekly_historical_data')
            .select('week_label, start_date, end_date, platform, views, likes, comments')
            .eq('platform', 'instagram')
            .gte('start_date', startISO)
            .lt('start_date', '2026-02-05');
          
          for (const a of accounts.filter(a=>a.platform==='instagram')) {
            const key = `instagram:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const weekStart = String((r as any).start_date);
            const weekEnd = String((r as any).end_date);
            
            // Calculate number of days in this week range
            const dStart = new Date(weekStart);
            const dEnd = new Date(weekEnd);
            const daysInWeek = Math.round((dEnd.getTime() - dStart.getTime()) / (1000*60*60*24)) + 1;
            
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k >= weekStart && k <= weekEnd) {
                // Distribute weekly total across all days (divide by days)
                const dailyViews = Math.round(Number((r as any).views) / daysInWeek);
                const dailyLikes = Math.round(Number((r as any).likes) / daysInWeek);
                const dailyComments = Math.round(Number((r as any).comments) / daysInWeek);
                
                // Assign to each user account (historical data: NO cutoff filter)
                for (const a of accounts.filter(a=>a.platform==='instagram')) {
                  const key = `instagram:${a.username}`;
                  const arr = byAccount[key];
                  if (!arr) continue;
                  
                  arr[i].views += dailyViews;
                  arr[i].likes += dailyLikes;
                  arr[i].comments += dailyComments;
                }
              }
            }
          }
        }
      }
      
      // PART 2: Query posts_daily for dates >= 2026-01-23 (realtime data)
      if (new Date(endISO + 'T23:59:59Z') >= historicalCutoff) {
        const realtimeStart = new Date(Math.max(new Date(startISO + 'T00:00:00Z').getTime(), historicalCutoff.getTime()));
        const realtimeStartISO = realtimeStart.toISOString().slice(0, 10);
        
        // Query TikTok posts_daily
        // Query TikTok posts_daily
        if (ttHandles.length) {
          const { data: rows } = await supa
            .from('tiktok_posts_daily')
            .select('username, taken_at, play_count, digg_count, comment_count, share_count, save_count')
            .in('username', ttHandles)
            .gte('taken_at', realtimeStartISO + 'T00:00:00Z')
            .lte('taken_at', endISO + 'T23:59:59Z');
          
          for (const a of accounts.filter(a=>a.platform==='tiktok')) {
            const key = `tiktok:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const u = String((r as any).username);
            const takenAt = new Date((r as any).taken_at);
            const k = takenAt.toISOString().slice(0,10);
            const key = `tiktok:${u}`;
            const arr = byAccount[key];
            if (!arr) continue;
            
            const keyIdx = keys.indexOf(k);
            if (keyIdx === -1) continue;
            
            // Only count if taken_at >= cutoff
            if (takenAt >= cutoffDate) {
              arr[keyIdx].views += Number((r as any).play_count)||0;
              arr[keyIdx].likes += Number((r as any).digg_count)||0;
              arr[keyIdx].comments += Number((r as any).comment_count)||0;
              arr[keyIdx].shares = (arr[keyIdx].shares||0) + (Number((r as any).share_count)||0);
              arr[keyIdx].saves = (arr[keyIdx].saves||0) + (Number((r as any).save_count)||0);
            }
          }
        }
        
        // Query Instagram posts_daily
        if (igHandles.length) {
          const { data: rows } = await supa
            .from('instagram_posts_daily')
            .select('username, taken_at, play_count, like_count, comment_count')
            .in('username', igHandles)
            .gte('taken_at', realtimeStartISO + 'T00:00:00Z')
            .lte('taken_at', endISO + 'T23:59:59Z');
          
          for (const a of accounts.filter(a=>a.platform==='instagram')) {
            const key = `instagram:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const u = String((r as any).username);
            const takenAt = new Date((r as any).taken_at);
            const k = takenAt.toISOString().slice(0,10);
            const key = `instagram:${u}`;
            const arr = byAccount[key];
            if (!arr) continue;
            
            const keyIdx = keys.indexOf(k);
            if (keyIdx === -1) continue;
            
            // Only count if taken_at >= cutoff
            if (takenAt >= cutoffDate) {
              arr[keyIdx].views += Number((r as any).play_count)||0;
              arr[keyIdx].likes += Number((r as any).like_count)||0;
              arr[keyIdx].comments += Number((r as any).comment_count)||0;
            }
          }
        }
        
        // Query YouTube posts_daily
        if (ytHandles.length) {
          const { data: rows } = await supa
            .from('youtube_posts_daily')
            .select('channel_id, post_date, views, likes, comments')
            .in('channel_id', ytHandles)
            .gte('post_date', realtimeStartISO)
            .lte('post_date', endISO);
          
          for (const a of accounts.filter(a=>a.platform==='youtube')) {
            const key = `youtube:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
           
          for (const r of rows||[]) {
            const channelId = String((r as any).channel_id); // This is the username in our system
            const postDate = new Date((r as any).post_date); // It's just a date YYYY-MM-DD
            const k = postDate.toISOString().slice(0,10);
            
            // Channel ID in youtube_posts_daily should match username if we refreshed correctly
            const key = `youtube:${channelId}`;
            const arr = byAccount[key];
            if (!arr) continue;
            
            const keyIdx = keys.indexOf(k);
            if (keyIdx === -1) continue;
            
            // Only count if post_date >= cutoff
            if (postDate >= cutoffDate) {
              arr[keyIdx].views += Number((r as any).views)||0;
              arr[keyIdx].likes += Number((r as any).likes)||0;
              arr[keyIdx].comments += Number((r as any).comments)||0;
            }
          }
        }
      }
    } else {
      // Mode accrual: Daily growth/deltas per post
      // 1. HISTORICAL DATA (2025-08-02 to 2026-02-04): From weekly_historical_data
      // 2. REALTIME DATA (after 2026-02-04): From post_metrics_history with LAG() delta calculation
      
      const historicalCutoff = new Date('2026-02-05T00:00:00Z');
      const cutoffDate = new Date(cutoff + 'T00:00:00Z');
      
      const ttHandles = accounts.filter(a=>a.platform==='tiktok').map(a=>a.username);
      const igHandles = accounts.filter(a=>a.platform==='instagram').map(a=>a.username);
      const ytHandles = accounts.filter(a=>a.platform==='youtube').map(a=>a.username);
      
      // PART 1: Query weekly_historical_data for dates < 2026-01-23 (SAME AS POSTDATE)
      const historicalStart = new Date(startISO + 'T00:00:00Z');
      const historicalEnd = new Date(Math.min(new Date(endISO + 'T23:59:59Z').getTime(), historicalCutoff.getTime()));
      
      if (historicalStart < historicalCutoff) {
        // Query TikTok historical data
        if (ttHandles.length) {
          const { data: rows } = await supa
            .from('weekly_historical_data')
            .select('week_label, start_date, end_date, platform, views, likes, comments, shares, saves')
            .eq('platform', 'tiktok')
            .gte('start_date', startISO)
            .lt('start_date', '2026-02-05');
          
          for (const a of accounts.filter(a=>a.platform==='tiktok')) {
            const key = `tiktok:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const weekStart = String((r as any).start_date);
            const weekEnd = String((r as any).end_date);
            
            // Calculate number of days in this week range
            const dStart = new Date(weekStart);
            const dEnd = new Date(weekEnd);
            const daysInWeek = Math.round((dEnd.getTime() - dStart.getTime()) / (1000*60*60*24)) + 1;
            
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k >= weekStart && k <= weekEnd) {
                // Distribute weekly total across all days (divide by days)
                const dailyViews = Math.round(Number((r as any).views) / daysInWeek);
                const dailyLikes = Math.round(Number((r as any).likes) / daysInWeek);
                const dailyComments = Math.round(Number((r as any).comments) / daysInWeek);
                const dailyShares = Math.round(Number((r as any).shares) / daysInWeek);
                const dailySaves = Math.round(Number((r as any).saves) / daysInWeek);
                
                // Assign to each user account (historical data: NO cutoff filter)
                for (const a of accounts.filter(a=>a.platform==='tiktok')) {
                  const key = `tiktok:${a.username}`;
                  const arr = byAccount[key];
                  if (!arr) continue;
                  
                  arr[i].views += dailyViews;
                  arr[i].likes += dailyLikes;
                  arr[i].comments += dailyComments;
                  arr[i].shares = (arr[i].shares||0) + dailyShares;
                  arr[i].saves = (arr[i].saves||0) + dailySaves;
                }
              }
            }
          }
        }
        
        // Query YouTube historical data
        if (ytHandles.length) {
          const { data: rows } = await supa
            .from('weekly_historical_data')
            .select('week_label, start_date, end_date, platform, views, likes, comments')
            .ilike('platform', 'youtube')
            .gte('start_date', startISO)
            .lt('start_date', '2026-02-05');
          
          for (const a of accounts.filter(a=>a.platform==='youtube')) {
            const key = `youtube:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const weekStart = String((r as any).start_date);
            const weekEnd = String((r as any).end_date);
            const dStart = new Date(weekStart);
            const dEnd = new Date(weekEnd);
            const daysInWeek = Math.round((dEnd.getTime() - dStart.getTime()) / (1000*60*60*24)) + 1;
            
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k >= weekStart && k <= weekEnd) {
                const dailyViews = Math.round(Number((r as any).views) / daysInWeek);
                const dailyLikes = Math.round(Number((r as any).likes) / daysInWeek);
                const dailyComments = Math.round(Number((r as any).comments) / daysInWeek);
                
                for (const a of accounts.filter(a=>a.platform==='youtube')) {
                  const key = `youtube:${a.username}`;
                  const arr = byAccount[key];
                  if (!arr) continue;
                  arr[i].views += dailyViews;
                  arr[i].likes += dailyLikes;
                  arr[i].comments += dailyComments;
                }
              }
            }
          }
        }
        
        // Query Instagram historical data
        if (igHandles.length) {
          const { data: rows } = await supa
            .from('weekly_historical_data')
            .select('week_label, start_date, end_date, platform, views, likes, comments')
            .eq('platform', 'instagram')
            .gte('start_date', startISO)
            .lt('start_date', '2026-02-05');
          
          for (const a of accounts.filter(a=>a.platform==='instagram')) {
            const key = `instagram:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          for (const r of rows||[]) {
            const weekStart = String((r as any).start_date);
            const weekEnd = String((r as any).end_date);
            
            // Calculate number of days in this week range
            const dStart = new Date(weekStart);
            const dEnd = new Date(weekEnd);
            const daysInWeek = Math.round((dEnd.getTime() - dStart.getTime()) / (1000*60*60*24)) + 1;
            
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k >= weekStart && k <= weekEnd) {
                // Distribute weekly total across all days (divide by days)
                const dailyViews = Math.round(Number((r as any).views) / daysInWeek);
                const dailyLikes = Math.round(Number((r as any).likes) / daysInWeek);
                const dailyComments = Math.round(Number((r as any).comments) / daysInWeek);
                
                // Assign to each user account (historical data: NO cutoff filter)
                for (const a of accounts.filter(a=>a.platform==='instagram')) {
                  const key = `instagram:${a.username}`;
                  const arr = byAccount[key];
                  if (!arr) continue;
                  
                  arr[i].views += dailyViews;
                  arr[i].likes += dailyLikes;
                  arr[i].comments += dailyComments;
                }
              }
            }
          }
        }
      }
      
      // PART 2: Query post_metrics_history for dates >= 2026-01-23 (DELTA CALCULATION)
      if (new Date(endISO + 'T23:59:59Z') >= historicalCutoff) {
        const realtimeStart = new Date(Math.max(new Date(startISO + 'T00:00:00Z').getTime(), historicalCutoff.getTime()));
        const realtimeStartISO = realtimeStart.toISOString().slice(0, 10);
        
        // Query TikTok post_metrics_history
        if (ttHandles.length) {
          const { data: rows } = await supa
            .from('tiktok_post_metrics_history')
            .select('post_id, username, captured_at, play_count, digg_count, comment_count, share_count, save_count')
            .in('username', ttHandles)
            .gte('captured_at', realtimeStartISO + 'T00:00:00Z')
            .lte('captured_at', endISO + 'T23:59:59Z')
            .order('post_id')
            .order('captured_at');
          
          for (const a of accounts.filter(a=>a.platform==='tiktok')) {
            const key = `tiktok:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          // Group by post_id for delta calculation
          const byPost = new Map<string, any[]>();
          for (const r of rows||[]) {
            const postId = String((r as any).post_id);
            if (!byPost.has(postId)) byPost.set(postId, []);
            byPost.get(postId)!.push(r);
          }
          
          // Calculate deltas per post (LAG comparison)
          for (const [postId, snaps] of byPost.entries()) {
            snaps.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
            
            for (let i = 1; i < snaps.length; i++) {
              const prev = snaps[i-1];
              const curr = snaps[i];
              const username = String((curr as any).username);
              const capturedDate = new Date((curr as any).captured_at);
              const dateKey = capturedDate.toISOString().slice(0, 10);
              const keyIdx = keys.indexOf(dateKey);
              
              if (keyIdx === -1) continue;
              
              const key = `tiktok:${username}`;
              const arr = byAccount[key];
              if (!arr) continue;
              
              // Only count if captured_at >= cutoff
              if (capturedDate >= cutoffDate) {
                const deltaViews = Math.max(0, Number((curr as any).play_count||0) - Number((prev as any).play_count||0));
                const deltaLikes = Math.max(0, Number((curr as any).digg_count||0) - Number((prev as any).digg_count||0));
                const deltaComments = Math.max(0, Number((curr as any).comment_count||0) - Number((prev as any).comment_count||0));
                const deltaShares = Math.max(0, Number((curr as any).share_count||0) - Number((prev as any).share_count||0));
                const deltaSaves = Math.max(0, Number((curr as any).save_count||0) - Number((prev as any).save_count||0));
                
                arr[keyIdx].views += deltaViews;
                arr[keyIdx].likes += deltaLikes;
                arr[keyIdx].comments += deltaComments;
                arr[keyIdx].shares = (arr[keyIdx].shares||0) + deltaShares;
                arr[keyIdx].saves = (arr[keyIdx].saves||0) + deltaSaves;
              }
            }
          }
        }
        
        // Query Instagram post_metrics_history
        if (igHandles.length) {
          const { data: rows } = await supa
            .from('instagram_post_metrics_history')
            .select('post_id, username, captured_at, play_count, like_count, comment_count')
            .in('username', igHandles)
            .gte('captured_at', realtimeStartISO + 'T00:00:00Z')
            .lte('captured_at', endISO + 'T23:59:59Z')
            .order('post_id')
            .order('captured_at');
          
          for (const a of accounts.filter(a=>a.platform==='instagram')) {
            const key = `instagram:${a.username}`;
            if (!byAccount[key]) byAccount[key] = fillZeros();
          }
          
          // Group by post_id for delta calculation
          const byPost = new Map<string, any[]>();
          for (const r of rows||[]) {
            const postId = String((r as any).post_id);
            if (!byPost.has(postId)) byPost.set(postId, []);
            byPost.get(postId)!.push(r);
          }
          
          // Calculate deltas per post (LAG comparison)
          for (const [postId, snaps] of byPost.entries()) {
            snaps.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
            
            for (let i = 1; i < snaps.length; i++) {
              const prev = snaps[i-1];
              const curr = snaps[i];
              const username = String((curr as any).username);
              const capturedDate = new Date((curr as any).captured_at);
              const dateKey = capturedDate.toISOString().slice(0, 10);
              const keyIdx = keys.indexOf(dateKey);
              
              if (keyIdx === -1) continue;
              
              const key = `instagram:${username}`;
              const arr = byAccount[key];
              if (!arr) continue;
              
              // Only count if captured_at >= cutoff
              if (capturedDate >= cutoffDate) {
                const deltaViews = Math.max(0, Number((curr as any).play_count||0) - Number((prev as any).play_count||0));
                const deltaLikes = Math.max(0, Number((curr as any).like_count||0) - Number((prev as any).like_count||0));
                const deltaComments = Math.max(0, Number((curr as any).comment_count||0) - Number((prev as any).comment_count||0));
                
                arr[keyIdx].views += deltaViews;
                arr[keyIdx].likes += deltaLikes;
                arr[keyIdx].comments += deltaComments;
              }
            }
          }
        }
      }
    }

    // NO cutoff masking for historical data - it's already validated
    // Cutoff only applies to realtime data which is filtered during query
    // const cutoffStr = cutoff;
    // const mask = (arr:Point[])=> (arr||[]).map(p=> (String(p.date) < cutoffStr ? { ...p, views:0, likes:0, comments:0, shares:0, saves:0 } : p));
    // for (const k of Object.keys(byAccount)) byAccount[k] = mask(byAccount[k]);

    // Group for response: one series per tracked account (platform+username)
    const series = Object.entries(byAccount).map(([key, arr])=> ({ key, series: arr }));

    return NextResponse.json({ start: startISO, end: endISO, interval, mode, cutoff, series, accounts });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
