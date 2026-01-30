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

function getRandomKey() {
  const keys = (process.env.RAPID_API_KEYS || process.env.RAPIDAPI_KEYS || process.env.RAPID_KEY_BACKFILL || process.env.RAPIDAPI_KEY || '').split(',').map(s=>s.trim()).filter(Boolean);
  if (!keys.length) throw new Error('No RapidAPI key');
  return keys[Math.floor(Math.random()*keys.length)];
}

async function rapidJson(url: string, host: string, timeoutMs = 15000) {
  const key = getRandomKey();
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host, 'accept': 'application/json' }, signal: controller.signal });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${txt.slice(0,200)}`);
    try { return JSON.parse(txt); } catch { return txt; }
  } finally { clearTimeout(id); }
}

// POST request for instagram-media-api.p.rapidapi.com
async function rapidPostJson(url: string, host: string, body: object, timeoutMs = 15000) {
  const key = getRandomKey();
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { 
      method: 'POST',
      headers: { 
        'x-rapidapi-key': key, 
        'x-rapidapi-host': host, 
        'Content-Type': 'application/json',
        'accept': 'application/json' 
      }, 
      body: JSON.stringify(body),
      signal: controller.signal 
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${txt.slice(0,200)}`);
    try { return JSON.parse(txt); } catch { return txt; }
  } finally { clearTimeout(id); }
}

