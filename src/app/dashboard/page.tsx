'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { format, parseISO } from 'date-fns';
import { id as localeID } from 'date-fns/locale';
import TopViralDashboard from '@/components/TopViralDashboard';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

export default function DashboardTotalPage() {
  const [interval, setIntervalVal] = useState<'daily'|'weekly'|'monthly'>('weekly');
  const [metric, setMetric] = useState<'views'|'likes'|'comments'>('views');
  // Default start: 2025-08-02 to include historical data
  const [start, setStart] = useState<string>('2025-08-02');
  const [end, setEnd] = useState<string>(()=> new Date().toISOString().slice(0,10));
  const [mode, setMode] = useState<'postdate'|'accrual'>('postdate');
  const [accrualWindow, setAccrualWindow] = useState<7|28|60>(7);
  const [useCustomAccrualDates, setUseCustomAccrualDates] = useState<boolean>(true); // Changed to true
  const [accrualCustomStart, setAccrualCustomStart] = useState<string>(() => {
    // Default to start of August 2025 to show historical data
    return '2025-08-02';
  });
  const [accrualCustomEnd, setAccrualCustomEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [weeklyView, setWeeklyView] = useState<boolean>(true); // Changed to true
  const [platformFilter, setPlatformFilter] = useState<'all'|'tiktok'|'instagram'>('all');
  const [showHistorical, setShowHistorical] = useState<boolean>(true); // Changed to true
  const [showPosts, setShowPosts] = useState<boolean>(true); // Show posts line on chart
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [postsData, setPostsData] = useState<any[]>([]); // Posts per day/period
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [activeCampaignName, setActiveCampaignName] = useState<string | null>(null);
  const accrualCutoff = (process.env.NEXT_PUBLIC_ACCRUAL_CUTOFF_DATE as string) || '2026-01-02';

  const palette = ['#3b82f6','#ef4444','#22c55e','#eab308','#8b5cf6','#06b6d4','#f97316','#f43f5e','#10b981'];

  const load = async () => {
    setLoading(true);
    try {
      // effective window for accrual presets or custom dates
      const todayStr = new Date().toISOString().slice(0,10);
      const accStart = (()=>{ const d=new Date(); d.setUTCDate(d.getUTCDate()-(accrualWindow-1)); return d.toISOString().slice(0,10) })();
      const effStart = mode==='accrual' ? (useCustomAccrualDates ? accrualCustomStart : accStart) : start;
      const effEnd = mode==='accrual' ? (useCustomAccrualDates ? accrualCustomEnd : todayStr) : end;

      let json:any = null;
      if (mode === 'accrual') {
        // Parity with /groups: gunakan API accrual per-campaign, lalu gabungkan
        const campaignsRes = await fetch('/api/campaigns', { cache: 'no-store' });
        const campaigns = await campaignsRes.json();
        const groups:any[] = [];
        const sumByDate = (arrs: any[][]) => {
          const map = new Map<string, {date:string;views:number;likes:number;comments:number;shares:number;saves:number}>();
          for (const a of arrs) {
            for (const s of a||[]) {
              const k = String(s.date);
              const cur = map.get(k) || { date:k, views:0, likes:0, comments:0, shares:0, saves:0 };
              cur.views += Number(s.views)||0; cur.likes += Number(s.likes)||0; cur.comments += Number(s.comments)||0; cur.shares += Number(s.shares)||0; cur.saves += Number(s.saves)||0;
              map.set(k, cur);
            }
          }
          return Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date));
        };
        
        // Build API URLs with custom date support
        const buildAccrualUrl = (campaignId: string, overrideStart?: string, overrideDays?: number) => {
          // In custom mode, cutoff param represents START DATE for the window
          // Global cutoff is applied server-side only for masking, not for range
          if (useCustomAccrualDates) {
            const startStr = overrideStart || accrualCustomStart;
            const start = new Date(startStr);
            const end = new Date(accrualCustomEnd);
            const days = overrideDays || (Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
            return `/api/campaigns/${encodeURIComponent(campaignId)}/accrual?days=${days}&snapshots_only=1&cutoff=${encodeURIComponent(startStr)}&custom=1`;
          } else {
            // Preset rolling window uses days + server will derive start from today
            return `/api/campaigns/${encodeURIComponent(campaignId)}/accrual?days=${accrualWindow}&snapshots_only=1&cutoff=${encodeURIComponent(accrualCutoff)}`;
          }
        };
        
        // Helper to generate week ranges
        const generateWeekRanges = (startStr: string, endStr: string) => {
          const weeks: Array<{start: string, end: string, days: number}> = [];
          const startDate = new Date(startStr + 'T00:00:00Z');
          const endDate = new Date(endStr + 'T00:00:00Z');
          
          let weekStart = new Date(startDate);
          while (weekStart <= endDate) {
            const weekEnd = new Date(weekStart);
            weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
            
            // Clamp to end date
            const actualEnd = weekEnd > endDate ? endDate : weekEnd;
            const days = Math.floor((actualEnd.getTime() - weekStart.getTime()) / (1000*60*60*24)) + 1;
            
            weeks.push({
              start: weekStart.toISOString().slice(0, 10),
              end: actualEnd.toISOString().slice(0, 10),
              days
            });
            
            // Move to next week
            weekStart = new Date(weekStart);
            weekStart.setUTCDate(weekStart.getUTCDate() + 7);
          }
          return weeks;
        };
        
        // Historical cutoff: data s.d. 22 Jan 2026 dari historical, 23 Jan 2026 ke atas realtime
        const HISTORICAL_CUTOFF = '2026-01-23';
        
        console.log('[ACCRUAL] Building URLs for campaigns...');
        
        // Determine which date range needs real-time API
        const rangeStart = accrualCustomStart;
        const rangeEnd = accrualCustomEnd;
        
        // ALWAYS fetch realtime starting 23 Jan 2026 for consistency
        // This ensures the same baseline is used regardless of user-selected range
        const REALTIME_FIXED_START = '2026-01-23';
        const needsRealtime = rangeEnd >= REALTIME_FIXED_START;
        // Always start from fixed date to ensure consistent baseline calculations
        const realtimeStart = REALTIME_FIXED_START;
        
        console.log('[ACCRUAL] Historical cutoff:', HISTORICAL_CUTOFF);
        console.log('[ACCRUAL] Range:', rangeStart, 'to', rangeEnd);
        console.log('[ACCRUAL] Needs realtime:', needsRealtime, 'from:', realtimeStart, '(fixed start)');
        
        if (needsRealtime && realtimeStart <= rangeEnd) {
          // Fetch real-time data from FIXED start date to ensure consistent baseline
          const rtStartDate = new Date(realtimeStart);
          const rtEndDate = new Date(rangeEnd);
          const rtDays = Math.ceil((rtEndDate.getTime() - rtStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          
          console.log('[ACCRUAL] Fetching real-time for', rtDays, 'days from', realtimeStart);
          
          const resps = await Promise.all((campaigns||[]).map((c:any)=> {
            const url = buildAccrualUrl(c.id, realtimeStart, rtDays);
            console.log('[ACCRUAL] Fetching:', url);
            return fetch(url, { cache: 'no-store' });
          }));        
          const accs = await Promise.all(resps.map(r=> r.ok ? r.json() : Promise.resolve(null)));
          const ttAll: any[][] = []; const igAll: any[][] = []; const ytAll: any[][] = []; const totalAll: any[][] = [];
          accs.forEach((acc:any, idx:number)=>{
            if (!acc) return;
            console.log('[ACCRUAL] Campaign', campaigns[idx]?.name, 'returned', acc?.series_total?.length || 0, 'days of data');
            const gid = campaigns[idx]?.id;
            const gname = campaigns[idx]?.name || gid;
            groups.push({ 
              id: gid, 
              name: gname, 
              series: acc?.series_total||[], 
              series_tiktok: acc?.series_tiktok||[], 
              series_instagram: acc?.series_instagram||[],
              series_youtube: acc?.series_youtube||[]
            });
            ttAll.push(acc?.series_tiktok||[]); 
            igAll.push(acc?.series_instagram||[]); 
            ytAll.push(acc?.series_youtube||[]);
            totalAll.push(acc?.series_total||[]);
          });
          let total = sumByDate(totalAll);
          let total_tiktok = sumByDate(ttAll);
          let total_instagram = sumByDate(igAll);
          let total_youtube = sumByDate(ytAll);
          
          // IMPORTANT: Filter to only include data within user-selected range
          // This ensures range Jan 10-16 shows same values regardless of historical range selection
          const filterByRange = (arr: any[]) => arr.filter((d: any) => {
            const dateStr = String(d.date).slice(0, 10);
            return dateStr >= rangeStart && dateStr <= rangeEnd;
          });
          
          // Apply range filter to totals
          total = filterByRange(total);
          total_tiktok = filterByRange(total_tiktok);
          total_instagram = filterByRange(total_instagram);
          total_youtube = filterByRange(total_youtube);
          
          // Also filter group series
          groups.forEach((g: any) => {
            if (g.series) g.series = filterByRange(g.series);
            if (g.series_tiktok) g.series_tiktok = filterByRange(g.series_tiktok);
            if (g.series_instagram) g.series_instagram = filterByRange(g.series_instagram);
            if (g.series_youtube) g.series_youtube = filterByRange(g.series_youtube);
          });
          
          console.log('[ACCRUAL] Real-time total entries (after range filter):', total.length);
          console.log('[ACCRUAL] Real-time total views (after range filter):', total.reduce((s: number, d: any) => s + (Number(d.views) || 0), 0));
          json = { interval:'daily', start: effStart, end: effEnd, groups, total, total_tiktok, total_instagram, total_youtube };
        } else {
          // All dates are in historical period, no real-time needed
          console.log('[ACCRUAL] All dates in historical period, no real-time fetch needed');
          json = { interval:'daily', start: effStart, end: effEnd, groups: [], total: [], total_tiktok: [], total_instagram: [], total_youtube: [] };
        }
        
        // LOAD HISTORICAL DATA for Accrual mode (dates < 2026-01-23)
        const HISTORICAL_DATA_CUTOFF = '2026-01-23'; // realtime mulai 23 Jan 2026
        const HISTORICAL_LAST_DAY = '2026-01-22';
        if (rangeStart <= HISTORICAL_LAST_DAY) {
          console.log('[ACCRUAL] Loading historical data from weekly_historical_data...');
          const histEndISO = (rangeEnd <= HISTORICAL_LAST_DAY ? rangeEnd : HISTORICAL_LAST_DAY);
          const histRes = await fetch(`/api/admin/weekly-historical?start=${rangeStart}&end=${histEndISO}`, { cache: 'no-store' });
          if (histRes.ok) {
            const histData = await histRes.json();
            console.log('[ACCRUAL] Historical data loaded:', histData);
            
            // Generate all date keys in range
            const allKeys: string[] = [];
            const ds = new Date(effStart + 'T00:00:00Z');
            const de = new Date(effEnd + 'T00:00:00Z');
            for (let d = new Date(ds); d <= de; d.setUTCDate(d.getUTCDate() + 1)) {
              allKeys.push(d.toISOString().slice(0, 10));
            }
            
            // Process historical weekly data and distribute across days
            const histTTMap = new Map<string, {views:number;likes:number;comments:number;shares:number;saves:number}>();
            const histIGMap = new Map<string, {views:number;likes:number;comments:number}>();
            const histYTMap = new Map<string, {views:number;likes:number;comments:number}>();
            
            for (const row of histData.tiktok || []) {
              const weekStart = String(row.start_date);
              const weekEnd = String(row.end_date);
              const daysInWeek = Math.round((new Date(weekEnd).getTime() - new Date(weekStart).getTime()) / (24*60*60*1000)) + 1;
              
              for (const k of allKeys) {
                if (k >= weekStart && k <= weekEnd && k < HISTORICAL_DATA_CUTOFF) {
                  const cur = histTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
                  cur.views += Math.round((Number(row.views) || 0) / daysInWeek);
                  cur.likes += Math.round((Number(row.likes) || 0) / daysInWeek);
                  cur.comments += Math.round((Number(row.comments) || 0) / daysInWeek);
                  cur.shares += Math.round((Number(row.shares) || 0) / daysInWeek);
                  cur.saves += Math.round((Number(row.saves) || 0) / daysInWeek);
                  histTTMap.set(k, cur);
                }
              }
            }
            
            for (const row of histData.instagram || []) {
              const weekStart = String(row.start_date);
              const weekEnd = String(row.end_date);
              const daysInWeek = Math.round((new Date(weekEnd).getTime() - new Date(weekStart).getTime()) / (24*60*60*1000)) + 1;
              
              for (const k of allKeys) {
                if (k >= weekStart && k <= weekEnd && k < HISTORICAL_DATA_CUTOFF) {
                  const cur = histIGMap.get(k) || { views:0, likes:0, comments:0 };
                  cur.views += Math.round((Number(row.views) || 0) / daysInWeek);
                  cur.likes += Math.round((Number(row.likes) || 0) / daysInWeek);
                  cur.comments += Math.round((Number(row.comments) || 0) / daysInWeek);
                  histIGMap.set(k, cur);
                }
              }
            }

            for (const row of histData.youtube || []) {
              const weekStart = String(row.start_date);
              const weekEnd = String(row.end_date);
              const daysInWeek = Math.round((new Date(weekEnd).getTime() - new Date(weekStart).getTime()) / (24*60*60*1000)) + 1;
              
              for (const k of allKeys) {
                if (k >= weekStart && k <= weekEnd && k < HISTORICAL_DATA_CUTOFF) {
                  const cur = histYTMap.get(k) || { views:0, likes:0, comments:0 };
                  cur.views += Math.round((Number(row.views) || 0) / daysInWeek);
                  cur.likes += Math.round((Number(row.likes) || 0) / daysInWeek);
                  cur.comments += Math.round((Number(row.comments) || 0) / daysInWeek);
                  histYTMap.set(k, cur);
                }
              }
            }
            
            // Merge historical data with realtime data
            const mergeHistorical = (arr: any[], histMap: Map<string, any>, platform: 'tiktok'|'instagram'|'youtube'|'total') => {
              const resultMap = new Map<string, any>();
              // First add realtime data
              for (const item of arr) {
                resultMap.set(item.date, { ...item });
              }
              // Then add/merge historical data for dates < cutoff
              for (const k of allKeys) {
                if (k < HISTORICAL_DATA_CUTOFF) {
                  let histValue: any;
                  if (platform === 'total') {
                    const tt = histTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
                    const ig = histIGMap.get(k) || { views:0, likes:0, comments:0 };
                    const yt = histYTMap.get(k) || { views:0, likes:0, comments:0 };
                    histValue = { views: tt.views + ig.views + yt.views, likes: tt.likes + ig.likes + yt.likes, comments: tt.comments + ig.comments + yt.comments, shares: tt.shares, saves: tt.saves };
                  } else if (platform === 'tiktok') {
                    histValue = histTTMap.get(k) || { views:0, likes:0, comments:0, shares:0, saves:0 };
                  } else if (platform === 'instagram') {
                    histValue = histIGMap.get(k) || { views:0, likes:0, comments:0 };
                  } else {
                    histValue = histYTMap.get(k) || { views:0, likes:0, comments:0 };
                  }
                  const existing = resultMap.get(k);
                  if (existing) {
                    // Merge (add historical to existing)
                    existing.views = (existing.views || 0) + (histValue.views || 0);
                    existing.likes = (existing.likes || 0) + (histValue.likes || 0);
                    existing.comments = (existing.comments || 0) + (histValue.comments || 0);
                    if (platform === 'tiktok') {
                      existing.shares = (existing.shares || 0) + (histValue.shares || 0);
                      existing.saves = (existing.saves || 0) + (histValue.saves || 0);
                    }
                  } else {
                    resultMap.set(k, { date: k, ...histValue });
                  }
                }
              }
              return Array.from(resultMap.values()).sort((a, b) => a.date.localeCompare(b.date));
            };
            
            json.total = mergeHistorical(json.total || [], histTTMap, 'total');
            json.total_tiktok = mergeHistorical(json.total_tiktok || [], histTTMap, 'tiktok');
            json.total_instagram = mergeHistorical(json.total_instagram || [], histIGMap, 'instagram');
            json.total_youtube = mergeHistorical(json.total_youtube || [], histYTMap, 'youtube');
            
            console.log('[ACCRUAL] After merging historical, total entries:', json.total.length);
          }
        }
      } else {
        // Post date: gunakan endpoint dashboard/series (alias-aware, historical + realtime)
        const url = new URL('/api/dashboard/series', window.location.origin);
        url.searchParams.set('start', effStart);
        url.searchParams.set('end', effEnd);
        url.searchParams.set('interval', 'weekly');
        url.searchParams.set('mode', mode);
        url.searchParams.set('cutoff', accrualCutoff);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        json = await res.json();
      }
      // Ensure platform arrays exist (older API responses might miss them)
      try {
        if (Array.isArray(json?.groups)) {
          // Derive platform totals if missing or empty
          const needTT = !Array.isArray(json?.total_tiktok) || json.total_tiktok.length === 0;
          const needIG = !Array.isArray(json?.total_instagram) || json.total_instagram.length === 0;
          const needYT = !Array.isArray(json?.total_youtube) || json.total_youtube.length === 0;
          if (needTT || needIG || needYT) {
            const sumByDate = (arrs: any[][], pick: (s:any)=>{views:number;likes:number;comments:number;shares?:number;saves?:number}) => {
              const map = new Map<string, any>();
              for (const g of arrs) {
                for (const s of g||[]) {
                  const k = String(s.date);
                  const v = pick(s);
                  const cur = map.get(k) || { date: k, views:0, likes:0, comments:0, shares:0, saves:0 };
                  cur.views += Number(v.views)||0; cur.likes += Number(v.likes)||0; cur.comments += Number(v.comments)||0;
                  if (typeof v.shares === 'number') cur.shares += Number(v.shares)||0;
                  if (typeof v.saves === 'number') cur.saves += Number(v.saves)||0;
                  map.set(k, cur);
                }
              }
              return Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date));
            };
            if (needTT) {
              const ttArrays = json.groups.map((g:any)=> g.series_tiktok || []);
              json.total_tiktok = sumByDate(ttArrays, (s:any)=>({views:s.views||0, likes:s.likes||0, comments:s.comments||0, shares:s.shares||0, saves:s.saves||0}));
            }
            if (needIG) {
              const igArrays = json.groups.map((g:any)=> g.series_instagram || []);
              json.total_instagram = sumByDate(igArrays, (s:any)=>({views:s.views||0, likes:s.likes||0, comments:s.comments||0}));
            }
            if (needYT) {
              const ytArrays = json.groups.map((g:any)=> g.series_youtube || []);
              json.total_youtube = sumByDate(ytArrays, (s:any)=>({views:s.views||0, likes:s.likes||0, comments:s.comments||0}));
            }
          }
        }
      } catch {}

      // Note: Tidak ada masking cutoff untuk accrual; historical akan ditampilkan apa adanya
      if (mode === 'accrual') {
        const sumSeries = (arr:any[] = []) => arr.reduce((a:any,s:any)=>(
          {
            views: (a.views||0) + (Number(s.views)||0),
            likes: (a.likes||0) + (Number(s.likes)||0),
            comments: (a.comments||0) + (Number(s.comments)||0)
          }
        ), { views:0, likes:0, comments:0 });
        json.totals = sumSeries(json.total || []);
      }
      setData(json);
    } catch {}
    setLoading(false);
  };

  useEffect(()=>{ load(); }, [start, end, interval, mode, accrualWindow, useCustomAccrualDates, accrualCustomStart, accrualCustomEnd, activeCampaignId]);
  
  // Load historical data (weekly_historical_data)
  useEffect(() => {
    const loadHistorical = async () => {
      if (!showHistorical) {
        console.log('[HISTORICAL] showHistorical is false, skipping load');
        setHistoricalData([]);
        return;
      }
      
      console.log('[HISTORICAL] Loading data... platformFilter:', platformFilter);
      
      try {
        // Fetch weekly historical for fixed window (2 Aug 2025 .. 22 Jan 2026)
        const startISO = '2025-08-02';
        const endISO = '2026-01-22';
        const url = `/api/admin/weekly-historical?start=${startISO}&end=${endISO}`;
        console.log('[HISTORICAL] Fetching from:', url);
        const res = await fetch(url, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed historical');
        const tt = Array.isArray(json.tiktok)? json.tiktok: [];
        const ig = Array.isArray(json.instagram)? json.instagram: [];
        const yt = Array.isArray(json.youtube)? json.youtube: [];
        const map = new Map<string, any>();
        const keyOf = (r:any)=> `${String(r.start_date)}|${String(r.end_date)}`;
        
        // Helper to init object
        const initObj = (r:any) => ({ 
          start_date: r.start_date, end_date: r.end_date, 
          views:0, likes:0, comments:0, 
          tiktok:0, tiktok_likes:0, tiktok_comments:0, 
          instagram:0, instagram_likes:0, instagram_comments:0,
          youtube:0, youtube_likes:0, youtube_comments:0
        });

        for (const r of tt) {
          const k = keyOf(r);
          const cur = map.get(k) || initObj(r);
          cur.tiktok += Number((r as any).views)||0; cur.tiktok_likes += Number((r as any).likes)||0; cur.tiktok_comments += Number((r as any).comments)||0;
          cur.views += Number((r as any).views)||0; cur.likes += Number((r as any).likes)||0; cur.comments += Number((r as any).comments)||0;
          map.set(k, cur);
        }
        for (const r of ig) {
          const k = keyOf(r);
          const cur = map.get(k) || initObj(r);
          cur.instagram += Number((r as any).views)||0; cur.instagram_likes += Number((r as any).likes)||0; cur.instagram_comments += Number((r as any).comments)||0;
          cur.views += Number((r as any).views)||0; cur.likes += Number((r as any).likes)||0; cur.comments += Number((r as any).comments)||0;
          map.set(k, cur);
        }
        for (const r of yt) {
          const k = keyOf(r);
          const cur = map.get(k) || initObj(r);
          cur.youtube += Number((r as any).views)||0; cur.youtube_likes += Number((r as any).likes)||0; cur.youtube_comments += Number((r as any).comments)||0;
          cur.views += Number((r as any).views)||0; cur.likes += Number((r as any).likes)||0; cur.comments += Number((r as any).comments)||0;
          map.set(k, cur);
        }
        const arr = Array.from(map.values()).sort((a,b)=> new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
        setHistoricalData(arr);
      } catch (error) {
        console.error('[HISTORICAL] Exception:', error);
        setHistoricalData([]);
      }
    };
    
    loadHistorical();
  }, [showHistorical]);
  
  // Load posts data for chart
  useEffect(() => {
    const loadPosts = async () => {
      if (!showPosts) {
        setPostsData([]);
        return;
      }
      
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const effStart = mode === 'accrual' ? (useCustomAccrualDates ? accrualCustomStart : (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - (accrualWindow - 1)); return d.toISOString().slice(0, 10); })()) : start;
        const effEnd = mode === 'accrual' ? (useCustomAccrualDates ? accrualCustomEnd : todayStr) : end;
        
        const url = new URL('/api/posts-series', window.location.origin);
        url.searchParams.set('start', effStart);
        url.searchParams.set('end', effEnd);
        url.searchParams.set('platform', platformFilter);
        
        console.log('[POSTS] Fetching from:', url.toString());
        
        const res = await fetch(url.toString(), { cache: 'no-store' });
        const json = await res.json();
        
        if (res.ok && json.series) {
          console.log('[POSTS] Data loaded successfully, count:', json.series.length);
          setPostsData(json.series);
        } else {
          console.error('[POSTS] Failed to load:', json.error);
          setPostsData([]);
        }
      } catch (error) {
        console.error('[POSTS] Exception:', error);
        setPostsData([]);
      }
    };
    
    loadPosts();
  }, [showPosts, mode, accrualWindow, useCustomAccrualDates, accrualCustomStart, accrualCustomEnd, start, end, platformFilter]);
  
  useEffect(()=>{
    // Fetch active campaign ID
    const fetchCampaign = async () => {
      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store' });
        const json = await res.json();
        if (res.ok && json?.campaignId) {
          setActiveCampaignId(json.campaignId);
          if (json?.campaignName) setActiveCampaignName(String(json.campaignName));
        }
      } catch {}
    };
    fetchCampaign();
    
    // reuse /api/last-updated
    const fetchLU = async () => {
      try { const r = await fetch('/api/last-updated',{cache:'no-store'}); const j=await r.json(); if (r.ok && j?.last_updated) setLastUpdated(String(j.last_updated)); } catch {}
    };
    fetchLU();
    const t = setInterval(fetchLU, 2*60*60*1000);
    return ()=> clearInterval(t);
  }, []);

  const lastUpdatedHuman = useMemo(()=>{
    if (!lastUpdated) return null; const dt=new Date(lastUpdated); const diffMin=Math.round((Date.now()-dt.getTime())/60000); if (diffMin<60) return `${diffMin} menit lalu`; const h=Math.round(diffMin/60); if (h<24) return `${h} jam lalu`; const d=Math.round(h/24); return `${d} hari lalu`;
  }, [lastUpdated]);

  const chartData = useMemo(()=>{
    if (!data) return null;
    
    // Helper: merge historical data into series
    const mergeHistoricalData = (currentData: any) => {
      console.log('[MERGE] Starting merge, showHistorical:', showHistorical);
      console.log('[MERGE] historicalData.length:', historicalData.length);
      console.log('[MERGE] currentData keys:', Object.keys(currentData || {}));
      
      if (!showHistorical || historicalData.length === 0) {
        console.log('[MERGE] Skipping merge - no historical data to add');
        return currentData;
      }
      
      console.log('[MERGE] Processing', historicalData.length, 'historical entries');
      console.log('[MERGE] Raw historical data:', historicalData);
      
      // Group by date range only (not by platform) to create proper periods
      const periodMap = new Map();
      
      historicalData.forEach((record: any) => {
        const periodKey = `${record.start_date}_${record.end_date}`;
        
        if (!periodMap.has(periodKey)) {
          periodMap.set(periodKey, {
            start_date: record.start_date,
            end_date: record.end_date,
            all: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
            tiktok: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
            instagram: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
          });
        }
        
        const period = periodMap.get(periodKey);
        
        // Add to appropriate platform bucket
        if (record.platform === 'all') {
          period.all.views += Number(record.views) || 0;
          period.all.likes += Number(record.likes) || 0;
          period.all.comments += Number(record.comments) || 0;
          period.all.shares += Number(record.shares) || 0;
          period.all.saves += Number(record.saves) || 0;
        } else if (record.platform === 'tiktok') {
          period.tiktok.views += Number(record.views) || 0;
          period.tiktok.likes += Number(record.likes) || 0;
          period.tiktok.comments += Number(record.comments) || 0;
          period.tiktok.shares += Number(record.shares) || 0;
          period.tiktok.saves += Number(record.saves) || 0;
        } else if (record.platform === 'instagram') {
          period.instagram.views += Number(record.views) || 0;
          period.instagram.likes += Number(record.likes) || 0;
          period.instagram.comments += Number(record.comments) || 0;
          period.instagram.shares += Number(record.shares) || 0;
          period.instagram.saves += Number(record.saves) || 0;
        }
      });
      
      // Convert to series format
      const historicalSeries: any[] = [];
      
      periodMap.forEach((period) => {
        // If 'all' platform exists, use it as total, otherwise sum tiktok + instagram
        const total = period.all.views > 0 ? period.all : {
          views: period.tiktok.views + period.instagram.views,
          likes: period.tiktok.likes + period.instagram.likes,
          comments: period.tiktok.comments + period.instagram.comments,
          shares: period.tiktok.shares + period.instagram.shares,
          saves: period.tiktok.saves + period.instagram.saves
        };
        
        console.log('[MERGE] Period aggregation:', {
          dates: `${period.start_date} to ${period.end_date}`,
          has_all_platform: period.all.views > 0,
          total_views: total.views,
          tiktok_views: period.tiktok.views,
          instagram_views: period.instagram.views,
          sum_check: period.tiktok.views + period.instagram.views
        });
        
        historicalSeries.push({
          date: period.start_date,
          week_start: period.start_date,
          week_end: period.end_date,
          views: total.views,
          likes: total.likes,
          comments: total.comments,
          shares: total.shares,
          saves: total.saves,
          is_historical: true,
          platform: 'total',
          // Include platform breakdowns as objects (not just views)
          tiktok: {
            views: period.tiktok.views,
            likes: period.tiktok.likes,
            comments: period.tiktok.comments
          },
          instagram: {
            views: period.instagram.views,
            likes: period.instagram.likes,
            comments: period.instagram.comments
          }
        });
      });
      
      console.log('[MERGE] Created', historicalSeries.length, 'historical period entries');
      console.log('[MERGE] Sample historical series:', historicalSeries[0]);
      
      return {
        ...currentData,
        historical: historicalSeries
      };
    };
    
    const mergedData = mergeHistoricalData(data);
    
    // Helper: group data by week
    const groupByWeek = (series: any[], startDate: string) => {
      // Parse dates consistently as UTC to avoid timezone issues
      const start = new Date(startDate + 'T00:00:00Z');
      const weekMap = new Map<number, { views: number; likes: number; comments: number; shares: number; saves: number; startDate: Date; endDate: Date }>();
      
      series.forEach((s: any) => {
        // Parse series date as UTC
        const dateStr = String(s.date).slice(0, 10);
        const date = new Date(dateStr + 'T00:00:00Z');
        const daysDiff = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        const weekNum = Math.floor(daysDiff / 7);
        
        const current = weekMap.get(weekNum) || { 
          views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
          startDate: new Date(start.getTime() + weekNum * 7 * 24 * 60 * 60 * 1000),
          endDate: new Date(start.getTime() + (weekNum * 7 + 6) * 24 * 60 * 60 * 1000)
        };
        current.views += Number(s.views) || 0;
        current.likes += Number(s.likes) || 0;
        current.comments += Number(s.comments) || 0;
        current.shares += Number(s.shares) || 0;
        current.saves += Number(s.saves) || 0;
        weekMap.set(weekNum, current);
      });
      
      return Array.from(weekMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([weekNum, data]) => ({ weekNum, ...data }));
    };
    
    let labels: string[];
    let processedData: any;
    
    if (weeklyView && useCustomAccrualDates && mode === 'accrual') {
      console.log('[WEEKLY VIEW] Enabled, processing weekly data...');
      
      // Combine periods (historical + real-time)
      // We'll build real-time weeks first, then merge historical periods into the
      // closest overlapping real-time week to avoid double counting or bucket drift
      let allPeriods: any[] = [];
      const histPeriods: any[] = [];
      // Active date range boundaries for filtering (UTC)
      const rangeStart = new Date(accrualCustomStart + 'T00:00:00Z');
      const rangeEnd = new Date(accrualCustomEnd + 'T23:59:59Z');
      
      // Historical periods (trim to selected range; they will be added to real-time by aggregation below)
      if (showHistorical && mergedData.historical) {
        console.log('[WEEKLY VIEW] Adding', mergedData.historical.length, 'historical periods');
        mergedData.historical.forEach((h: any) => {
          console.log('[WEEKLY VIEW] Historical entry raw:', JSON.stringify(h));
          
          // Use week_start/week_end (from mergeHistoricalData), parse as UTC
          const startStr = String(h.week_start || h.start_date).slice(0, 10);
          const endStr = String(h.week_end || h.end_date).slice(0, 10);
          const startDate = new Date(startStr + 'T00:00:00Z');
          const endDate = new Date(endStr + 'T23:59:59Z');
          
          // Validate dates
          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            console.warn('[WEEKLY VIEW] Invalid dates in historical entry:', h);
            return; // Skip invalid entries
          }
          
          // Extract platform data correctly
          const tiktokViews = (h.tiktok && typeof h.tiktok === 'object') ? h.tiktok.views : 0;
          const tiktokLikes = (h.tiktok && typeof h.tiktok === 'object') ? h.tiktok.likes : 0;
          const tiktokComments = (h.tiktok && typeof h.tiktok === 'object') ? h.tiktok.comments : 0;
          
          const instagramViews = (h.instagram && typeof h.instagram === 'object') ? h.instagram.views : 0;
          const instagramLikes = (h.instagram && typeof h.instagram === 'object') ? h.instagram.likes : 0;
          const instagramComments = (h.instagram && typeof h.instagram === 'object') ? h.instagram.comments : 0;
          
          const totalViews = Number(h.views) || 0;
          const totalLikes = Number(h.likes) || 0;
          const totalComments = Number(h.comments) || 0;
          
          console.log('[WEEKLY VIEW] Parsed values:', {
            period: `${startDate.toISOString().slice(0,10)} to ${endDate.toISOString().slice(0,10)}`,
            total: { views: totalViews, likes: totalLikes, comments: totalComments },
            tiktok: { views: tiktokViews, likes: tiktokLikes, comments: tiktokComments },
            instagram: { views: instagramViews, likes: instagramLikes, comments: instagramComments }
          });
          
          histPeriods.push({
            startDate: startDate,
            endDate: endDate,
            views: totalViews,
            likes: totalLikes,
            comments: totalComments,
            tiktok: tiktokViews,
            tiktok_likes: tiktokLikes,
            tiktok_comments: tiktokComments,
            instagram: instagramViews,
            instagram_likes: instagramLikes,
            instagram_comments: instagramComments,
            is_historical: true,
            groups: [] // No groups for historical data
          });
        });
      }
      
      // Historical cutoff for weekly view
      const HISTORICAL_CUTOFF = '2026-01-22';
      const REALTIME_START = '2026-01-23';
      
      console.log('[WEEKLY VIEW] ═══════════════════════════════════════════════════════════');
      console.log('[WEEKLY VIEW] Range:', accrualCustomStart, 'to', accrualCustomEnd);
      console.log('[WEEKLY VIEW] Historical cutoff:', HISTORICAL_CUTOFF);
      console.log('[WEEKLY VIEW] Historical periods loaded:', histPeriods.length);
      console.log('[WEEKLY VIEW] Real-time daily entries:', (data.total || []).length);
      
      // Step 1: Add historical periods directly (they are already weekly)
      // Only add periods that overlap with selected range
      histPeriods.forEach((hp: any) => {
        const hpStart = hp.startDate.toISOString().slice(0,10);
        const hpEnd = hp.endDate.toISOString().slice(0,10);
        
        // Check if period overlaps with selected range
        if (hpEnd >= accrualCustomStart && hpStart <= accrualCustomEnd) {
          console.log(`[WEEKLY VIEW] Adding historical period: ${hpStart} to ${hpEnd} = ${hp.views.toLocaleString()} views`);
          allPeriods.push({
            ...hp,
            is_historical: true
          });
        } else {
          console.log(`[WEEKLY VIEW] Skip historical (out of range): ${hpStart} to ${hpEnd}`);
        }
      });
      
      // Step 2: Add real-time weekly data (only for dates >= REALTIME_START)
      // Filter real-time data to only include dates after historical cutoff
      const realtimeData = (data.total || []).filter((d: any) => String(d.date) >= REALTIME_START);
      const realtimeTT = (data.total_tiktok || []).filter((d: any) => String(d.date) >= REALTIME_START);
      const realtimeIG = (data.total_instagram || []).filter((d: any) => String(d.date) >= REALTIME_START);
      
      console.log('[WEEKLY VIEW] Real-time entries after cutoff:', realtimeData.length);
      
      if (realtimeData.length > 0) {
        // Group real-time data by week starting from REALTIME_START
        const weeklyTotal = groupByWeek(realtimeData, REALTIME_START);
        const weeklyTT = groupByWeek(realtimeTT, REALTIME_START);
        const weeklyIG = groupByWeek(realtimeIG, REALTIME_START);
        
        console.log('[WEEKLY VIEW] Real-time weeks:', weeklyTotal.length);
        
        // Build maps for platform data
        const ttByWeekNum = new Map<number, any>();
        weeklyTT.forEach((w: any) => ttByWeekNum.set(w.weekNum, w));
        const igByWeekNum = new Map<number, any>();
        weeklyIG.forEach((w: any) => igByWeekNum.set(w.weekNum, w));
        
        // Get groups weekly data for real-time
        const groupsWeekly: any[] = [];
        if (data.groups && data.groups.length > 0) {
          data.groups.forEach((group: any) => {
            let groupSeries = (group.series || []).filter((d: any) => String(d.date) >= REALTIME_START);
            
            if (platformFilter === 'tiktok' && group.series_tiktok) {
              groupSeries = (group.series_tiktok || []).filter((d: any) => String(d.date) >= REALTIME_START);
            } else if (platformFilter === 'instagram' && group.series_instagram) {
              groupSeries = (group.series_instagram || []).filter((d: any) => String(d.date) >= REALTIME_START);
            }
            
            if (groupSeries.length > 0) {
              const weeklyGroup = groupByWeek(groupSeries, REALTIME_START);
              groupsWeekly.push({ name: group.name, weekly: weeklyGroup });
            }
          });
        }
        
        // Build maps for groups by weekNum
        const groupsByWeekNum = new Map<number, any[]>();
        groupsWeekly.forEach((gw: any) => {
          gw.weekly.forEach((wk: any) => {
            const arr = groupsByWeekNum.get(wk.weekNum) || [];
            arr.push({ name: gw.name, views: wk.views || 0, likes: wk.likes || 0, comments: wk.comments || 0 });
            groupsByWeekNum.set(wk.weekNum, arr);
          });
        });
        
        // Add real-time weekly periods
        weeklyTotal.forEach((w: any) => {
          const ttData = ttByWeekNum.get(w.weekNum) || { views: 0, likes: 0, comments: 0 };
          const igData = igByWeekNum.get(w.weekNum) || { views: 0, likes: 0, comments: 0 };
          const groupsData = groupsByWeekNum.get(w.weekNum) || [];
          
          // Only add if overlaps with selected range
          const wStart = w.startDate.toISOString().slice(0,10);
          const wEnd = w.endDate.toISOString().slice(0,10);
          
          if (wEnd >= accrualCustomStart && wStart <= accrualCustomEnd) {
            console.log(`[WEEKLY VIEW] Adding real-time week: ${wStart} to ${wEnd} = ${w.views.toLocaleString()} views`);
            allPeriods.push({
              startDate: w.startDate,
              endDate: w.endDate,
              views: w.views,
              likes: w.likes,
              comments: w.comments,
              tiktok: ttData.views,
              tiktok_likes: ttData.likes,
              tiktok_comments: ttData.comments,
              instagram: igData.views,
              instagram_likes: igData.likes,
              instagram_comments: igData.comments,
              is_historical: false,
              groups: groupsData
            });
          }
        });
      }
      
      console.log('[WEEKLY VIEW] Total periods before sort:', allPeriods.length);

      // Sort by start date for continuous timeline
      allPeriods.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      // Aggregate by identical period (start/end): merge any duplicates
      const agg = new Map<string, any>();
      for (const p of allPeriods) {
        const startKey = p.startDate.toISOString().slice(0, 10);
        const endKey = p.endDate.toISOString().slice(0, 10);
        const key = `${startKey}_${endKey}`;
        const cur = agg.get(key) || {
          startDate: new Date(startKey + 'T00:00:00Z'),
          endDate: new Date(endKey + 'T00:00:00Z'),
          views: 0, likes: 0, comments: 0,
          tiktok: 0, tiktok_likes: 0, tiktok_comments: 0,
          instagram: 0, instagram_likes: 0, instagram_comments: 0,
          is_historical: p.is_historical,
          groups: [] as any[],
        };
        cur.views += Number(p.views)||0;
        cur.likes += Number(p.likes)||0;
        cur.comments += Number(p.comments)||0;
        cur.tiktok += Number(p.tiktok)||0;
        cur.tiktok_likes += Number(p.tiktok_likes)||0;
        cur.tiktok_comments += Number(p.tiktok_comments)||0;
        cur.instagram += Number(p.instagram)||0;
        cur.instagram_likes += Number(p.instagram_likes)||0;
        cur.instagram_comments += Number(p.instagram_comments)||0;
        if (Array.isArray(p.groups) && p.groups.length) {
          const map = new Map<string, any>(cur.groups.map((g:any)=>[g.name, g] as const));
          for (const g of p.groups) {
            const ex = map.get(g.name) || { name:g.name, views:0, likes:0, comments:0 };
            ex.views += Number(g.views)||0; ex.likes += Number(g.likes)||0; ex.comments += Number(g.comments)||0;
            map.set(g.name, ex);
          }
          cur.groups = Array.from(map.values());
        }
        agg.set(key, cur);
      }
      allPeriods = Array.from(agg.values());
      allPeriods.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      
      console.log('[WEEKLY VIEW] FINAL periods:', allPeriods.length);
      allPeriods.forEach((p, idx) => {
        const marker = p.is_historical ? '📊 HIST' : '🔴 RT';
        console.log(`  ${marker} [${idx}]: ${p.startDate.toISOString().slice(0,10)} to ${p.endDate.toISOString().slice(0,10)} = ${p.views.toLocaleString()} views`);
      });
      
      // ═══════════════════════════════════════════════════════════════════
      // Keep empty periods so timeline stays complete and consistent
      
      // Sort by start date for continuous timeline
      allPeriods.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      
      console.log('[WEEKLY VIEW] FINAL periods after aggregation:', allPeriods.length);
      allPeriods.forEach((p, idx) => {
        console.log(`  FINAL[${idx}]: ${p.startDate.toISOString().slice(0,10)} to ${p.endDate.toISOString().slice(0,10)} = ${p.views.toLocaleString()} views`);
      });
      
      // ═══════════════════════════════════════════════════════════════════
      // AUDIT: Log all periods with detailed breakdown
      // ═══════════════════════════════════════════════════════════════════
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[AUDIT] CHART PERIODS BREAKDOWN');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      let runningViews = 0;
      let historicalCount = 0;
      let realtimeCount = 0;
      
      const auditTable = allPeriods.map((p: any, idx: number) => {
        const start = p.startDate.toISOString().slice(0, 10);
        const end = p.endDate.toISOString().slice(0, 10);
        const views = Number(p.views) || 0;
        const tiktok = Number(p.tiktok) || 0;
        const instagram = Number(p.instagram) || 0;
        
        runningViews += views;
        
        if (p.is_historical) {
          historicalCount++;
        } else {
          realtimeCount++;
        }
        
        return {
          '#': idx + 1,
          'Start': start,
          'End': end,
          'Type': p.is_historical ? '📊 Historical' : '🔴 Real-time',
          'Views': views.toLocaleString('id-ID'),
          'TikTok': tiktok.toLocaleString('id-ID'),
          'Instagram': instagram.toLocaleString('id-ID'),
          'Running Total': runningViews.toLocaleString('id-ID')
        };
      });
      
      console.table(auditTable);
      
      console.log('');
      console.log('[AUDIT] SUMMARY:');
      console.log('  Total periods:', allPeriods.length);
      console.log('  Historical:', historicalCount);
      console.log('  Real-time:', realtimeCount);
      console.log('  ─────────────────────────────────────────');
      console.log('  TOTAL VIEWS (from chart):', runningViews.toLocaleString('id-ID'));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      
      // Generate labels from sorted periods (shorter format to avoid overlap)
      labels = allPeriods.map((p: any) => {
        const start = format(p.startDate, 'd', { locale: localeID });
        const end = format(p.endDate, 'd MMM', { locale: localeID });
        return `${start}-${end}`;
      });
      
      console.log('[WEEKLY VIEW] Labels:', labels);
      
      const datasets: any[] = [];
      
      // Total line values
      let totalVals = allPeriods.map((p: any) => 
        metric === 'likes' ? p.likes : metric === 'comments' ? p.comments : p.views
      );
      
      console.log('[WEEKLY VIEW] Total values for metric', metric, ':', totalVals);
      console.log('[WEEKLY VIEW] First 3 periods:', allPeriods.slice(0, 3).map(p => ({
        dates: `${p.startDate.toISOString().slice(0,10)} to ${p.endDate.toISOString().slice(0,10)}`,
        views: p.views,
        tiktok: p.tiktok,
        instagram: p.instagram,
        is_historical: p.is_historical
      })));
      
      // Style: solid line for all (no dashed distinction)
      datasets.push({ 
        label: platformFilter === 'all' ? 'Total' : platformFilter === 'tiktok' ? 'TikTok' : 'Instagram', 
        data: totalVals, 
        borderColor: palette[0], 
        backgroundColor: palette[0] + '33', 
        fill: true, 
        tension: 0.35,
        yAxisID: 'y'
      });
      
      // Platform breakdown (only if 'all' is selected)
      if (platformFilter === 'all') {
        // TikTok breakdown
        const tiktokVals = allPeriods.map((p: any) => {
          const val = metric === 'likes' ? p.tiktok_likes : metric === 'comments' ? p.tiktok_comments : p.tiktok;
          return val || 0;
        });
        
        console.log('[WEEKLY VIEW] TikTok values:', tiktokVals.slice(0, 5));
        
        datasets.push({ 
          label: 'TikTok', 
          data: tiktokVals, 
          borderColor: '#38bdf8', 
          backgroundColor: 'rgba(56,189,248,0.15)', 
          fill: false, 
          tension: 0.35,
          yAxisID: 'y'
        });
        
        // Instagram breakdown
        const instagramVals = allPeriods.map((p: any) => {
          const val = metric === 'likes' ? p.instagram_likes : metric === 'comments' ? p.instagram_comments : p.instagram;
          return val || 0;
        });
        
        console.log('[WEEKLY VIEW] Instagram values:', instagramVals.slice(0, 5));
        
        datasets.push({ 
          label: 'Instagram', 
          data: instagramVals, 
          borderColor: '#f43f5e', 
          backgroundColor: 'rgba(244,63,94,0.15)', 
          fill: false, 
          tension: 0.35,
          yAxisID: 'y'
        });
      }
      
      // Per group lines - extract from allPeriods
      if (data.groups && data.groups.length > 0) {
        data.groups.forEach((group: any, idx: number) => {
          const groupVals = allPeriods.map((p: any) => {
            // Find matching group data in this period
            const groupData = p.groups && p.groups.find((g: any) => g.name === group.name);
            if (!groupData) return 0;
            
            return metric === 'likes' ? groupData.likes : metric === 'comments' ? groupData.comments : groupData.views;
          });
          
          console.log(`[WEEKLY VIEW] Group ${group.name} values:`, groupVals.slice(0, 5));
          
          datasets.push({
            label: group.name,
            data: groupVals,
            borderColor: palette[(idx + 3) % palette.length],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.35,
            yAxisID: 'y'
          });
        });
      }
      
      // Posts line (if showPosts is enabled)
      if (showPosts && postsData.length > 0) {
        // Group posts by week matching allPeriods
        const postsMap = new Map<string, number>();
        postsData.forEach((p: any) => {
          postsMap.set(p.date, p.posts || 0);
        });
        
        const postsVals = allPeriods.map((period: any) => {
          // Sum posts within this period's date range
          const startDate = period.startDate;
          const endDate = period.endDate;
          let sum = 0;
          
          for (const [dateStr, count] of postsMap.entries()) {
            const d = new Date(dateStr + 'T00:00:00Z');
            if (d >= startDate && d <= endDate) {
              sum += count;
            }
          }
          return sum;
        });
        
        console.log('[WEEKLY VIEW] Posts values:', postsVals);
        
        datasets.push({
          label: 'Posts',
          data: postsVals,
          borderColor: '#a855f7', // Purple color for Posts
          backgroundColor: 'rgba(168, 85, 247, 0.15)',
          fill: false,
          tension: 0.35,
          yAxisID: 'y1', // Use secondary Y axis for Posts (different scale)
          borderDash: [5, 5] // Dashed line to differentiate
        });
      }
      
      return { labels, datasets };
    }
    
    // Postdate Weekly: build from historical periods (DB) then realtime weekly starting 2026-01-23
    if (mode==='postdate' && interval==='weekly') {
      const REALTIME_START = '2026-01-23';
      const anchor = new Date(REALTIME_START+'T00:00:00Z');
      const toDate = (s:string)=> new Date(s+'T00:00:00Z');
      // 1) Historical periods directly from DB weekly_historical_data
      const histPeriods: any[] = [];
      for (const r of (historicalData||[])) {
        const hs = String((r as any).start_date||'');
        const he = String((r as any).end_date||'');
        if (!hs || !he) continue;
        const startDate = toDate(hs); const endDate = toDate(he);
        histPeriods.push({
          startDate, endDate,
          views: Number((r as any).views)||0,
          likes: Number((r as any).likes)||0,
          comments: Number((r as any).comments)||0,
          tiktok: Number((r as any).tiktok_views|| (r as any).tiktok)||0,
          tiktok_likes: Number((r as any).tiktok_likes||0),
          tiktok_comments: Number((r as any).tiktok_comments||0),
          instagram: Number((r as any).instagram_views|| (r as any).instagram)||0,
          instagram_likes: Number((r as any).instagram_likes||0),
          instagram_comments: Number((r as any).instagram_comments||0),
          is_historical: true,
          groups: []
        });
      }
      // 2) Realtime weekly from data.total* (daily) starting at REALTIME_START
      const sumSeries = (arr:any[] = [], key:'views'|'likes'|'comments') => arr.reduce((acc:Map<number,number>, s:any)=>{
        const d = new Date(String(s.date)+'T00:00:00Z');
        if (d < anchor) return acc; // ignore pre-cutoff realtime
        const idx = Math.floor((d.getTime()-anchor.getTime())/(7*24*60*60*1000));
        const cur = acc.get(idx)||0; acc.set(idx, cur + Number(s[key]||0)); return acc;
      }, new Map<number,number>());
      const mapViews = sumSeries(data.total||[], 'views');
      const mapLikes = sumSeries(data.total||[], 'likes');
      const mapComments = sumSeries(data.total||[], 'comments');
      const mapTTViews = sumSeries(data.total_tiktok||[], 'views');
      const mapTTLikes = sumSeries(data.total_tiktok||[], 'likes');
      const mapTTComments = sumSeries(data.total_tiktok||[], 'comments');
      const mapIGViews = sumSeries(data.total_instagram||[], 'views');
      const mapIGLikes = sumSeries(data.total_instagram||[], 'likes');
      const mapIGComments = sumSeries(data.total_instagram||[], 'comments');
      const rtPeriods: any[] = [];
      const indices = Array.from(new Set([ ...mapViews.keys(), ...mapLikes.keys(), ...mapComments.keys() ])).sort((a,b)=> a-b);
      for (const idx of indices) {
        const startDate = new Date(anchor.getTime() + idx*7*24*60*60*1000);
        const endDate = new Date(startDate.getTime()); endDate.setUTCDate(endDate.getUTCDate()+6);
        rtPeriods.push({
          startDate, endDate,
          views: mapViews.get(idx)||0,
          likes: mapLikes.get(idx)||0,
          comments: mapComments.get(idx)||0,
          tiktok: mapTTViews.get(idx)||0,
          tiktok_likes: mapTTLikes.get(idx)||0,
          tiktok_comments: mapTTComments.get(idx)||0,
          instagram: mapIGViews.get(idx)||0,
          instagram_likes: mapIGLikes.get(idx)||0,
          instagram_comments: mapIGComments.get(idx)||0,
          is_historical: false,
          groups: []
        });
      }
      const allPeriods = [...histPeriods, ...rtPeriods].sort((a,b)=> a.startDate.getTime()-b.startDate.getTime());
      // Labels
      const labels = allPeriods.map((p:any)=>{
        const ds = p.startDate.getUTCDate();
        const de = p.endDate.getUTCDate();
        const tail = format(p.endDate,'MMM yyyy', { locale: localeID });
        return `${ds}-${de} ${tail}`;
      });
      // Datasets (totals + platform breakdown)
      const pick = (p:any)=> metric==='likes'? p.likes : metric==='comments'? p.comments : p.views;
      const totalVals = allPeriods.map(p=> pick(p));
      const datasets:any[] = [ { label: platformFilter==='all'?'Total': platformFilter==='tiktok'?'TikTok': platformFilter==='instagram'?'Instagram':'YouTube', data: totalVals, borderColor: palette[0], backgroundColor: palette[0]+'33', fill:true, tension:0.35, yAxisID:'y' } ];
      if (platformFilter==='all') {
        const ttVals = allPeriods.map((p:any)=> metric==='likes'? (p.tiktok_likes||0) : metric==='comments'? (p.tiktok_comments||0) : (p.tiktok||0));
        const igVals = allPeriods.map((p:any)=> metric==='likes'? (p.instagram_likes||0) : metric==='comments'? (p.instagram_comments||0) : (p.instagram||0));
        const ytVals = allPeriods.map((p:any)=> metric==='likes'? (p.youtube_likes||0) : metric==='comments'? (p.youtube_comments||0) : (p.youtube||0));
        datasets.push({ label:'TikTok', data: ttVals, borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.15)', fill:false, tension:0.35, yAxisID:'y' });
        datasets.push({ label:'Instagram', data: igVals, borderColor:'#f43f5e', backgroundColor:'rgba(244,63,94,0.15)', fill:false, tension:0.35, yAxisID:'y' });
        datasets.push({ label:'YouTube', data: ytVals, borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.15)', fill:false, tension:0.35, yAxisID:'y' });
      }

      // Per-group lines (realtime only; historical buckets remain zero)
      if (Array.isArray(data.groups) && data.groups.length) {
        const histLen = histPeriods.length;
        // Build map of weekNum -> position index within realtime segment
        const idxToPos = new Map<number, number>();
        indices.forEach((wIdx:number, pos:number)=> idxToPos.set(wIdx, pos));
        for (let gi=0; gi<data.groups.length; gi++) {
          const g = data.groups[gi];
          let series: any[] = (g.series||[]).filter((d:any)=> String(d.date) >= REALTIME_START);
          if (platformFilter==='tiktok' && g.series_tiktok) series = (g.series_tiktok||[]).filter((d:any)=> String(d.date) >= REALTIME_START);
          else if (platformFilter==='instagram' && g.series_instagram) series = (g.series_instagram||[]).filter((d:any)=> String(d.date) >= REALTIME_START);
          else if (platformFilter==='youtube' && g.series_youtube) series = (g.series_youtube||[]).filter((d:any)=> String(d.date) >= REALTIME_START);
          if (!series.length) continue;
          const weekly = groupByWeek(series, REALTIME_START);
          const weekMap = new Map<number, any>();
          weekly.forEach((w:any)=> weekMap.set(w.weekNum, w));
          const vals = new Array(allPeriods.length).fill(0);
          for (const [wIdx, pos] of idxToPos.entries()) {
            const w = weekMap.get(wIdx);
            if (!w) continue;
            const v = metric==='likes'? (w.likes||0) : metric==='comments'? (w.comments||0) : (w.views||0);
            vals[histLen + pos] = v;
          }
          datasets.push({ label: g.name, data: vals, borderColor: palette[(gi+3)%palette.length], backgroundColor:'transparent', fill:false, tension:0.35, yAxisID:'y' });
        }
      }

      // Posts overlay (realtime only) if enabled
      if (showPosts && postsData.length>0) {
        const histLen = histPeriods.length;
        const vals = new Array(allPeriods.length).fill(0);
        // Build a map of date->count
        const pmap = new Map<string, number>();
        postsData.forEach((p:any)=> pmap.set(String(p.date), Number(p.posts||0)));
        indices.forEach((wIdx:number, pos:number)=>{
          const startDate = new Date(anchor.getTime() + wIdx*7*24*60*60*1000);
          const endDate = new Date(startDate.getTime()); endDate.setUTCDate(endDate.getUTCDate()+6);
          let sum=0; for (const [ds,c] of pmap.entries()) { const d=new Date(ds+'T00:00:00Z'); if (d>=startDate && d<=endDate) sum+=Number(c)||0; }
          vals[histLen + pos] = sum;
        });
        datasets.push({ label:'Posts', data: vals, borderColor:'#a855f7', backgroundColor:'rgba(168,85,247,0.15)', fill:false, tension:0.35, yAxisID:'y1', borderDash:[5,5] });
      }
      return { labels, datasets };
    }

    // Postdate view: build labels based on interval
    if (interval === 'weekly') {
      labels = (data.total || []).map((s:any)=>{
        const start = parseISO(s.date);
        const end = new Date(start.getTime()); end.setUTCDate(end.getUTCDate()+6);
        const ds = start.getUTCDate();
        const de = end.getUTCDate();
        const tail = format(end,'MMM yyyy', { locale: localeID });
        return `${ds}-${de} ${tail}`;
      });
    } else if (interval === 'monthly') {
      labels = (data.total || []).map((s:any)=> format(parseISO(s.date),'MMM yyyy', {locale: localeID}));
    } else {
      labels = (data.total || []).map((s:any)=> format(parseISO(s.date),'d MMM', {locale: localeID}));
    }
    const datasets:any[] = [];
    
    // Total first (filtered by platform)
    let totalSeries = data.total || [];
    if (platformFilter === 'tiktok' && Array.isArray(data.total_tiktok) && data.total_tiktok.length) {
      totalSeries = data.total_tiktok;
    } else if (platformFilter === 'instagram' && Array.isArray(data.total_instagram) && data.total_instagram.length) {
      totalSeries = data.total_instagram;
    } else if (platformFilter === 'youtube' && Array.isArray(data.total_youtube) && data.total_youtube.length) {
      totalSeries = data.total_youtube;
    }
    
    const totalVals = totalSeries.map((s:any)=> metric==='likes'? s.likes : metric==='comments'? s.comments : s.views);
    datasets.push({ 
      label: platformFilter === 'all' ? 'Total' : platformFilter === 'tiktok' ? 'TikTok' : platformFilter === 'instagram' ? 'Instagram' : 'YouTube',
      data: totalVals, 
      borderColor: palette[0], 
      backgroundColor: palette[0]+'33', 
      fill: true, 
      tension: 0.35,
      yAxisID: 'y'
    });
    
    // Platform breakdown if available (only when 'all' selected)
    if (platformFilter === 'all') {
      if (Array.isArray(data.total_tiktok) && data.total_tiktok.length) {
        const ttVals = data.total_tiktok.map((s:any)=> metric==='likes'? s.likes : metric==='comments'? s.comments : s.views);
        datasets.push({ label:'TikTok', data: ttVals, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.15)', fill: false, tension: 0.35, yAxisID: 'y' });
      }
      if (Array.isArray(data.total_instagram) && data.total_instagram.length) {
        const igVals = data.total_instagram.map((s:any)=> metric==='likes'? s.likes : metric==='comments'? s.comments : s.views);
        datasets.push({ label:'Instagram', data: igVals, borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.15)', fill: false, tension: 0.35, yAxisID: 'y' });
      }
      if (Array.isArray(data.total_youtube) && data.total_youtube.length) {
        const ytVals = data.total_youtube.map((s:any)=> metric==='likes'? s.likes : metric==='comments'? s.comments : s.views);
        datasets.push({ label:'YouTube', data: ytVals, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)', fill: false, tension: 0.35, yAxisID: 'y' });
      }
    }
    
    // Per group lines (filter by platform)
    for (let i=0;i<(data.groups||[]).length;i++){
      const g = data.groups[i];
      let seriesToUse = g.series || [];
      
      if (platformFilter === 'tiktok' && g.series_tiktok) {
        seriesToUse = g.series_tiktok;
      } else if (platformFilter === 'instagram' && g.series_instagram) {
        seriesToUse = g.series_instagram;
      } else if (platformFilter === 'youtube' && g.series_youtube) {
        seriesToUse = g.series_youtube;
      }
      
      const map:Record<string,any> = {}; 
      seriesToUse.forEach((s:any)=>{ map[String(s.date)] = s; });
      const vals = (totalSeries).map((t:any)=>{ 
        const it = map[String(t.date)] || { views:0, likes:0, comments:0 }; 
        return metric==='likes'? it.likes : metric==='comments'? it.comments : it.views; 
      });
      const color = palette[(i+1)%palette.length];
      datasets.push({ label: g.name, data: vals, borderColor: color, backgroundColor: color+'33', fill: false, tension:0.35, yAxisID: 'y' });
    }
    
    // Posts line (if showPosts is enabled) - Daily view
    if (showPosts && postsData.length > 0) {
      const postsMap = new Map<string, number>();
      postsData.forEach((p: any) => {
        postsMap.set(p.date, p.posts || 0);
      });
      
      const postsVals = totalSeries.map((t: any) => {
        return postsMap.get(String(t.date)) || 0;
      });
      
      datasets.push({
        label: 'Posts',
        data: postsVals,
        borderColor: '#a855f7', // Purple
        backgroundColor: 'rgba(168, 85, 247, 0.15)',
        fill: false,
        tension: 0.35,
        yAxisID: 'y1', // Secondary Y axis
        borderDash: [5, 5]
      });
    }
    
    return { labels, datasets };
  }, [data, metric, interval, weeklyView, useCustomAccrualDates, mode, accrualCustomStart, platformFilter, showPosts, postsData]);

  // Crosshair + floating label, like Groups
  const chartRef = useRef<any>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  
  // Calculate grand totals strictly from current masked server totals
  // NOTE: Historical data is already merged into data.total/data.total_tiktok/data.total_instagram
  // at load time (see lines 291-293), so we DON'T add historicalData again here (no double counting)
  const grandTotals = useMemo(() => {
    if (!data) return { views: 0, likes: 0, comments: 0 };
    // Sum from currently selected platform series (already includes merged historical data)
    const sumArr = (arr:any[] = []) => arr.reduce((a:any,s:any)=>({
      views: (a.views||0) + Number(s.views||0),
      likes: (a.likes||0) + Number(s.likes||0),
      comments: (a.comments||0) + Number(s.comments||0)
    }), { views:0, likes:0, comments:0 });
    
    if (platformFilter === 'tiktok' && Array.isArray(data.total_tiktok)) {
      return sumArr(data.total_tiktok);
    } else if (platformFilter === 'instagram' && Array.isArray(data.total_instagram)) {
      return sumArr(data.total_instagram);
    } else {
      return sumArr(data.total || []);
    }
  }, [data, platformFilter]);
  
  const crosshairPlugin = useMemo(()=>({
    id: 'crosshairPlugin',
    afterDraw(chart:any){
      const { ctx, chartArea } = chart; if (!chartArea) return; const { top,bottom,left,right }=chartArea;
      const active = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      let idx: number | null = null; let x: number | null = null;
      if (active && active.length>0){ idx=active[0].index; x=active[0].element.x; } else {
        const labels = chart.data?.labels||[]; if (!labels.length) return; idx=labels.length-1; const meta=chart.getDatasetMeta(0); const el=meta?.data?.[idx]; x=el?.x??null; }
      if (idx==null || x==null) return;
      ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,bottom); ctx.stroke(); ctx.restore();
      try{
        const label = String(chart.data.labels[idx]); 
        const totalDs = chart.data.datasets?.[0]; 
        const v = Array.isArray(totalDs?.data)? Number(totalDs.data[idx]||0):0; 
        const numTxt = new Intl.NumberFormat('id-ID').format(Math.round(v));
        const dateTxt = label;
        
        ctx.save(); 
        ctx.font='bold 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'; 
        const padX=10, padY=8; 
        const numW = ctx.measureText(numTxt).width;
        ctx.font='11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
        const dateW = ctx.measureText(dateTxt).width;
        const boxW = Math.max(numW, dateW) + padX*2;
        const boxH = 38;
        // Fixed position at top-left corner of chart area
        const bx = left + 10; 
        const by = top + 10; 
        const r=6; 
        
        // Background box
        ctx.fillStyle='rgba(0,0,0,0.75)'; 
        ctx.beginPath(); 
        ctx.moveTo(bx+r,by); ctx.lineTo(bx+boxW-r,by); ctx.quadraticCurveTo(bx+boxW,by,bx+boxW,by+r); 
        ctx.lineTo(bx+boxW,by+boxH-r); ctx.quadraticCurveTo(bx+boxW,by+boxH,bx+boxW-r,by+boxH); 
        ctx.lineTo(bx+r,by+boxH); ctx.quadraticCurveTo(bx,by+boxH,bx,by+boxH-r); 
        ctx.lineTo(bx,by+r); ctx.quadraticCurveTo(bx,by,bx+r,by); 
        ctx.closePath(); ctx.fill(); 
        
        // Number (big, white)
        ctx.font='bold 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
        ctx.fillStyle='#fff'; 
        ctx.fillText(numTxt, bx+padX, by+18);
        
        // Date label (smaller, dimmer)
        ctx.font='11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
        ctx.fillStyle='rgba(255,255,255,0.6)'; 
        ctx.fillText(dateTxt, bx+padX, by+32);
        
        ctx.restore();
      } catch {}
    }
  }), []);

  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* Header with totals */}
      <div className="glass rounded-2xl p-4 border border-white/10 mb-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/70">
          {data && (
            <>
              <span>Views: <strong className="text-white">{Number(grandTotals.views).toLocaleString('id-ID')}</strong></span>
              <span>Likes: <strong className="text-white">{Number(grandTotals.likes).toLocaleString('id-ID')}</strong></span>
              <span>Comments: <strong className="text-white">{Number(grandTotals.comments).toLocaleString('id-ID')}</strong></span>
              {lastUpdatedHuman && (
                <span className="ml-auto text-white/60">Terakhir diperbarui: <strong className="text-white/80">{lastUpdatedHuman}</strong></span>
              )}
            </>
          )}
        </div>
        <div className="mt-3 flex justify-between items-center">
          {mode === 'postdate' ? (
            <div className="flex items-center gap-2">
              <input type="date" value={start} onChange={(e)=>setStart(e.target.value)} className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-sm"/>
              <span className="text-white/50">s/d</span>
              <input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-sm"/>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input type="date" value={accrualCustomStart} onChange={(e)=>setAccrualCustomStart(e.target.value)} className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-sm"/>
              <span className="text-white/50">→</span>
              <input type="date" value={accrualCustomEnd} onChange={(e)=>setAccrualCustomEnd(e.target.value)} className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-sm"/>
            </div>
          )}
          {/* Tampilan selalu mingguan, checkbox dihapus */}
        </div>
      </div>

      {/* Controls: move Mode to the left, Interval to the center, Metric to the right */}
      <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 items-center gap-2 text-xs">
        {/* Left: Mode (+ accrual window when applicable) */}
        <div className="flex items-center gap-2 justify-start">
          <span className="text-white/60">Mode:</span>
          <span className="px-2 py-1 rounded bg-white/20 text-white">Post Date</span>
        </div>

        {/* Center: Interval removed - historical data is weekly only */}
        <div className="flex items-center gap-2 justify-center">
          {/* Interval dihapus - data historical mingguan saja */}
        </div>

        {/* Right: Metric */}
        <div className="flex items-center gap-2 justify-end">
          <span className="text-white/60">Metric:</span>
          <button className={`px-2 py-1 rounded ${metric==='views'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setMetric('views')}>Views</button>
          <button className={`px-2 py-1 rounded ${metric==='likes'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setMetric('likes')}>Likes</button>
          <button className={`px-2 py-1 rounded ${metric==='comments'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setMetric('comments')}>Comments</button>
        </div>
      </div>
      
      {/* Platform Filter */}
      <div className="mb-3 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-white/60">Platform:</span>
        <button className={`px-2 py-1 rounded ${platformFilter==='all'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setPlatformFilter('all')}>Semua</button>
        <button className={`px-2 py-1 rounded flex items-center gap-1 ${platformFilter==='tiktok'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setPlatformFilter('tiktok')}>
          <span className="text-[#38bdf8]">●</span> TikTok
        </button>
        <button className={`px-2 py-1 rounded flex items-center gap-1 ${platformFilter==='instagram'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setPlatformFilter('instagram')}>
          <span className="text-[#f43f5e]">●</span> Instagram
        </button>
        <button className={`px-2 py-1 rounded flex items-center gap-1 ${platformFilter==='youtube'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setPlatformFilter('youtube')}>
          <span className="text-[#ef4444]">●</span> YouTube
        </button>
        
        <span className="text-white/30 mx-2">|</span>
        
        {/* Posts toggle */}
        <button 
          className={`px-2 py-1 rounded flex items-center gap-1 ${showPosts?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} 
          onClick={()=>setShowPosts(!showPosts)}
        >
          <span className="text-[#a855f7]">●</span> Posts
        </button>
      </div>

      <div className="glass rounded-2xl p-4 md:p-6 border border-white/10 overflow-x-auto">
        {loading && <p className="text-white/60">Memuat…</p>}
        {!loading && chartData && (
          <Line ref={chartRef} data={chartData} plugins={[crosshairPlugin]} options={{
            responsive:true,
            interaction:{ mode:'index', intersect:false },
            plugins:{ 
              legend:{ labels:{ color:'rgba(255,255,255,0.8)'} },
              tooltip: {
                filter: function(tooltipItem: any) {
                  // Hide group lines if value is 0 (historical data doesn't have groups)
                  const label = tooltipItem.dataset.label || '';
                  const value = tooltipItem.parsed.y;
                  
                  // If it's a group (Group A, B, C, D) and value is 0, hide it
                  if (label.startsWith('Group') && value === 0) {
                    return false;
                  }
                  
                  return true;
                }
              }
            },
            scales:{
              x:{
                ticks:{ 
                  color:'rgba(255,255,255,0.6)', 
                  autoSkip: false,
                  maxRotation: 90, 
                  minRotation: 45,
                  font: { size: 9 }
                },
                grid:{ color:'rgba(255,255,255,0.06)'}
              },
              y:{ 
                type: 'linear',
                display: true,
                position: 'left',
                ticks:{ color:'rgba(255,255,255,0.6)'}, 
                grid:{ color:'rgba(255,255,255,0.06)'},
                title: {
                  display: false
                }
              },
              y1: {
                type: 'linear',
                display: showPosts,
                position: 'right',
                ticks:{ color:'#a855f7', font: { size: 10 } },
                grid:{ drawOnChartArea: false },
                title: {
                  display: false
                },
                beginAtZero: true
              }
            },
            onHover: (_e:any, el:any[])=> setActiveIndex(el && el.length>0 ? (el[0].index ?? null) : null)
          }} onMouseLeave={()=> setActiveIndex(null)} />
        )}
      </div>

      {/* Top 5 Video FYP Section (aggregate across all groups when campaignId undefined) */}
      <div className="mt-8">
        <TopViralDashboard 
          days={30} 
          limit={5} 
        />
      </div>
    </div>
  );
}
