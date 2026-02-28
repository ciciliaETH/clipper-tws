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
  const [showPosts, setShowPosts] = useState<boolean>(false); // Show posts line on chart
  const [postsShowTotal, setPostsShowTotal] = useState<boolean>(true);
  const [postsShowTikTok, setPostsShowTikTok] = useState<boolean>(true);
  const [postsShowInstagram, setPostsShowInstagram] = useState<boolean>(true);
  const [postsShowYouTube, setPostsShowYouTube] = useState<boolean>(true);
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [postsData, setPostsData] = useState<any[]>([]); // Posts per day/period
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [activeCampaignName, setActiveCampaignName] = useState<string | null>(null);
  const [videoTotals, setVideoTotals] = useState<{ views: number; likes: number; comments: number } | null>(null);
  const [videoSeriesData, setVideoSeriesData] = useState<{
    total: any[]; tiktok: any[]; instagram: any[]; youtube: any[];
    groups: Array<{ id: string; name: string; series: any[]; series_tiktok: any[]; series_instagram: any[]; series_youtube: any[] }>;
  } | null>(null);
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
        
        // Historical cutoff: s.d. 04 Feb 2026 dari historical, 05 Feb 2026 ke atas realtime
        const HISTORICAL_CUTOFF = '2026-02-05';
        
        console.log('[ACCRUAL] Building URLs for campaigns...');
        
        // Determine which date range needs real-time API
        const rangeStart = accrualCustomStart;
        const rangeEnd = accrualCustomEnd;
        
        // ALWAYS fetch realtime starting 05 Feb 2026 for consistency
        // This ensures the same baseline is used regardless of user-selected range
        const REALTIME_FIXED_START = '2026-02-05';
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
        
        // LOAD HISTORICAL DATA for Accrual mode (dates < 2026-02-05)
        const HISTORICAL_DATA_CUTOFF = '2026-02-05'; // realtime mulai 05 Feb 2026
        const HISTORICAL_LAST_DAY = '2026-02-04';
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
        // Use daily interval when date range is entirely in realtime period or <= 60 days
        const REALTIME_CUTOFF = '2026-02-05';
        const daysDiff = Math.ceil((new Date(effEnd+'T00:00:00Z').getTime() - new Date(effStart+'T00:00:00Z').getTime()) / (1000*60*60*24));
        const effectiveInterval = (effStart >= REALTIME_CUTOFF || daysDiff <= 60) ? 'daily' : 'weekly';
        const url = new URL('/api/dashboard/series', window.location.origin);
        url.searchParams.set('start', effStart);
        url.searchParams.set('end', effEnd);
        url.searchParams.set('interval', effectiveInterval);
        url.searchParams.set('mode', mode);
        url.searchParams.set('cutoff', accrualCutoff);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        json = await res.json();
        // Per-group series are now returned directly by /api/dashboard/series
        // using the same participant resolution as /api/groups/[id]/members
      }
      // Ensure platform arrays exist (older API responses might miss them)
      try {
        if (Array.isArray(json?.groups)) {
          // Derive platform totals if missing, empty, or all-zero (e.g. dashboard/series returns YouTube with 0s)
          const isAllZero = (arr: any[]) => arr.every((s: any) => !Number(s.views) && !Number(s.likes) && !Number(s.comments));
          const needTT = !Array.isArray(json?.total_tiktok) || json.total_tiktok.length === 0;
          const needIG = !Array.isArray(json?.total_instagram) || json.total_instagram.length === 0;
          const needYT = !Array.isArray(json?.total_youtube) || json.total_youtube.length === 0 || isAllZero(json.total_youtube);
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
              // Also add YouTube into the total series so the "Total" line includes YT
              if (Array.isArray(json.total) && json.total_youtube.length) {
                const ytMap = new Map<string, any>();
                for (const s of json.total_youtube) ytMap.set(String(s.date), s);
                for (const t of json.total) {
                  const yt = ytMap.get(String(t.date));
                  if (yt) {
                    t.views = (Number(t.views)||0) + (Number(yt.views)||0);
                    t.likes = (Number(t.likes)||0) + (Number(yt.likes)||0);
                    t.comments = (Number(t.comments)||0) + (Number(yt.comments)||0);
                  }
                }
              }
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
      // Update interval state to match what was actually used by the API
      if (json?.interval) setIntervalVal(json.interval);
    } catch {}
    setLoading(false);
  };

  useEffect(()=>{ load(); }, [start, end, mode, accrualWindow, useCustomAccrualDates, accrualCustomStart, accrualCustomEnd, activeCampaignId]);

  // Fetch totals + series from the videos API for all campaigns — ensures header
  // numbers AND chart data match the "Lihat Semua Video" detail pages exactly.
  useEffect(() => {
    const loadVideoTotals = async () => {
      try {
        const effStart = mode === 'accrual' ? (useCustomAccrualDates ? accrualCustomStart : start) : start;
        const effEnd = mode === 'accrual' ? (useCustomAccrualDates ? accrualCustomEnd : end) : end;
        // Get all campaigns
        const campRes = await fetch('/api/campaigns', { cache: 'no-store' });
        const campaigns = await campRes.json();
        if (!Array.isArray(campaigns) || !campaigns.length) { setVideoTotals(null); setVideoSeriesData(null); return; }
        // Fetch summary + series for each campaign in parallel
        const results = await Promise.all(campaigns.map(async (c: any) => {
          try {
            const url = new URL(`/api/campaigns/${c.id}/videos`, window.location.origin);
            url.searchParams.set('start', effStart);
            url.searchParams.set('end', effEnd);
            url.searchParams.set('summary', '1');
            const res = await fetch(url.toString(), { cache: 'no-store' });
            const json = await res.json();
            return res.ok ? { id: c.id, name: c.name, json } : null;
          } catch { return null; }
        }));
        // Sum totals
        const sum = { views: 0, likes: 0, comments: 0 };
        // Merge series across all campaigns
        const mergeMap = (target: Map<string, any>, arr: any[]) => {
          for (const s of arr || []) {
            const k = String(s.date);
            const cur = target.get(k) || { views: 0, likes: 0, comments: 0, posts: 0 };
            cur.views += Number(s.views || 0);
            cur.likes += Number(s.likes || 0);
            cur.comments += Number(s.comments || 0);
            cur.posts += Number(s.posts || 0);
            target.set(k, cur);
          }
        };
        const totalMap = new Map<string, any>();
        const ttMap = new Map<string, any>();
        const igMap = new Map<string, any>();
        const ytMap = new Map<string, any>();
        const groupsList: Array<{ id: string; name: string; series: any[] }> = [];

        for (const r of results) {
          if (!r) continue;
          const t = r.json.totals;
          if (t) {
            sum.views += Number(t.views || 0);
            sum.likes += Number(t.likes || 0);
            sum.comments += Number(t.comments || 0);
          }
          mergeMap(totalMap, r.json.series_total || []);
          mergeMap(ttMap, r.json.series_tiktok || []);
          mergeMap(igMap, r.json.series_instagram || []);
          mergeMap(ytMap, r.json.series_youtube || []);
          groupsList.push({ id: r.id, name: r.name, series: r.json.series_total || [], series_tiktok: r.json.series_tiktok || [], series_instagram: r.json.series_instagram || [], series_youtube: r.json.series_youtube || [] });
        }
        const toArr = (m: Map<string, any>) =>
          Array.from(m.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
        setVideoTotals(sum);
        setVideoSeriesData({
          total: toArr(totalMap),
          tiktok: toArr(ttMap),
          instagram: toArr(igMap),
          youtube: toArr(ytMap),
          groups: groupsList,
        });
        // Derive posts data from video series (same source of truth)
        const postsFromVideos = toArr(totalMap).map((d: any) => ({
          date: d.date,
          posts: d.posts || 0,
          posts_tiktok: (ttMap.get(d.date)?.posts || 0),
          posts_instagram: (igMap.get(d.date)?.posts || 0),
          posts_youtube: (ytMap.get(d.date)?.posts || 0),
        }));
        setPostsData(postsFromVideos);
      } catch { setVideoTotals(null); setVideoSeriesData(null); }
    };
    loadVideoTotals();
  }, [start, end, mode, accrualCustomStart, accrualCustomEnd, useCustomAccrualDates]);

  // Load historical data (weekly_historical_data) — skip if date range is entirely in realtime
  useEffect(() => {
    const loadHistorical = async () => {
      const HIST_CUTOFF = '2026-02-05';
      if (!showHistorical || start >= HIST_CUTOFF) {
        setHistoricalData([]);
        return;
      }
      
      console.log('[HISTORICAL] Loading data... platformFilter:', platformFilter);
      
      try {
        // Fetch weekly historical for fixed window (2 Aug 2025 .. 22 Jan 2026)
        const startISO = '2025-08-02';
        const endISO = '2026-02-04';
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
  }, [showHistorical, start]);
  
  // Posts data is now derived from videoSeriesData in loadVideoTotals (same source of truth as detail video page)

  // Header totals now use the same data source as the chart (data.total from dashboard/series API)
  // This ensures the header always matches the chart values exactly.

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
    if (!data && !videoSeriesData) return null;

    // Prefer videoSeriesData (videos API, deduplicated per-video) over data (/api/dashboard/series)
    const src = {
      total: videoSeriesData?.total || data?.total || [],
      total_tiktok: videoSeriesData?.tiktok || data?.total_tiktok || [],
      total_instagram: videoSeriesData?.instagram || data?.total_instagram || [],
      total_youtube: videoSeriesData?.youtube || data?.total_youtube || [],
      groups: videoSeriesData?.groups?.map(g => ({
        name: g.name,
        series: g.series,
        series_tiktok: g.series_tiktok || [],
        series_instagram: g.series_instagram || [],
        series_youtube: g.series_youtube || [],
      })) || data?.groups || [],
    };

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
            instagram: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
            youtube: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
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
        } else if ((record.platform||'').toLowerCase() === 'youtube') {
          period.youtube.views += Number(record.views) || 0;
          period.youtube.likes += Number(record.likes) || 0;
          period.youtube.comments += Number(record.comments) || 0;
          period.youtube.shares += Number(record.shares) || 0;
          period.youtube.saves += Number(record.saves) || 0;
        }
      });
      
      // Convert to series format
      const historicalSeries: any[] = [];
      
      periodMap.forEach((period) => {
        // If 'all' platform exists, use it as total, otherwise sum tiktok + instagram
        const total = period.all.views > 0 ? period.all : {
          views: period.tiktok.views + period.instagram.views + period.youtube.views,
          likes: period.tiktok.likes + period.instagram.likes + period.youtube.likes,
          comments: period.tiktok.comments + period.instagram.comments + period.youtube.comments,
          shares: period.tiktok.shares + period.instagram.shares + (period.youtube.shares||0),
          saves: period.tiktok.saves + period.instagram.saves + (period.youtube.saves||0)
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
          },
          youtube: {
            views: period.youtube.views,
            likes: period.youtube.likes,
            comments: period.youtube.comments
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
    
    const mergedData = mergeHistoricalData(data || {});
    
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
          
          const youtubeViews = (h.youtube && typeof h.youtube === 'object') ? h.youtube.views : 0;
          const youtubeLikes = (h.youtube && typeof h.youtube === 'object') ? h.youtube.likes : 0;
          const youtubeComments = (h.youtube && typeof h.youtube === 'object') ? h.youtube.comments : 0;

          const totalViews = Number(h.views) || 0;
          const totalLikes = Number(h.likes) || 0;
          const totalComments = Number(h.comments) || 0;
          
          console.log('[WEEKLY VIEW] Parsed values:', {
            period: `${startDate.toISOString().slice(0,10)} to ${endDate.toISOString().slice(0,10)}`,
            total: { views: totalViews, likes: totalLikes, comments: totalComments },
            tiktok: { views: tiktokViews, likes: tiktokLikes, comments: tiktokComments },
            instagram: { views: instagramViews, likes: instagramLikes, comments: instagramComments },
            youtube: { views: youtubeViews, likes: youtubeLikes, comments: youtubeComments }
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
            youtube: youtubeViews,
            youtube_likes: youtubeLikes,
            youtube_comments: youtubeComments,
            is_historical: true,
            groups: [] // No groups for historical data
          });
        });
      }
      
      // Historical cutoff for weekly view
      const HISTORICAL_CUTOFF = '2026-02-04';
      const REALTIME_START = '2026-02-05';
      
      console.log('[WEEKLY VIEW] ═══════════════════════════════════════════════════════════');
      console.log('[WEEKLY VIEW] Range:', accrualCustomStart, 'to', accrualCustomEnd);
      console.log('[WEEKLY VIEW] Historical cutoff:', HISTORICAL_CUTOFF);
      console.log('[WEEKLY VIEW] Historical periods loaded:', histPeriods.length);
      console.log('[WEEKLY VIEW] Real-time daily entries:', (src.total || []).length);
      
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
      const realtimeData = (src.total || []).filter((d: any) => String(d.date) >= REALTIME_START);
      const realtimeTT = (src.total_tiktok || []).filter((d: any) => String(d.date) >= REALTIME_START);
      const realtimeIG = (src.total_instagram || []).filter((d: any) => String(d.date) >= REALTIME_START);
      
      console.log('[WEEKLY VIEW] Real-time entries after cutoff:', realtimeData.length);
      
      if (realtimeData.length > 0) {
        // Group real-time data by week starting from REALTIME_START
        const weeklyTotal = groupByWeek(realtimeData, REALTIME_START);
        const weeklyTT = groupByWeek(realtimeTT, REALTIME_START);
        const weeklyIG = groupByWeek(realtimeIG, REALTIME_START);
        const realtimeYT = (src.total_youtube || []).filter((d: any) => String(d.date) >= REALTIME_START);
        const weeklyYT = groupByWeek(realtimeYT, REALTIME_START);
        
        console.log('[WEEKLY VIEW] Real-time weeks:', weeklyTotal.length);
        
        // Build maps for platform data
        const ttByWeekNum = new Map<number, any>();
        weeklyTT.forEach((w: any) => ttByWeekNum.set(w.weekNum, w));
        const igByWeekNum = new Map<number, any>();
        weeklyIG.forEach((w: any) => igByWeekNum.set(w.weekNum, w));
        const ytByWeekNum = new Map<number, any>();
        weeklyYT.forEach((w: any) => ytByWeekNum.set(w.weekNum, w));
        
        // Get groups weekly data for real-time
        const groupsWeekly: any[] = [];
        if (src.groups && src.groups.length > 0) {
          src.groups.forEach((group: any) => {
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
          const ytData = ytByWeekNum.get(w.weekNum) || { views: 0, likes: 0, comments: 0 };
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
              youtube: ytData.views,
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
          youtube: 0, youtube_likes: 0, youtube_comments: 0,
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
        cur.youtube += Number(p.youtube)||0;
        cur.youtube_likes += Number(p.youtube_likes)||0;
        cur.youtube_comments += Number(p.youtube_comments)||0;
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

        // YouTube breakdown
        const youtubeVals = allPeriods.map((p: any) => {
          const val = metric === 'likes' ? (p.youtube_likes || 0) : metric === 'comments' ? (p.youtube_comments || 0) : (p.youtube || 0);
          return val || 0;
        });
        datasets.push({
          label: 'YouTube',
          data: youtubeVals,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.15)',
          fill: false,
          tension: 0.35,
          yAxisID: 'y'
        });
      }
      
      // Per group lines - extract from allPeriods
      if (src.groups && src.groups.length > 0) {
        src.groups.forEach((group: any, idx: number) => {
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
      
      return { labels, datasets };
    }
    
    // Postdate Weekly: build from historical periods (DB) then realtime weekly starting 2026-02-05
    if (mode==='postdate' && interval==='weekly') {
      const REALTIME_START = '2026-02-05';
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
          youtube: Number((r as any).youtube_views|| (r as any).youtube)||0,
          youtube_likes: Number((r as any).youtube_likes||0),
          youtube_comments: Number((r as any).youtube_comments||0),
          is_historical: true,
          groups: []
        });
      }
      // 2) Realtime weekly from src series (daily) starting at REALTIME_START
      const sumSeries = (arr:any[] = [], key:'views'|'likes'|'comments') => arr.reduce((acc:Map<number,number>, s:any)=>{
        const d = new Date(String(s.date)+'T00:00:00Z');
        if (d < anchor) return acc; // ignore pre-cutoff realtime
        const idx = Math.floor((d.getTime()-anchor.getTime())/(7*24*60*60*1000));
        const cur = acc.get(idx)||0; acc.set(idx, cur + Number(s[key]||0)); return acc;
      }, new Map<number,number>());
      const mapViews = sumSeries(src.total||[], 'views');
      const mapLikes = sumSeries(src.total||[], 'likes');
      const mapComments = sumSeries(src.total||[], 'comments');
      const mapTTViews = sumSeries(src.total_tiktok||[], 'views');
      const mapTTLikes = sumSeries(src.total_tiktok||[], 'likes');
      const mapTTComments = sumSeries(src.total_tiktok||[], 'comments');
      const mapIGViews = sumSeries(src.total_instagram||[], 'views');
      const mapIGLikes = sumSeries(src.total_instagram||[], 'likes');
      const mapIGComments = sumSeries(src.total_instagram||[], 'comments');
      const mapYTViews = sumSeries(src.total_youtube||[], 'views');
      const mapYTLikes = sumSeries(src.total_youtube||[], 'likes');
      const mapYTComments = sumSeries(src.total_youtube||[], 'comments');
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
          youtube: mapYTViews.get(idx)||0,
          youtube_likes: mapYTLikes.get(idx)||0,
          youtube_comments: mapYTComments.get(idx)||0,
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
      if (Array.isArray(src.groups) && src.groups.length) {
        const histLen = histPeriods.length;
        // Build map of weekNum -> position index within realtime segment
        const idxToPos = new Map<number, number>();
        indices.forEach((wIdx:number, pos:number)=> idxToPos.set(wIdx, pos));
        for (let gi=0; gi<src.groups.length; gi++) {
          const g = src.groups[gi];
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

      return { labels, datasets };
    }

    // Postdate view: build labels based on interval
    if (interval === 'weekly') {
      labels = (src.total || []).map((s:any)=>{
        const start = parseISO(s.date);
        const end = new Date(start.getTime()); end.setUTCDate(end.getUTCDate()+6);
        const ds = start.getUTCDate();
        const de = end.getUTCDate();
        const tail = format(end,'MMM yyyy', { locale: localeID });
        return `${ds}-${de} ${tail}`;
      });
    } else if (interval === 'monthly') {
      labels = (src.total || []).map((s:any)=> format(parseISO(s.date),'MMM yyyy', {locale: localeID}));
    } else {
      labels = (src.total || []).map((s:any)=> format(parseISO(s.date),'d MMM', {locale: localeID}));
    }
    const datasets:any[] = [];

    // Total first (filtered by platform)
    let totalSeries = src.total || [];
    if (platformFilter === 'tiktok' && Array.isArray(src.total_tiktok) && src.total_tiktok.length) {
      totalSeries = src.total_tiktok;
    } else if (platformFilter === 'instagram' && Array.isArray(src.total_instagram) && src.total_instagram.length) {
      totalSeries = src.total_instagram;
    } else if (platformFilter === 'youtube' && Array.isArray(src.total_youtube) && src.total_youtube.length) {
      totalSeries = src.total_youtube;
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
      if (Array.isArray(src.total_tiktok) && src.total_tiktok.length) {
        const ttVals = src.total_tiktok.map((s:any)=> metric==='likes'? s.likes : metric==='comments'? s.comments : s.views);
        datasets.push({ label:'TikTok', data: ttVals, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.15)', fill: false, tension: 0.35, yAxisID: 'y' });
      }
      if (Array.isArray(src.total_instagram) && src.total_instagram.length) {
        const igVals = src.total_instagram.map((s:any)=> metric==='likes'? s.likes : metric==='comments'? s.comments : s.views);
        datasets.push({ label:'Instagram', data: igVals, borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.15)', fill: false, tension: 0.35, yAxisID: 'y' });
      }
      if (Array.isArray(src.total_youtube) && src.total_youtube.length) {
        const ytVals = src.total_youtube.map((s:any)=> metric==='likes'? s.likes : metric==='comments'? s.comments : s.views);
        datasets.push({ label:'YouTube', data: ytVals, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)', fill: false, tension: 0.35, yAxisID: 'y' });
      }
    }

    // Per group lines (filter by platform)
    for (let i=0;i<(src.groups||[]).length;i++){
      const g = src.groups[i];
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
    
    return { labels, datasets };
  }, [data, videoSeriesData, metric, interval, weeklyView, useCustomAccrualDates, mode, accrualCustomStart, platformFilter, historicalData, showHistorical]);

  // Posts chart data - derived from videos API (same source of truth as detail video page)
  const postsChartData = useMemo(() => {
    if (!postsData || postsData.length === 0 || !chartData) return null;

    // Build per-platform maps: date string -> count
    const buildMap = (key: string) => {
      const m = new Map<string, number>();
      postsData.forEach((p: any) => m.set(String(p.date), Number(p[key] || 0)));
      return m;
    };
    const totalMap = buildMap('posts');
    const tiktokMap = buildMap('posts_tiktok');
    const instagramMap = buildMap('posts_instagram');
    const youtubeMap = buildMap('posts_youtube');

    const labels = chartData.labels;
    // Use videoSeriesData as primary source (same as main chart), fallback to data
    const totalSeries = videoSeriesData?.total || data?.total || [];

    // Aggregate a map into values aligned with chart labels
    const aggregate = (postsMap: Map<string, number>) => {
      let values: number[];
      if (interval === 'daily' || (!totalSeries.length)) {
        values = totalSeries.map((t: any) => postsMap.get(String(t.date)) || 0);
      } else if (interval === 'weekly') {
        values = totalSeries.map((t: any) => {
          const startDate = new Date(String(t.date) + 'T00:00:00Z');
          const endDate = new Date(startDate.getTime()); endDate.setUTCDate(endDate.getUTCDate() + 6);
          let sum = 0;
          for (const [ds, c] of postsMap.entries()) {
            const d = new Date(ds + 'T00:00:00Z');
            if (d >= startDate && d <= endDate) sum += c;
          }
          return sum;
        });
      } else {
        values = totalSeries.map((t: any) => {
          const d = new Date(String(t.date) + 'T00:00:00Z');
          const m = d.getUTCMonth(); const y = d.getUTCFullYear();
          let sum = 0;
          for (const [ds, c] of postsMap.entries()) {
            const pd = new Date(ds + 'T00:00:00Z');
            if (pd.getUTCMonth() === m && pd.getUTCFullYear() === y) sum += c;
          }
          return sum;
        });
      }
      if (labels.length > values.length) {
        const pad = new Array(labels.length - values.length).fill(0);
        values = [...pad, ...values];
      }
      return values;
    };

    const datasets: any[] = [];
    if (postsShowTotal) {
      datasets.push({ label: 'Total Posts', data: aggregate(totalMap), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.15)', fill: true, tension: 0.35 });
    }
    if (postsShowTikTok) {
      datasets.push({ label: 'TikTok', data: aggregate(tiktokMap), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.10)', fill: false, tension: 0.35 });
    }
    if (postsShowInstagram) {
      datasets.push({ label: 'Instagram', data: aggregate(instagramMap), borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.10)', fill: false, tension: 0.35 });
    }
    if (postsShowYouTube) {
      datasets.push({ label: 'YouTube', data: aggregate(youtubeMap), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.10)', fill: false, tension: 0.35 });
    }

    if (datasets.length === 0) return null;

    return { labels, datasets };
  }, [postsData, chartData, data, videoSeriesData, interval, postsShowTotal, postsShowTikTok, postsShowInstagram, postsShowYouTube]);

  // Crosshair + floating label, like Groups
  const chartRef = useRef<any>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  
  // Calculate grand totals: prefer sum of all group totals (from members API) for consistency
  // with /dashboard/groups page. Fallback to series-based sum.
  const grandTotals = useMemo(() => {
    if (!data) return { views: 0, likes: 0, comments: 0 };
    // Sum from the same data source as the chart to ensure header matches chart values
    const sumArr = (arr:any[] = []) => arr.reduce((a:any,s:any)=>({
      views: (a.views||0) + Number(s.views||0),
      likes: (a.likes||0) + Number(s.likes||0),
      comments: (a.comments||0) + Number(s.comments||0)
    }), { views:0, likes:0, comments:0 });

    if (platformFilter === 'tiktok' && Array.isArray(data.total_tiktok)) {
      return sumArr(data.total_tiktok);
    } else if (platformFilter === 'instagram' && Array.isArray(data.total_instagram)) {
      return sumArr(data.total_instagram);
    } else if (platformFilter === 'youtube' && Array.isArray(data.total_youtube)) {
      return sumArr(data.total_youtube);
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
      <div className="glass rounded-2xl p-3 sm:p-4 border border-white/10 mb-4">
        <div className="flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-1 text-xs sm:text-sm text-white/70">
          {data && (
            <>
              <span>Views: <strong className="text-white">{Number(videoTotals?.views ?? grandTotals.views).toLocaleString('id-ID')}</strong></span>
              <span>Likes: <strong className="text-white">{Number(videoTotals?.likes ?? grandTotals.likes).toLocaleString('id-ID')}</strong></span>
              <span>Comments: <strong className="text-white">{Number(videoTotals?.comments ?? grandTotals.comments).toLocaleString('id-ID')}</strong></span>
              <span>Posts: <strong className="text-white">{postsData.reduce((sum, p: any) => sum + Number(p.posts || 0), 0).toLocaleString('id-ID')}</strong></span>
              {lastUpdatedHuman && (
                <span className="sm:ml-auto text-white/60 w-full sm:w-auto mt-1 sm:mt-0">Terakhir diperbarui: <strong className="text-white/80">{lastUpdatedHuman}</strong></span>
              )}
            </>
          )}
        </div>
        <div className="mt-3">
          {mode === 'postdate' ? (
            <div className="flex items-center gap-1.5 sm:gap-2 w-full">
              <input type="date" value={start} onChange={(e)=>setStart(e.target.value)} className="px-2 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-xs sm:text-sm flex-1 sm:flex-none min-w-0"/>
              <span className="text-white/50 text-xs">s/d</span>
              <input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} className="px-2 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-xs sm:text-sm flex-1 sm:flex-none min-w-0"/>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2 w-full">
              <input type="date" value={accrualCustomStart} onChange={(e)=>setAccrualCustomStart(e.target.value)} className="px-2 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-xs sm:text-sm flex-1 sm:flex-none min-w-0"/>
              <span className="text-white/50 text-xs">→</span>
              <input type="date" value={accrualCustomEnd} onChange={(e)=>setAccrualCustomEnd(e.target.value)} className="px-2 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/80 text-xs sm:text-sm flex-1 sm:flex-none min-w-0"/>
            </div>
          )}
        </div>
      </div>

      {/* Controls: Mode + Posts on left, Metric on right */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded bg-white/20 text-white">Post Date</span>
          <button
            className={`px-2 py-1 rounded flex items-center gap-1 ${showPosts?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`}
            onClick={()=>setShowPosts(!showPosts)}
          >
            <span className="text-[#a855f7]">●</span> Posts
          </button>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <span className="text-white/60 hidden sm:inline">Metric:</span>
          <button className={`px-2 py-1 rounded ${metric==='views'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setMetric('views')}>Views</button>
          <button className={`px-2 py-1 rounded ${metric==='likes'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setMetric('likes')}>Likes</button>
          <button className={`px-2 py-1 rounded ${metric==='comments'?'bg-white/20 text-white':'text-white/70 hover:text-white hover:bg-white/10'}`} onClick={()=>setMetric('comments')}>Comments</button>
        </div>
      </div>
      

      <div className="glass rounded-2xl p-4 md:p-6 border border-white/10 overflow-x-auto">
        {loading && <p className="text-white/60">Memuat…</p>}
        {/* Main chart (Views/Likes/Comments) - hidden when Posts enabled */}
        {!loading && !showPosts && chartData && (
          <Line ref={chartRef} data={chartData} plugins={[crosshairPlugin]} options={{
            responsive:true,
            interaction:{ mode:'index', intersect:false },
            plugins:{
              legend:{ labels:{ color:'rgba(255,255,255,0.8)'} },
              tooltip: {
                filter: function(tooltipItem: any) {
                  const label = tooltipItem.dataset.label || '';
                  const value = tooltipItem.parsed.y;
                  if (label.startsWith('Group') && value === 0) return false;
                  return true;
                }
              }
            },
            scales:{
              x:{
                ticks:{ color:'rgba(255,255,255,0.6)', autoSkip: false, maxRotation: 90, minRotation: 45, font: { size: 9 } },
                grid:{ color:'rgba(255,255,255,0.06)'}
              },
              y:{
                type: 'linear', display: true, position: 'left',
                ticks:{ color:'rgba(255,255,255,0.6)'},
                grid:{ color:'rgba(255,255,255,0.06)'}
              }
            },
            onHover: (_e:any, el:any[])=> setActiveIndex(el && el.length>0 ? (el[0].index ?? null) : null)
          }} onMouseLeave={()=> setActiveIndex(null)} />
        )}
        {/* Posts chart - shown only when Posts enabled */}
        {!loading && showPosts && postsChartData && (
          <Line data={postsChartData} options={{
            responsive:true,
            interaction:{ mode:'index', intersect:false },
            plugins:{
              legend:{ labels:{ color:'rgba(255,255,255,0.8)'} }
            },
            scales:{
              x:{
                ticks:{ color:'rgba(255,255,255,0.6)', autoSkip: true, maxRotation: 90, minRotation: 45, font: { size: 9 } },
                grid:{ color:'rgba(255,255,255,0.06)'}
              },
              y:{
                type: 'linear', display: true, position: 'left',
                ticks:{ color:'#a855f7' },
                grid:{ color:'rgba(255,255,255,0.06)'},
                beginAtZero: true
              }
            }
          }} />
        )}
        {!loading && showPosts && !postsChartData && (
          <p className="text-white/40 text-sm text-center py-8">Tidak ada data posts</p>
        )}
      </div>

      {/* Top 15 Video FYP Section (aggregate across all groups when campaignId undefined) */}
      <div className="mt-8">
        <TopViralDashboard 
          days={30} 
          limit={15} 
        />
      </div>
    </div>
  );
}
