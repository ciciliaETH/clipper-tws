import { NextResponse } from 'next/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { rapidApiRequest } from '@/lib/rapidapi';
import { parseMs, resolveTimestamp, resolveCounts } from './helpers';
import { fetchAllProviders, fetchProfileData, fetchLinksData, IG_HOST, IG_SCRAPER_HOST } from './providers';
import { resolveUserIdViaLink, resolveUserId } from './resolvers';
import http from 'node:http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s - fit Vercel Hobby limit

// ============================================
// AGGREGATOR API CONFIGURATION (Instagram)
// ============================================
// v3 aggregator (port 80) - separate env var so old v1 env vars don't interfere
const AGG_BASE = process.env.AGGREGATOR_V3_BASE || 'http://202.10.44.90/api/v3';
const AGG_IG_ENABLED = (process.env.AGGREGATOR_ENABLED !== '0');
const AGG_IG_UNLIMITED = (process.env.AGGREGATOR_UNLIMITED !== '0');
// Reduce default max pages to ensure we never exceed 60s per request
const AGG_IG_MAX_PAGES = Number(process.env.AGGREGATOR_MAX_PAGES || 10);
const AGG_IG_RATE_MS = Number(process.env.AGGREGATOR_RATE_MS || 500);
const AGG_IG_PAGE_SIZE = Number(process.env.AGGREGATOR_PAGE_SIZE || 50); // use larger page size to minimize pagination

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Convert Instagram shortcode to numeric media ID (base64-like)
const SHORTCODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function shortcodeToId(code: string): string {
  let id = BigInt(0);
  for (const c of code) {
    id = id * BigInt(64) + BigInt(SHORTCODE_CHARS.indexOf(c));
  }
  return id.toString();
}

// Node.js native http.request - more reliable than fetch() for port 5000
function httpGet(urlStr: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: timeoutMs,
      headers: { 'Accept': 'application/json', 'Connection': 'close' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`HTTP timeout after ${timeoutMs}ms`)); });
    req.on('error', (err) => reject(err));
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`Hard timeout after ${timeoutMs + 2000}ms`)); }, timeoutMs + 2000);
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

// RapidAPI host for media details (for getting taken_at)
const IG_MEDIA_API = 'instagram-media-api.p.rapidapi.com';

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// ============================================
// MERGE HELPER: Preserve existing DB values on refresh
// If the DB already has taken_at/caption/code, NEVER overwrite with NULL.
// Only update metrics (play_count, like_count, comment_count).
// ============================================
const PROTECTED_FIELDS = ['taken_at', 'post_date', 'caption', 'code'] as const;

async function mergeWithExisting(supa: ReturnType<typeof admin>, records: any[]): Promise<any[]> {
  if (records.length === 0) return records;

  const ids = records.map(r => String(r.id)).filter(Boolean);
  if (ids.length === 0) return records;

  // Fetch existing protected-field values in chunks of 500
  const existingMap = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data } = await supa
      .from('instagram_posts_daily')
      .select('id, taken_at, post_date, caption, code')
      .in('id', chunk);
    for (const row of (data || [])) {
      existingMap.set(String(row.id), row);
    }
  }

  if (existingMap.size === 0) return records; // all new, nothing to merge

  return records.map(r => {
    const ex = existingMap.get(String(r.id));
    if (!ex) return r; // new record → use as-is

    const merged = { ...r };
    for (const field of PROTECTED_FIELDS) {
      const newVal = merged[field];
      const oldVal = ex[field];
      // If new value is null/empty BUT DB already has data → keep DB value
      if ((newVal === null || newVal === undefined || newVal === '') && oldVal) {
        merged[field] = oldVal;
      }
    }
    return merged;
  });
}

// Helper to fetch taken_at from RapidAPI media/shortcode_reels endpoint
async function fetchTakenAt(code: string): Promise<number | null> {
  if (!code) return null;
  try {
    // Incremental start: get last taken_at we already have for this username
    let lastTakenAtMs: number | null = null;
    try {
      const { data: lastRow } = await admin()
        .from('instagram_posts_daily')
        .select('taken_at')
        .eq('username', norm)
        .order('taken_at', { ascending: false })
        .limit(1);
      const iso = Array.isArray(lastRow) && lastRow[0]?.taken_at ? String((lastRow as any)[0].taken_at) : null;
      if (iso) lastTakenAtMs = Date.parse(iso);
    } catch {}
    const j = await rapidApiRequest<any>({
      url: `https://${IG_MEDIA_API}/media/shortcode_reels`,
      method: 'POST',
      rapidApiHost: IG_MEDIA_API,
      body: { shortcode: code, proxy: '' },
      timeoutMs: 10000,
      maxPerKeyRetries: 1
    });
    // Response: data.xdt_api__v1__media__shortcode__web_info.items[0].taken_at
    const items = j?.data?.xdt_api__v1__media__shortcode__web_info?.items || j?.items || [];
    const item = items[0] || j;
    const ts = parseMs(item?.taken_at) || parseMs(item?.taken_at_timestamp);
    return ts;
  } catch {
    return null;
  }
}