export async function POST(req: Request) {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const supa = adminClient();
    const body = await req.json().catch(()=>({}));
    
    // Auto-loop mode: process all accounts in batches of 5
    const batchSize = 5;
    const maxExecutionTime = 55000; // 55s max (leave 5s buffer for Vercel 60s limit)
    const doFetch = body?.fetch === true;
    const force = body?.force === true;
    const debug = body?.debug === true;
    const startTime = Date.now();

    // Collect IG usernames from multiple sources
    const set = new Set<string>();
    const norm = (u:any)=> String(u||'').trim().replace(/^@+/, '').toLowerCase();
    const sourceCounts: Record<string, number> = {};
    
    try { 
      const { data } = await supa.from('campaign_instagram_participants').select('instagram_username'); 
      for (const r of data||[]) if (r.instagram_username) set.add(norm(r.instagram_username)); 
      sourceCounts.campaign_instagram_participants = (data||[]).length; 
    } catch {}
    
    try { 
      const { data } = await supa.from('employee_instagram_participants').select('instagram_username'); 
      for (const r of data||[]) if (r.instagram_username) set.add(norm(r.instagram_username)); 
      sourceCounts.employee_instagram_participants = (data||[]).length; 
    } catch {}
    
    try { 
      const { data } = await supa.from('user_instagram_usernames').select('instagram_username'); 
      for (const r of data||[]) if (r.instagram_username) set.add(norm(r.instagram_username)); 
      sourceCounts.user_instagram_usernames = (data||[]).length; 
    } catch {}
    
    try { 
      const { data } = await supa.from('users').select('instagram_username').not('instagram_username','is',null); 
      for (const r of data||[]) if ((r as any).instagram_username) set.add(norm((r as any).instagram_username)); 
      sourceCounts.users = (data||[]).length; 
    } catch {}

    let all = Array.from(set).filter(Boolean);
    
    // Filter out already resolved unless force=true
    if (!force) {
      const { data: cached } = await supa.from('instagram_user_ids').select('instagram_username');
      const cachedSet = new Set((cached || []).map(r => norm(r.instagram_username)));
      all = all.filter(u => !cachedSet.has(u));
    }
    
    const totalPending = all.length;
    
    if (!totalPending) return NextResponse.json({ 
      resolved: 0, 
      fetched: 0, 
      users: 0, 
      remaining: 0,
      batches: 0,
      message: 'All usernames already resolved!',
      results: [] 
    });

    const host = process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram120.p.rapidapi.com';
    const scraper = process.env.RAPIDAPI_IG_SCRAPER_HOST || 'instagram-scraper-api11.p.rapidapi.com';
    const mediaApi = 'instagram-media-api.p.rapidapi.com'; // Primary API for user ID resolution

    // Aggregate results across all batches
    const allResults: any[] = [];
    const allResolved: Array<{username:string; user_id:string}> = [];
    const allFailures: Array<{username:string; reason:string}> = [];
    let batchCount = 0;
    let processedCount = 0;

    const resolveUserId = async (username: string): Promise<string|undefined> => {
      const u = norm(username);
      
      // Validate username format
      if (!u || u.length < 1 || u.length > 30) {
        console.log(`[Resolve IG] ❌ ${u} invalid username format (length)`);
        return undefined;
      }
      
      // Check cache first
      if (!force) {
        const { data: c } = await supa.from('instagram_user_ids').select('instagram_user_id').eq('instagram_username', u).maybeSingle();
        if (c?.instagram_user_id) {
          console.log(`[Resolve IG] ✅ ${u} found in cache: ${c.instagram_user_id}`);
          return String(c.instagram_user_id);
        }
      }
      
      // Enhanced multi-provider resolution with retry logic
      const providers = [
        // Provider 1: instagram-media-api.p.rapidapi.com (PRIMARY - as specified by user)
        {
          name: 'media_api',
          fn: async () => {
            try {
              const j = await rapidPostJson(
                `https://${mediaApi}/user/id`,
                mediaApi,
                { username: u, proxy: '' },
                6000 // Reduced from 12s to 6s for faster failure detection
              );
              if (debug) console.log(`[Resolve IG] ${u} media_api response:`, JSON.stringify(j).slice(0, 500));
              // Response format: { id: "123456789", username: "dailysuli" }
              return j?.id || j?.user_id || j?.pk;
            } catch (err: any) {
              if (debug) console.log(`[Resolve IG] ${u} media_api error:`, err?.message);
              throw err;
            }
          }
        },
        // Provider 2: Scraper link endpoint (fallback)
        {
          name: 'scraper_link',
          fn: async () => {
            try {
              const j = await rapidJson(`https://${scraper}/get_instagram_user_id?link=${encodeURIComponent('https://www.instagram.com/'+u)}`, scraper, 5000); // Reduced from 10s to 5s
              if (debug) console.log(`[Resolve IG] ${u} scraper_link response:`, JSON.stringify(j).slice(0, 500));
              return j?.user_id || j?.id || j?.data?.user_id || j?.data?.id;
            } catch (err: any) {
              if (debug) console.log(`[Resolve IG] ${u} scraper_link error:`, err?.message);
              throw err;
            }
          }
        },
      ];
      
      // Try each provider (no retry to save time)
      for (const provider of providers) {
        try {
          const id = await provider.fn();
          if (id) {
            if (debug) console.log(`[Resolve IG] ${u} → ${id} via ${provider.name}`);
            return String(id);
          }
        } catch (e) {
          if (debug) console.log(`[Resolve IG] ${u} failed on ${provider.name}:`, e);
        }
      }
      
      return undefined;
    };

    // Derive base URL for internal calls
    const { protocol, host: reqHost } = new URL(req.url);
    const base = `${protocol}//${reqHost}`;

    // AUTO-LOOP: Process in batches of 5 until done or timeout
    while (processedCount < all.length) {
      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > maxExecutionTime) {
        console.log(`[Resolve IG] Timeout approaching, stopping after ${processedCount}/${all.length} accounts`);
        break;
      }

      batchCount++;
      const batch = all.slice(processedCount, processedCount + batchSize);
      console.log(`[Resolve IG] Batch ${batchCount}: Processing ${batch.length} accounts (${processedCount}/${all.length} done)`);

      // Process each username in current batch
      for (let i = 0; i < batch.length; i++) {
        const u = batch[i];
        const startResolve = Date.now();
        try {
          console.log(`[Resolve IG] Attempting ${u}...`);
          const id = await resolveUserId(u);
          const elapsed = Date.now() - startResolve;
          
          if (id) {
            console.log(`[Resolve IG] ✅ ${u} → ${id} (${elapsed}ms)`);
            await supa.from('instagram_user_ids').upsert({ 
              instagram_username: u, 
              instagram_user_id: id, 
              created_at: new Date().toISOString() 
            }, { onConflict: 'instagram_username' });
            allResolved.push({ username: u, user_id: id });
            allResults.push({ username: u, ok: true, user_id: id });
          } else {
            console.log(`[Resolve IG] ❌ ${u} not found via RapidAPI (${elapsed}ms)`);
            // SKIP fetch-ig fallback - too slow! Just mark as not-found
            allFailures.push({ username: u, reason: 'not-found-rapidapi' });
            allResults.push({ username: u, ok: false, error: 'not-found-rapidapi' });
          }
        } catch (e:any) {
          const elapsed = Date.now() - startResolve;
          console.log(`[Resolve IG] ❌ ${u} error: ${e?.message} (${elapsed}ms)`);
          allFailures.push({ username: u, reason: String(e?.message||e) });
          allResults.push({ username: u, ok: false, error: String(e?.message||e) });
        }
        
        // Add delay between requests to avoid rate limits
        if (i < batch.length - 1) {
          await new Promise(r => setTimeout(r, 200)); // 200ms delay (faster)
        }
      }

      processedCount += batch.length;

      // Delay between batches
      if (processedCount < all.length) {
        await new Promise(r => setTimeout(r, 500)); // 500ms delay between batches (faster)
      }
    }

    const remaining = totalPending - processedCount;

    // Optionally fetch posts for resolved accounts (skip for now to save time)
    let fetched = 0;
    // if (doFetch && allResolved.length) { ... }

    return NextResponse.json({ 
      users: processedCount, 
      resolved: allResolved.length, 
      fetched, 
      failures: allFailures.length,
      remaining,
      batches: batchCount,
      total_pending: totalPending,
      execution_time_ms: Date.now() - startTime,
      success_rate: processedCount > 0 ? Math.round((allResolved.length / processedCount) * 100) : 0,
      message: remaining > 0
        ? `Processed ${processedCount}/${totalPending} accounts in ${batchCount} batches. ${remaining} remaining (timeout). Call again to continue.`
        : allFailures.length > 0 
          ? `Resolved ${allResolved.length} of ${processedCount} users in ${batchCount} batches. ${allFailures.length} failures.`
          : `Successfully resolved all ${allResolved.length} users in ${batchCount} batches! ✅`,
      sources: debug ? sourceCounts : undefined, 
      results: allResults, // All results from all batches
      failures_detail: allFailures
    });
  } catch (e:any) {
    console.error('[Resolve IG User IDs] Error:', e);
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
