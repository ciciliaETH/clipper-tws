import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes - refreshes all campaign participants

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function ensureAdmin() {
  const supabase = await createSSR();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin';
}

export async function POST(req: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabaseAdmin = adminClient();
    const { id } = await context.params;
    // Optional override of campaign window via request body
    const body = await req.json().catch(() => ({} as any));

    let { data: parts, error } = await supabaseAdmin
      .from('campaign_participants')
      .select('tiktok_username')
      .eq('campaign_id', id);
    if (error) throw error;

    // Auto-seed participants from employee assignments if empty
    if (!parts || parts.length === 0) {
      const { data: ep } = await supabaseAdmin
        .from('employee_participants')
        .select('tiktok_username')
        .eq('campaign_id', id);
      const usernames = Array.from(new Set((ep || []).map((r:any)=> String(r.tiktok_username).toLowerCase())));
      if (usernames.length) {
        const toInsert = usernames.map(u => ({ campaign_id: id, tiktok_username: u }));
        await supabaseAdmin.from('campaign_participants').upsert(toInsert, { onConflict: 'campaign_id,tiktok_username', ignoreDuplicates: true });
        const { data: parts2 } = await supabaseAdmin
          .from('campaign_participants')
          .select('tiktok_username')
          .eq('campaign_id', id);
        parts = parts2 || [];
      }
    }

    // Derive base URL from the incoming request instead of hardcoding localhost port
    const { protocol, host } = new URL(req.url);
    const baseUrl = `${protocol}//${host}`;

    // Get campaign window to pass to fetch-metrics so it only upserts posts within the campaign period
    const { data: campaign, error: cErr } = await supabaseAdmin
      .from('campaigns')
      .select('start_date, end_date')
      .eq('id', id)
      .single();
    if (cErr || !campaign) throw cErr || new Error('Campaign not found');
    const startStr = String(body?.start || campaign.start_date); // YYYY-MM-DD
    const endStr = String(body?.end || campaign.end_date || new Date().toISOString().slice(0,10));

  const usernames = (parts || []).map(p => p.tiktok_username);
  // Build canonical map: normalize '@' and case to find exact stored username
  const canonical = new Map<string,string>();
  for (const p of (parts || [])) {
    const orig = String(p.tiktok_username || '').trim();
    const norm = orig.replace(/^@/, '').toLowerCase();
    if (norm) {
      canonical.set(norm, orig);
      canonical.set('@' + norm, orig);
    }
  }
  const DB_ONLY = (process.env.CAMPAIGN_REFRESH_DB_ONLY || '1') === '1';

  // Helper: collect IG handles relevant to this campaign from multiple sources
  const collectIgHandles = async (): Promise<string[]> => {
    const set = new Set<string>();
    try {
      const { data: igParts } = await supabaseAdmin
        .from('campaign_instagram_participants')
        .select('instagram_username')
        .eq('campaign_id', id);
      for (const r of igParts || []) set.add(String((r as any).instagram_username||'').replace(/^@+/, '').toLowerCase());
    } catch {}
    try {
      const { data: empIg } = await supabaseAdmin
        .from('employee_instagram_participants')
        .select('instagram_username')
        .eq('campaign_id', id);
      for (const r of empIg || []) set.add(String((r as any).instagram_username||'').replace(/^@+/, '').toLowerCase());
    } catch {}
    try {
      // From employees in this campaign via employee_groups
      const { data: eg } = await supabaseAdmin
        .from('employee_groups')
        .select('employee_id')
        .eq('campaign_id', id);
      const empIds = Array.from(new Set((eg||[]).map((r:any)=> String(r.employee_id))));
      if (empIds.length) {
        const { data: map } = await supabaseAdmin
          .from('user_instagram_usernames')
          .select('instagram_username, user_id')
          .in('user_id', empIds);
        for (const r of map || []) set.add(String((r as any).instagram_username||'').replace(/^@+/, '').toLowerCase());
        const { data: usersIG } = await supabaseAdmin
          .from('users')
          .select('instagram_username, id')
          .in('id', empIds);
        for (const u of usersIG || []) if ((u as any).instagram_username) set.add(String((u as any).instagram_username).replace(/^@+/, '').toLowerCase());
      }
    } catch {}
    const list = Array.from(set).filter(Boolean);
    // Ensure mapping rows exist for these handles
    if (list.length) {
      try {
        const rows = list.map(u => ({ campaign_id: id, instagram_username: u }));
        await supabaseAdmin.from('campaign_instagram_participants').upsert(rows, { onConflict: 'campaign_id,instagram_username', ignoreDuplicates: true });
      } catch {}
    }
    return list;
  };

  // Before snapshots: fetch latest IG posts for derived handles (best-effort)
  const fetchIgForCampaign = async () => {
    const handles = await collectIgHandles();
    if (!handles.length) return { fetched: 0 };
    const { protocol, host } = new URL(req.url);
    const baseUrl = `${protocol}//${host}`;
    const limit = Math.max(1, Math.min(8, Number(process.env.CAMPAIGN_REFRESH_IG_CONCURRENCY || '6')));
    const tasks: Promise<any>[] = [];
    const run = async (h: string) => {
      try {
        const u = new URL(`${baseUrl}/api/fetch-ig/${encodeURIComponent(h)}`);
        u.searchParams.set('create', '0');
        const r = await fetch(u.toString(), { cache: 'no-store' });
        await r.json().catch(()=>({}));
      } catch {}
    };
    for (let i=0;i<handles.length;i+=limit) {
      const batch = handles.slice(i, i+limit);
      await Promise.all(batch.map(run));
    }
    return { fetched: handles.length };
  };

  if (DB_ONLY) {
    // Try to fetch IG updates first, then compute snapshots purely from DB
    try { await fetchIgForCampaign(); } catch {}
    // Refresh snapshot murni dari DB (tiktok_posts_daily) tanpa call external API
    const results: any[] = [];
    // TikTok participants
    for (const u of usernames) {
      const norm = String(u).replace(/^@/, '').toLowerCase();
      // Aggregate metrics from DB for campaign window
      const { data: rows } = await supabaseAdmin
        .from('tiktok_posts_daily')
        .select('play_count, digg_count, comment_count, share_count, save_count, sec_uid')
        .eq('username', norm)
        .gte('post_date', startStr)
        .lte('post_date', endStr);
      let views = 0, likes = 0, comments = 0, shares = 0, saves = 0; let sec_uid: string | null = null;
      for (const r of rows || []) {
        views += Number(r.play_count)||0; likes += Number(r.digg_count)||0; comments += Number(r.comment_count)||0; shares += Number(r.share_count)||0; saves += Number(r.save_count)||0;
        if (!sec_uid && r.sec_uid) sec_uid = r.sec_uid as any;
      }
      // Keep existing followers if any
      let followers = 0;
      try {
        const { data: cp } = await supabaseAdmin
          .from('campaign_participants')
          .select('followers')
          .eq('campaign_id', id)
          .eq('tiktok_username', canonical.get(norm) || canonical.get('@'+norm) || String(u))
          .single();
        followers = Number(cp?.followers)||0;
      } catch {}
      const target = canonical.get(norm) || canonical.get('@'+norm) || String(u);
      await supabaseAdmin
        .from('campaign_participants')
        .upsert({
          campaign_id: id,
          tiktok_username: target,
          followers,
          views, likes, comments, shares, saves,
          posts_total: (rows||[]).length,
          sec_uid,
          metrics_json: { mode: 'db-only', window: { start: startStr, end: endStr } },
          last_refreshed: new Date().toISOString(),
        }, { onConflict: 'campaign_id,tiktok_username' });
      results.push({ username: u, ok: true, status: 200, data: { mode: 'db-only' } });
    }

    // Instagram participants snapshot (from DB)
    try {
      const { data: igParts } = await supabaseAdmin
        .from('campaign_instagram_participants')
        .select('instagram_username')
        .eq('campaign_id', id);
      const igUsernames = (igParts || []).map((r:any)=> String(r.instagram_username).replace(/^@/, '').toLowerCase()).filter(Boolean);
      for (const ig of igUsernames) {
        const { data: rows } = await supabaseAdmin
          .from('instagram_posts_daily')
          .select('play_count, like_count, comment_count')
          .eq('username', ig)
          .gte('post_date', startStr)
          .lte('post_date', endStr);
        let views=0, likes=0, comments=0;
        for (const r of rows||[]) { views+=Number((r as any).play_count)||0; likes+=Number((r as any).like_count)||0; comments+=Number((r as any).comment_count)||0; }
        await supabaseAdmin
          .from('campaign_instagram_participants')
          .update({
            views, likes, comments,
            posts_total: (rows||[]).length,
            metrics_json: { mode:'db-only', window: { start: startStr, end: endStr } },
            last_refreshed: new Date().toISOString(),
          })
          .eq('campaign_id', id)
          .eq('instagram_username', ig);
      }
    } catch (e) {
      console.warn('[campaign refresh] IG snapshot failed:', (e as any)?.message || e);
    }
    return NextResponse.json({ updated: results.length, results });
  }

    // External mode (call fetch-metrics per user) — fallback if explicitly configured
    // Concurrency/timeout can be tuned via env
    const limit = Number(process.env.CAMPAIGN_REFRESH_CONCURRENCY || '4');
    const timeoutMs = Number(process.env.CAMPAIGN_REFRESH_TIMEOUT_MS || '60000');
    const maxRetries = Number(process.env.CAMPAIGN_REFRESH_RETRIES || '2');
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
    const results: any[] = [];
    for (let i = 0; i < usernames.length; i += limit) {
      const chunk = usernames.slice(i, i + limit);
      const settled = await Promise.allSettled(chunk.map(async (u) => {
        let lastErr: any = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(`${baseUrl}/api/fetch-metrics/${encodeURIComponent(String(u).replace(/^@/, ''))}?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`, { signal: controller.signal });
            const json = await res.json().catch(() => ({}));
            if (res.ok) {
              if (json?.tiktok) {
                const t = json.tiktok;
                const norm = String(u).replace(/^@/, '').toLowerCase();
                const target = canonical.get(norm) || canonical.get('@'+norm) || String(u);
                await supabaseAdmin
                  .from('campaign_participants')
                  .upsert({
                    campaign_id: id,
                    tiktok_username: target,
                    followers: Number(t.followers) || 0,
                    views: Number(t.views) || 0,
                    likes: Number(t.likes) || 0,
                    comments: Number(t.comments) || 0,
                    shares: Number(t.shares) || 0,
                    saves: Number(t.saves) || 0,
                    posts_total: Number(t.posts_total) || 0,
                    sec_uid: t.secUid || t.sec_uid || null,
                    metrics_json: json,
                    last_refreshed: new Date().toISOString(),
                  }, { onConflict: 'campaign_id,tiktok_username' });
              }
              clearTimeout(timeout);
              return { username: u, ok: true, status: res.status, data: json };
            }
            // Retry on 429/5xx
            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
              lastErr = new Error(`HTTP ${res.status}`);
            } else {
              clearTimeout(timeout);
              return { username: u, ok: false, status: res.status, data: json };
            }
          } catch (err: any) {
            lastErr = err;
          }
          finally {}
          clearTimeout(timeout);
          if (attempt < maxRetries) await sleep(1500 * (attempt + 1));
        }
        return { username: u, ok: false, error: String(lastErr || 'unknown') };
      }));
      for (const s of settled) {
        if (s.status === 'fulfilled') results.push(s.value);
        else results.push({ ok: false, error: String(s.reason) });
      }
    }

    // After external TikTok refresh, also refresh IG data then update Instagram snapshot from DB
    try { await fetchIgForCampaign(); } catch {}
    try {
      const { data: igParts } = await supabaseAdmin
        .from('campaign_instagram_participants')
        .select('instagram_username')
        .eq('campaign_id', id);
      const igUsernames = (igParts || []).map((r:any)=> String(r.instagram_username).replace(/^@/, '').toLowerCase()).filter(Boolean);
      for (const ig of igUsernames) {
        const { data: rows } = await supabaseAdmin
          .from('instagram_posts_daily')
          .select('play_count, like_count, comment_count')
          .eq('username', ig)
          .gte('post_date', startStr)
          .lte('post_date', endStr);
        let views=0, likes=0, comments=0;
        for (const r of rows||[]) { views+=Number((r as any).play_count)||0; likes+=Number((r as any).like_count)||0; comments+=Number((r as any).comment_count)||0; }
        await supabaseAdmin
          .from('campaign_instagram_participants')
          .update({
            views, likes, comments,
            posts_total: (rows||[]).length,
            metrics_json: { mode:'db', source:'instagram_posts_daily', window: { start: startStr, end: endStr } },
            last_refreshed: new Date().toISOString(),
          })
          .eq('campaign_id', id)
          .eq('instagram_username', ig);
      }
    } catch (e) {
      console.warn('[campaign refresh] IG snapshot (external mode) failed:', (e as any)?.message || e);
    }
    return NextResponse.json({ updated: results.length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