// Helper to extract caption from various API response formats
function extractCaption(media: any, node?: any): string {
  const caption = media?.caption?.text 
    || media?.caption 
    || media?.edge_media_to_caption?.edges?.[0]?.node?.text
    || node?.caption?.text
    || node?.caption
    || node?.edge_media_to_caption?.edges?.[0]?.node?.text
    || '';
  return String(caption);
}

export async function GET(req: Request, context: any) {
  const { username } = await context.params as { username: string };
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
  
  const norm = String(username).replace(/^@/, '').toLowerCase();
  const url = new URL(req.url);
  const cleanup = String(url.searchParams.get('cleanup')||'');
  const debug = url.searchParams.get('debug') === '1';
  const allowUsernameFallback = (process.env.FETCH_IG_ALLOW_USERNAME_FALLBACK === '1') || (url.searchParams.get('allow_username') === '1');
  // Date window: default start to 2026-01-01 for consistent refresh
  const startParam = url.searchParams.get('start') || '2026-01-01';
  const endParam = url.searchParams.get('end') || null;
  // Optional tuning via query params
  const qpMaxPages = Number(url.searchParams.get('max_pages') || '') || undefined;
  const qpPageSize = Number(url.searchParams.get('page_size') || '') || undefined;
  const qpBudgetMs = Number(url.searchParams.get('time_budget_ms') || '') || undefined;
  const maxPages = Math.max(1, Math.min(AGG_IG_MAX_PAGES, qpMaxPages ?? AGG_IG_MAX_PAGES));
  const pageSize = Math.min(50, Math.max(1, qpPageSize ?? AGG_IG_PAGE_SIZE));
  const budgetMs = Math.max(5000, Math.min(60000, qpBudgetMs ?? 25000));

  const supa = admin();
  const upserts: any[] = [];
  let source = 'aggregator';
  let fetchTelemetry: any = null;
  
  try {
    // ============================================
    // STEP 1: Try AGGREGATOR v3 (port 5000, includes taken_at)
    // ============================================
    if (AGG_BASE && AGG_IG_ENABLED) {
      try {
        console.log(`[IG Fetch] Starting Aggregator v3 fetch for @${norm}`);

        const startTs = Date.now();
        const allReels: any[] = [];
        const seenCodes = new Set<string>();
        let currentMaxId: string | null = null;
        let pageNum = 0;
        let aggUserId: string | null = null;

        // Pre-resolve user_id from DB (improves aggregator hit rate)
        try {
          const { data: row } = await admin()
            .from('instagram_user_ids')
            .select('instagram_user_id')
            .eq('instagram_username', norm)
            .maybeSingle();
          if ((row as any)?.instagram_user_id) aggUserId = String((row as any).instagram_user_id);
        } catch {}
        if (!aggUserId) {
          try { aggUserId = await resolveUserIdViaLink(norm, admin()) || null; } catch {}
        }
        console.log(`[IG Fetch] Pre-resolved user_id for @${norm}: ${aggUserId || 'none'}`);

        // Pagination loop (v3 uses max_id instead of end_cursor)
        while (pageNum < maxPages) {
          pageNum++;

          let aggUrl = `${AGG_BASE}/instagram/reels?username=${encodeURIComponent(norm)}`;
          if (aggUserId) aggUrl += `&user_id=${encodeURIComponent(aggUserId)}`;
          if (currentMaxId) {
            aggUrl += `&max_id=${encodeURIComponent(currentMaxId)}`;
          }

          console.log(`[IG Fetch] Page ${pageNum}: GET ${aggUrl}`);

          // Respect overall time budget per request
          const elapsed = Date.now() - startTs;
          const remaining = Math.max(0, budgetMs - elapsed);
          if (remaining < 3000) {
            console.log(`[IG Fetch] Budget nearly exhausted (${elapsed}ms used), stopping pagination`);
            break;
          }

          const perPageTimeout = Math.min(50000, Math.max(2500, remaining - 1000));

          // Use Node.js http.request instead of fetch() (fetch hangs on port 5000)
          let respBody: string;
          try {
            const resp = await httpGet(aggUrl, perPageTimeout);
            console.log(`[IG Fetch] httpGet response: status=${resp.status}, bodyLen=${resp.body.length}, body=${resp.body.substring(0, 150)}`);
            if (resp.status !== 200) {
              console.log(`[IG Fetch] Aggregator HTTP ${resp.status} on page ${pageNum}`);
              break;
            }
            respBody = resp.body;
          } catch (httpErr: any) {
            console.warn(`[IG Fetch] Aggregator httpGet FAILED on page ${pageNum}:`, httpErr.message);
            break;
          }

          let aggJson: any;
          try {
            aggJson = JSON.parse(respBody);
          } catch (parseErr: any) {
            console.warn(`[IG Fetch] JSON parse failed on page ${pageNum}:`, parseErr.message, 'body:', respBody.substring(0, 200));
            break;
          }
          if (aggJson?.status !== 'success' || !aggJson?.data) {
            console.log(`[IG Fetch] Aggregator returned non-success on page ${pageNum}: ${respBody.substring(0, 200)}`);
            break;
          }
          console.log(`[IG Fetch] Parsed OK: reels=${aggJson.data.reels?.length}, user_id=${aggJson.data.user_id}, hasMore=${aggJson.data.pagination?.has_more}`);

          const aggData = aggJson.data;
          const reels: any[] = Array.isArray(aggData.reels) ? aggData.reels : [];
          const pagination = aggData.pagination || {};
          const hasMore = !!pagination.has_more;
          const nextMaxId = pagination.max_id || null;

          // Save user_id from v3 response
          if (aggData.user_id && !aggUserId) {
            aggUserId = String(aggData.user_id);
          }

          // Process reels from this page
          let newCount = 0;
          for (const reel of reels) {
            const code = String(reel.code || '');
            if (!code || seenCodes.has(code)) continue;
            seenCodes.add(code);
            newCount++;

            // Convert shortcode to numeric ID for DB (onConflict: 'id')
            const numericId = shortcodeToId(code);

            // v3 returns taken_at as unix seconds
            const takenAtSec = Number(reel.taken_at);
            const taken_at = (!isNaN(takenAtSec) && takenAtSec > 0)
              ? new Date(takenAtSec * 1000).toISOString()
              : null;

            allReels.push({
              id: numericId,
              code,
              caption: reel.caption || null,
              username: norm,
              taken_at,
              post_date: taken_at ? taken_at.slice(0, 10) : null,
              play_count: Number(reel.views) || 0,
              like_count: Number(reel.likes) || 0,
              comment_count: Number(reel.comments) || 0
            });
          }

          console.log(`[IG Fetch] Page ${pageNum}: +${newCount} new reels (total: ${allReels.length})`);

          // Check for termination conditions
          if (!hasMore || !nextMaxId) {
            console.log(`[IG Fetch] Completed: No more pages (hasMore=${hasMore})`);
            break;
          }

          currentMaxId = nextMaxId;

          // Rate limiting
          const postElapsed = Date.now() - startTs;
          if (postElapsed + AGG_IG_RATE_MS > budgetMs) {
            console.log(`[IG Fetch] Budget would be exceeded by next delay, stopping at page ${pageNum}`);
            break;
          }
          await sleep(AGG_IG_RATE_MS);
        }

        // Save user_id to instagram_user_ids table
        if (aggUserId) {
          try {
            await supa.from('instagram_user_ids').upsert({
              instagram_username: norm,
              instagram_user_id: aggUserId,
              created_at: new Date().toISOString()
            }, { onConflict: 'instagram_username' });
          } catch {}
        }

        if (allReels.length > 0) {
          console.log(`[IG Fetch] Aggregator v3 COMPLETE: ${allReels.length} reels, ${pageNum} pages`);

          upserts.push(...allReels);
          source = 'aggregator_v3';
          fetchTelemetry = {
            source: 'aggregator_v3',
            totalReels: allReels.length,
            pagesProcessed: pageNum,
            success: true
          };

          // Save to database
          if (upserts.length > 0) {
            // MERGE with existing DB data: preserve taken_at/caption/code if already in DB
            const merged = await mergeWithExisting(supa, upserts);
            console.log(`[IG Fetch] Merged ${merged.length} records (preserved existing DB values for protected fields)`);

            // Group by column set so each PostgREST batch has consistent columns.
            const colGroups = new Map<string, any[]>();
            for (const r of merged) {
              const clean: any = {};
              for (const [k, v] of Object.entries(r)) {
                if ((k === 'taken_at' || k === 'post_date' || k === 'caption' || k === 'code') && (v === null || v === undefined || v === '')) continue;
                clean[k] = v;
              }
              const key = Object.keys(clean).sort().join(',');
              if (!colGroups.has(key)) colGroups.set(key, []);
              colGroups.get(key)!.push(clean);
            }
            for (const batch of colGroups.values()) {
              const { error: upErr } = await supa.from('instagram_posts_daily').upsert(batch, { onConflict: 'id' });
              if (upErr) {
                console.warn('[IG Fetch] upsert instagram_posts_daily failed:', upErr.message);
              }
            }
            const totalViews = upserts.reduce((s, u) => s + (Number(u.play_count) || 0), 0);
            const totalLikes = upserts.reduce((s, u) => s + (Number(u.like_count) || 0), 0);
            const totalComments = upserts.reduce((s, u) => s + (Number(u.comment_count) || 0), 0);
            return NextResponse.json({
              success: true,
              source,
              username: norm,
              inserted: upserts.length,
              total_views: totalViews,
              total_likes: totalLikes,
              total_comments: totalComments,
              telemetry: fetchTelemetry
            });
          }
        } else {
          console.log(`[IG Fetch] Aggregator v3 returned 0 reels after ${pageNum} pages — falling through to RapidAPI`);
          // Don't return early! Fall through to STEP 2 (RapidAPI fallback)
        }
      } catch (aggErr: any) {
        // Fallback to RapidAPI instead of failing
        console.warn(`[IG Fetch] Aggregator v3 error, falling back to RapidAPI:`, aggErr.message);
      }
    }

    // ============================================
    // STEP 2: FALLBACK to RapidAPI
    // ============================================
    console.log(`[fetch-ig] Trying RapidAPI fallback for @${norm}...`);
    let userId = await resolveUserIdViaLink(norm, supa);
    let edges: any[] = [];

    if (!userId) {
      const infoEndpoints = [
        `https://${IG_HOST}/api/instagram/user?username=${encodeURIComponent(norm)}`,
        `https://${IG_HOST}/api/instagram/userinfo?username=${encodeURIComponent(norm)}`,
        `https://${IG_HOST}/api/instagram/username?username=${encodeURIComponent(norm)}`,
      ];
      for (const u of infoEndpoints) {
        try {
          const ij = await rapidApiRequest<any>({ url: u, method: 'GET', rapidApiHost: IG_HOST, timeoutMs: 15000 });
          const cand = ij?.result?.user || ij?.user || ij?.result || {};
          const pk = cand?.pk || cand?.id || cand?.pk_id || ij?.result?.pk || ij?.result?.id;
          if (pk) { userId = String(pk); break; }
        } catch {}
      }
    }

    if (userId) {
      try { 
        await supa.from('instagram_user_ids').upsert({ 
          instagram_username: norm, 
          instagram_user_id: String(userId), 
          created_at: new Date().toISOString() 
        }, { onConflict: 'instagram_username' }); 
      } catch {}

      const results = await fetchAllProviders(userId);
      const scraperResult = results.find(r => r.source === 'scraper' && r.items.length > 0);
      const anySuccessful = results.find(r => r.items.length > 0);
      const bestResult = scraperResult || anySuccessful;
      
      if (bestResult && bestResult.items.length > 0) {
        if (bestResult.source === 'scraper') {
          for (const it of bestResult.items) {
            const id = String(it?.id || it?.code || ''); 
            const code = String(it?.code || '');
            if (!id) continue;
            
            // Try multiple timestamp fields from RapidAPI response
            let ms = parseMs(it?.taken_at) || parseMs(it?.device_timestamp) || parseMs(it?.taken_at_timestamp) || parseMs(it?.timestamp) || parseMs(it?.taken_at_ms) || parseMs(it?.created_at) || parseMs(it?.created_at_utc) || null;
            
            // Fallback 1: Try fetchTakenAt if we have code
            if (!ms && code) {
              ms = await fetchTakenAt(code);
            }
            
            // Fallback 2: Use NOW() if still no timestamp (rare case)
            const taken_at = ms ? new Date(ms).toISOString() : new Date().toISOString();
            
            const caption = String(it?.caption?.text || it?.caption || '');
            let play = Number(it?.play_count ?? it?.ig_play_count ?? it?.view_count ?? it?.video_view_count ?? 0) || 0;
            let like = Number(it?.like_count ?? 0) || 0;
            let comment = Number(it?.comment_count ?? 0) || 0;
            
            if ((play + like + comment) === 0) {
              try {
                const cj = await rapidApiRequest<any>({ 
                  url: `https://${IG_HOST}/api/instagram/media_info?id=${encodeURIComponent(id)}`, 
                  method: 'GET', 
                  rapidApiHost: IG_HOST, 
                  timeoutMs: 15000,
                  maxPerKeyRetries: 2
                });
                const m = cj?.result?.items?.[0] || cj?.result?.media || cj?.result || cj?.item || cj;
                play = Number(m?.play_count || m?.view_count || m?.video_view_count || 0) || 0;
                like = Number(m?.like_count || m?.edge_liked_by?.count || 0) || 0;
                comment = Number(m?.comment_count || m?.edge_media_to_comment?.count || 0) || 0;
              } catch {}
            }
            
            upserts.push({ id, code: code || null, caption: caption || null, username: norm, taken_at, play_count: play, like_count: like, comment_count: comment });
          }
          source = 'rapidapi:scraper:fallback';
        } else if (bestResult.source === 'best') {
          for (const it of bestResult.items) {
            const media = it;
            const code = String(media?.code || '');
            const pid = String(media?.id || media?.pk || code || ''); 
            if (!pid) continue;
            
            // Try multiple timestamp fields from RapidAPI response
            let ms = parseMs(media?.taken_at) || parseMs(media?.device_timestamp) || parseMs(media?.taken_at_timestamp) || parseMs(media?.timestamp) || null;
            
            // Fallback 1: Try fetchTakenAt if we have code
            if (!ms && code) {
              ms = await fetchTakenAt(code);
            }
            
            // Fallback 2: Use NOW() if still no timestamp (rare case)
            const taken_at = ms ? new Date(ms).toISOString() : new Date().toISOString();
            
            const caption = String(media?.caption?.text || media?.caption || media?.edge_media_to_caption?.edges?.[0]?.node?.text || '');
            let play = Number(media?.play_count || media?.view_count || media?.video_view_count || 0) || 0;
            let like = Number(media?.like_count || 0) || 0;
            let comment = Number(media?.comment_count || 0) || 0;
            
            if ((play + like + comment) === 0) {
              const counts = await resolveCounts(media, { id: pid, code }, IG_HOST);
              if (counts) { play = counts.play; like = counts.like; comment = counts.comment; }
            }
            
            upserts.push({ id: pid, code: code || null, caption: caption || null, username: norm, taken_at, play_count: play, like_count: like, comment_count: comment });
          }
          source = 'rapidapi:best:fallback';
        } else {
          edges = bestResult.items;
          source = `rapidapi:${bestResult.source}:fallback`;
        }
      }
    }

    if (allowUsernameFallback && upserts.length === 0) {
      const medias = await fetchProfileData(norm);
      for (const m of medias) {
        const id = String(m?.id || m?.shortcode || ''); 
        const code = String(m?.shortcode || '');
        const caption = extractCaption(m);
        if (!id) continue;
        
        // Triple fallback for taken_at
        let takenAtMs = parseMs(m?.timestamp) || parseMs(m?.taken_at) || parseMs(m?.device_timestamp);
        if (!takenAtMs && code) takenAtMs = await fetchTakenAt(code);
        const taken_at = takenAtMs ? new Date(takenAtMs).toISOString() : new Date().toISOString();
        
        let play = Number(m?.video_views || m?.play_count || m?.view_count || m?.video_view_count || 0) || 0;
        let like = Number(m?.like || m?.like_count || 0) || 0;
        let comment = Number(m?.comment_count || 0) || 0;
        if ((play + like + comment) === 0) {
          const counts = await resolveCounts({ id, code }, { id, code }, IG_HOST);
          if (counts) { play = counts.play; like = counts.like; comment = counts.comment; }
        }
        if ((play + like + comment) === 0) continue;
        upserts.push({ id, code: code || null, caption: caption || null, username: norm, taken_at, play_count: play, like_count: like, comment_count: comment });
      }
      if (upserts.length > 0) source = 'profile1:username';
    }

    if (!Array.isArray(edges)) edges = [];
    const linksMap = new Map<string, number>();
    
    const linksArr = await fetchLinksData(`https://www.instagram.com/${norm}/reels/`);
    for (const it of linksArr) {
      const sc = String(it?.shortcode || it?.meta?.shortcode || '');
      const ts = parseMs(it?.takenAt || it?.meta?.takenAt);
      if (sc && ts) linksMap.set(sc, ts);
    }
    
    const telemetry = { edges: 0, linkMatches: 0, detailResolves: 0, skippedNoTimestamp: 0, fallbackLinksUsed: 0 } as any;
    for (const e of edges) {
      const node = e?.node || e?.media || e;
      const media = node?.media || node;
      const id = String(media?.pk || media?.id || media?.code || '');
      if (!id) continue;
      telemetry.edges += 1;
      
      let ms = parseMs(media?.taken_at) || parseMs(media?.taken_at_ms) || parseMs(media?.device_timestamp) || parseMs(media?.timestamp) || parseMs(node?.taken_at) || parseMs(node?.caption?.created_at) || parseMs(node?.caption?.created_at_utc);
      
      if (!ms) {
        const code = String(media?.code || node?.code || '');
        if (code && linksMap.has(code)) { 
          ms = linksMap.get(code)!; 
          telemetry.linkMatches += 1; 
        }
        if (!ms) {
          ms = await resolveTimestamp(media, node, IG_HOST);
          if (ms) telemetry.detailResolves += 1;
        }
        if (!ms) { 
          telemetry.skippedNoTimestamp += 1; 
          continue; 
        }
      }
      
      const d = new Date(ms!);
      const code = String(media?.code || node?.code || '');
      const caption = extractCaption(media, node);
      let play = Number(media?.play_count ?? media?.view_count ?? media?.video_view_count ?? 0) || 0;
      let like = Number(media?.like_count ?? media?.edge_liked_by?.count ?? 0) || 0;
      let comment = Number(media?.comment_count ?? media?.edge_media_to_comment?.count ?? 0) || 0;
      
      if ((play + like + comment) === 0) {
        const fixed = await resolveCounts(media, node, IG_HOST);
        if (fixed) { 
          play = fixed.play; 
          like = fixed.like; 
          comment = fixed.comment; 
        }
      }
      if ((play + like + comment) === 0) continue;
      // Always set taken_at - use NOW() as fallback if ms is NULL
      const taken_at = ms ? new Date(ms).toISOString() : new Date().toISOString();
      upserts.push({ id, code: code || null, caption: caption || null, username: norm, taken_at, play_count: play, like_count: like, comment_count: comment });
    }

    if (allowUsernameFallback && upserts.length === 0 && linksMap.size > 0) {
      const urls = [
        `https://www.instagram.com/${norm}/reels/`,
        `https://www.instagram.com/${norm}/reels`,
        `https://www.instagram.com/${norm}/`
      ];
      let arr: any[] = [];
      for (const p of urls) {
        const tmp = await fetchLinksData(p);
        if (Array.isArray(tmp) && tmp.length) { 
          arr = tmp; 
          break; 
        }
      }
      for (const it of arr) {
        const sc = String(it?.shortcode || it?.meta?.shortcode || '');
        const ts = parseMs(it?.takenAt || it?.meta?.takenAt);
        if (!sc || !ts) continue;
        let views = Number(it?.playCount || it?.viewCount || 0) || 0;
        let likes = Number(it?.likeCount || 0) || 0;
        let comments = Number(it?.commentCount || 0) || 0;
        if ((views + likes + comments) === 0) {
          const counts = await resolveCounts({ code: sc }, { code: sc }, IG_HOST);
          if (counts) { 
            views = counts.play; 
            likes = counts.like; 
            comments = counts.comment; 
          }
        }
        if ((views + likes + comments) === 0) continue;
        // Always set taken_at - use NOW() as fallback if ts is NULL
        const taken_at = ts ? new Date(ts).toISOString() : new Date().toISOString();
        upserts.push({ id: sc, code: sc, caption: null, username: norm, taken_at, play_count: views, like_count: likes, comment_count: comments });
        telemetry.fallbackLinksUsed += 1;
      }
    }

    if (allowUsernameFallback && upserts.length === 0) {
      const urls = [`https://www.instagram.com/${norm}/`, `https://instagram.com/${norm}/`];
      let arr: any[] = [];
      for (const p of urls) {
        const tmp = await fetchLinksData(p);
        if (Array.isArray(tmp) && tmp.length) { 
          arr = tmp; 
          break; 
        }
      }
      for (const it of arr) {
        const sc = String(it?.shortcode || it?.meta?.shortcode || ''); 
        if (!sc) continue;
        let ms = parseMs(it?.takenAt || it?.meta?.takenAt) || null;
        
        if (!ms) {
          try {
            const info = await rapidApiRequest<any>({ 
              url: `https://${IG_HOST}/api/instagram/post_info?code=${encodeURIComponent(sc)}`, 
              method: 'GET', 
              rapidApiHost: IG_HOST, 
              timeoutMs: 15000 
            });
            const m = info?.result?.items?.[0] || info?.result?.media || info?.result || info?.item || info;
            ms = parseMs(m?.taken_at) || parseMs(m?.taken_at_ms) || null;
            const caption = extractCaption(m);
            let views = Number(m?.play_count || m?.view_count || m?.video_view_count || 0) || 0;
            let likes = Number(m?.like_count || m?.edge_liked_by?.count || 0) || 0;
            let comments = Number(m?.comment_count || m?.edge_media_to_comment?.count || 0) || 0;
            if ((views + likes + comments) === 0) {
              const counts = await resolveCounts({ code: sc }, { code: sc }, IG_HOST);
              if (counts) { 
                views = counts.play; 
                likes = counts.like; 
                comments = counts.comment; 
              }
            }
            if (ms && (views + likes + comments) > 0) {
              // Always set taken_at - use NOW() as fallback if ms is NULL
              const taken_at = ms ? new Date(ms).toISOString() : new Date().toISOString();
              upserts.push({ 
                id: sc, 
                code: sc,
                caption: caption || null,
                username: norm, 
                taken_at,
                play_count: views, 
                like_count: likes, 
                comment_count: comments 
              });
            }
          } catch {}
        } else {
          let views = Number(it?.playCount || it?.viewCount || 0) || 0;
          let likes = Number(it?.likeCount || 0) || 0;
          let comments = Number(it?.commentCount || 0) || 0;
          if ((views + likes + comments) === 0) {
            const counts = await resolveCounts({ code: sc }, { code: sc }, IG_HOST);
            if (counts) { 
              views = counts.play; 
              likes = counts.like; 
              comments = counts.comment; 
            }
          }
          if ((views + likes + comments) === 0) continue;
          // Always set taken_at - use NOW() as fallback if ms is NULL
          const taken_at = ms ? new Date(ms).toISOString() : new Date().toISOString();
          upserts.push({ id: sc, code: sc, caption: null, username: norm, taken_at, play_count: views, like_count: likes, comment_count: comments });
        }
      }
    }

    if (upserts.length === 0) {
      const userId2 = userId || await resolveUserId(norm, supa);
      if (userId2) {
        const sj = await rapidApiRequest<any>({ 
          url: `https://${IG_SCRAPER_HOST}/get_instagram_reels_details_from_id?user_id=${encodeURIComponent(userId2)}`, 
          method: 'GET', 
          rapidApiHost: IG_SCRAPER_HOST, 
          timeoutMs: 20000 
        });
        const reels: any[] = (sj?.data?.reels || sj?.reels || sj?.data?.items || sj?.items || []) as any[];
        for (const it of reels) {
          const id = String(it?.id || it?.code || ''); 
          if (!id) continue;
          const ms = parseMs(it?.taken_at) || parseMs(it?.device_timestamp) || null; 
          if (!ms) continue;
          let play = Number(it?.play_count ?? it?.ig_play_count ?? 0) || 0;
          let like = Number(it?.like_count ?? 0) || 0;
          let comment = Number(it?.comment_count ?? 0) || 0;
          if ((play + like + comment) === 0) {
            const counts = await resolveCounts({ id, code: it?.code }, { id, code: it?.code }, IG_HOST);
            if (counts) { 
              play = counts.play; 
              like = counts.like; 
              comment = counts.comment; 
            }
          }
          if ((play + like + comment) === 0) continue;
          const code = String(it?.code || '');
          const caption = extractCaption(it);
          // Always set taken_at - use NOW() as fallback if ms is NULL
          const taken_at = ms ? new Date(ms).toISOString() : new Date().toISOString();
          upserts.push({ id, code: code || null, caption: caption || null, username: norm, taken_at, play_count: play, like_count: like, comment_count: comment });
        }
        if (upserts.length > 0) source = 'scraper:user_id';
      }
    }

    console.log(`[Instagram] Attempting to save ${upserts.length} posts to instagram_posts_daily for ${norm}`);
    
    if (upserts.length) {
      if (cleanup === 'today') {
        const todayStart = new Date().toISOString().slice(0,10) + 'T00:00:00Z';
        const todayEnd = new Date().toISOString().slice(0,10) + 'T23:59:59Z';
        try { 
          const { error: delError } = await supa.from('instagram_posts_daily').delete().eq('username', norm).gte('taken_at', todayStart).lte('taken_at', todayEnd);
          if (delError) {
            console.error('[Instagram] Failed to cleanup today\'s data:', delError.message);
          } else {
            console.log('[Instagram] Cleaned up today\'s data before upsert');
          }
        } catch (e: any) {
          console.error('[Instagram] Cleanup error:', e.message);
        }
      }
      
      // MERGE with existing DB data: preserve taken_at/caption/code if already in DB
      const mergedUpserts = await mergeWithExisting(supa, upserts);
      console.log(`[Instagram] Merged ${mergedUpserts.length} records (preserved existing DB values for protected fields)`);

      // Group by column set so each PostgREST batch has consistent columns.
      const upsertGroups = new Map<string, any[]>();
      for (const r of mergedUpserts) {
        const clean: any = {};
        for (const [k, v] of Object.entries(r)) {
          if ((k === 'taken_at' || k === 'post_date' || k === 'caption' || k === 'code') && (v === null || v === undefined || v === '')) continue;
          clean[k] = v;
        }
        const key = Object.keys(clean).sort().join(',');
        if (!upsertGroups.has(key)) upsertGroups.set(key, []);
        upsertGroups.get(key)!.push(clean);
      }
      const chunk = 500;
      let totalSaved = 0;
      let totalErrors = 0;

      for (const batch of upsertGroups.values()) {
        for (let i=0; i<batch.length; i+=chunk) {
          const part = batch.slice(i, i+chunk);
          const { error: upsertError } = await supa.from('instagram_posts_daily').upsert(part, { onConflict: 'id' });

          if (upsertError) {
            console.error(`[Instagram] ❌ FAILED to upsert chunk:`, {
              error: upsertError.message,
              code: upsertError.code,
              details: upsertError.details,
              hint: upsertError.hint,
              username: norm,
              chunk_size: part.length,
            });
            totalErrors += part.length;
          } else {
            totalSaved += part.length;
          }
        }
      }

      console.log(`[Instagram] Save summary for ${norm}: ✅ ${totalSaved} saved, ❌ ${totalErrors} failed out of ${upserts.length} total`);
    }

    const totals = upserts.reduce((a, r)=>({
      views: a.views + (r.play_count||0),
      likes: a.likes + (r.like_count||0),
      comments: a.comments + (r.comment_count||0),
      posts_total: a.posts_total + 1,
    }), { views:0, likes:0, comments:0, posts_total:0 });

    const allowCreateUser = (process.env.FETCH_IG_CREATE_USER === '1') || (url.searchParams.get('create') === '1');
    let ownerUserId: string | null = null;
    
    const { data: u1 } = await supa.from('users').select('id').eq('instagram_username', norm).maybeSingle();
    if (u1?.id) ownerUserId = u1.id;
    
    if (!ownerUserId) {
      const { data: u2 } = await supa.from('user_instagram_usernames').select('user_id').eq('instagram_username', norm).maybeSingle();
      if (u2?.user_id) ownerUserId = u2.user_id as string;
    }
    
    if (!ownerUserId) {
      const { data: emp } = await supa.from('employee_instagram_participants').select('employee_id').eq('instagram_username', norm).limit(1);
      if (emp && emp.length > 0 && emp[0].employee_id) ownerUserId = emp[0].employee_id as string;
    }
    
    if (!ownerUserId && allowCreateUser) {
      const newId = randomUUID();
      // CRITICAL: Only set instagram_username, do NOT overwrite username field
      // username field should remain NULL for auto-created accounts
      const { error: upErr } = await supa.from('users').upsert({ 
        id: newId, 
        email: `${norm}@example.com`, 
        role: 'umum', 
        instagram_username: norm 
      }, { onConflict: 'id' });
      if (!upErr) ownerUserId = newId;
    }

    let metricsInserted = false;
    let metricsError: string | null = null;
    let aggregatedMetrics: any = null;
    
    if (ownerUserId) {
      try {
        const handles = new Set<string>();
        handles.add(norm);
        
        const { data: u1 } = await supa.from('users').select('instagram_username').eq('id', ownerUserId).maybeSingle();
        if (u1?.instagram_username) handles.add(String(u1.instagram_username).replace(/^@/, '').toLowerCase());
        
        const { data: u2 } = await supa.from('user_instagram_usernames').select('instagram_username').eq('user_id', ownerUserId);
        for (const r of u2||[]) handles.add(String((r as any).instagram_username).replace(/^@/, '').toLowerCase());
        
        const { data: u3 } = await supa.from('employee_instagram_participants').select('instagram_username').eq('employee_id', ownerUserId);
        for (const r of u3||[]) handles.add(String((r as any).instagram_username).replace(/^@/, '').toLowerCase());
        
        if (handles.size > 0) {
          const all = Array.from(handles);
          const winDays = 60;
          const start = new Date();
          start.setUTCDate(start.getUTCDate()-winDays+1);
          const startISO = start.toISOString().slice(0,10);
          
          const { data: rows } = await supa
            .from('instagram_posts_daily')
            .select('play_count, like_count, comment_count, username, taken_at')
            .in('username', all)
            .gte('taken_at', startISO + 'T00:00:00Z');
            
          const agg = (rows||[]).reduce((a:any,r:any)=>({
            views: a.views + (Number(r.play_count)||0),
            likes: a.likes + (Number(r.like_count)||0),
            comments: a.comments + (Number(r.comment_count)||0),
          }), { views:0, likes:0, comments:0 });
          
          aggregatedMetrics = { ...agg, handles: all, postsCount: rows?.length || 0 };
          const nowIso = new Date().toISOString();
          
          await supa.from('social_metrics').upsert({
            user_id: ownerUserId,
            platform: 'instagram',
            followers: 0,
            likes: agg.likes,
            views: agg.views,
            comments: agg.comments,
            shares: 0,
            saves: 0,
            last_updated: nowIso,
          }, { onConflict: 'user_id,platform' });
          
          await supa.from('social_metrics_history').insert({
            user_id: ownerUserId,
            platform: 'instagram',
            followers: 0,
            likes: agg.likes,
            views: agg.views,
            comments: agg.comments,
            shares: 0,
            saves: 0,
            captured_at: nowIso,
          });
          
          metricsInserted = true;
        }
      } catch (e) {
        metricsError = (e as any)?.message || String(e);
        console.warn('[fetch-ig] social_metrics upsert failed:', metricsError);
      }
    }

    return NextResponse.json({ 
      instagram: totals, 
      inserted: upserts.length, 
      user_id: userId, 
      owner_user_id: ownerUserId,
      metrics_inserted: metricsInserted,
      metrics_error: metricsError,
      aggregated: debug ? aggregatedMetrics : undefined,
      source, 
      telemetry: debug ? telemetry : undefined 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
