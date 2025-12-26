import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rapidApiRequest } from '@/lib/rapidapi';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes - multi-provider resolution with retries

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const IG_HOST = process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram-media-api.p.rapidapi.com';
const IG_SCRAPER_HOST = process.env.RAPIDAPI_IG_SCRAPER_HOST || 'instagram-scraper-api11.p.rapidapi.com';

async function asyncPool<T, R>(items: T[], limit: number, worker: (t: T, idx: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = [];
  const executing: Promise<void>[] = [];
  let i = 0;
  const enqueue = () => {
    if (i >= items.length) return;
    const idx = i++;
    const p = worker(items[idx], idx)
      .then((r) => { ret[idx] = r as any; })
      .catch((e) => { (ret as any)[idx] = { error: String(e?.message || e) }; })
      .then(() => { const pos = executing.indexOf(p as any); if (pos >= 0) executing.splice(pos, 1); }) as any;
    executing.push(p as any);
    if (executing.length < limit) enqueue();
  };
  for (let k = 0; k < Math.min(limit, items.length); k++) enqueue();
  await Promise.all(executing);
  while (i < items.length) { enqueue(); await Promise.race(executing); }
  await Promise.all(executing);
  return ret;
}

export async function POST(req: NextRequest) {
  try {
    const supa = adminClient();
    const body = await req.json().catch(() => ({}));
    const concurrency = Number(body?.concurrency || 3);

    // Get all usernames from employee_instagram_participants that are NULL or missing in instagram_user_ids
    const { data: allUsernames } = await supa
      .from('employee_instagram_participants')
      .select('instagram_username');
    
    const uniqueUsernames = new Set<string>();
    for (const r of allUsernames || []) {
      if (r.instagram_username) {
        uniqueUsernames.add(String(r.instagram_username).replace(/^@/, '').toLowerCase());
      }
    }

    // Check which ones are missing or NULL in instagram_user_ids
    const needResolve: string[] = [];
    for (const username of Array.from(uniqueUsernames)) {
      const { data: cached } = await supa
        .from('instagram_user_ids')
        .select('instagram_user_id')
        .eq('instagram_username', username)
        .maybeSingle();
      
      if (!cached || !cached.instagram_user_id) {
        needResolve.push(username);
      }
    }

    if (needResolve.length === 0) {
      return NextResponse.json({ 
        message: 'All usernames already resolved', 
        total: uniqueUsernames.size, 
        resolved: uniqueUsernames.size 
      });
    }

    // Resolve each username
    const resolveOne = async (username: string) => {
      const norm = String(username).replace(/^@/, '').toLowerCase();
      
      // 1) Primary method: scraper link endpoint
      try {
        const link = encodeURIComponent(`https://www.instagram.com/${norm}`);
        const url = `https://${IG_SCRAPER_HOST}/get_instagram_user_id?link=${link}`;
        const j = await rapidApiRequest<any>({ 
          url, 
          method: 'GET', 
          rapidApiHost: IG_SCRAPER_HOST, 
          timeoutMs: 20000, 
          maxPerKeyRetries: 3 
        });
        const userId = String(j?.user_id || j?.id || j?.data?.user_id || j?.data?.id || '') || undefined;
        if (userId) {
          await supa.from('instagram_user_ids').upsert({ 
            instagram_username: norm, 
            instagram_user_id: userId, 
            created_at: new Date().toISOString() 
          }, { onConflict: 'instagram_username' });
          return { username: norm, success: true, user_id: userId, method: 'scraper_link' };
        }
      } catch (e: any) {
        // Continue to fallbacks
      }

      // 2) Primary host fallback endpoints
      const infoEndpoints = [
        `https://${IG_HOST}/api/instagram/user?username=${encodeURIComponent(norm)}`,
        `https://${IG_HOST}/api/instagram/userinfo?username=${encodeURIComponent(norm)}`,
        `https://${IG_HOST}/api/instagram/username?username=${encodeURIComponent(norm)}`,
      ];
      for (const endpoint of infoEndpoints) {
        try {
          const ij = await rapidApiRequest<any>({ 
            url: endpoint, 
            method: 'GET', 
            rapidApiHost: IG_HOST, 
            timeoutMs: 20000 
          });
          const cand = ij?.result?.user || ij?.user || ij?.result || {};
          const pk = cand?.pk || cand?.id || cand?.pk_id || ij?.result?.pk || ij?.result?.id;
          if (pk) {
            await supa.from('instagram_user_ids').upsert({ 
              instagram_username: norm, 
              instagram_user_id: String(pk), 
              created_at: new Date().toISOString() 
            }, { onConflict: 'instagram_username' });
            return { username: norm, success: true, user_id: String(pk), method: 'primary_host' };
          }
        } catch (e: any) {
          // Continue to next endpoint
        }
      }

      // 3) Alternative scraper endpoints
      const altEndpoints = [
        `https://${IG_SCRAPER_HOST}/get_user_id?user_name=${encodeURIComponent(norm)}`,
        `https://${IG_SCRAPER_HOST}/get_user_id_from_username?user_name=${encodeURIComponent(norm)}`,
        `https://${IG_SCRAPER_HOST}/get_instagram_user_id_from_username?username=${encodeURIComponent(norm)}`,
      ];
      for (const endpoint of altEndpoints) {
        try {
          const j = await rapidApiRequest<any>({ 
            url: endpoint, 
            method: 'GET', 
            rapidApiHost: IG_SCRAPER_HOST, 
            timeoutMs: 20000 
          });
          const pk = j?.user_id || j?.id || j?.data?.user_id || j?.data?.id || j?.data?.user?.id || j?.user?.id;
          if (pk) {
            await supa.from('instagram_user_ids').upsert({ 
              instagram_username: norm, 
              instagram_user_id: String(pk), 
              created_at: new Date().toISOString() 
            }, { onConflict: 'instagram_username' });
            return { username: norm, success: true, user_id: String(pk), method: 'scraper_alt' };
          }
        } catch (e: any) {
          // Continue to next endpoint
        }
      }

      return { username: norm, success: false, error: 'All resolve methods failed' };
    };

    const results = await asyncPool(needResolve, concurrency, resolveOne);
    const successful = results.filter((r: any) => r.success).length;
    const failed = results.filter((r: any) => !r.success);

    return NextResponse.json({
      total: uniqueUsernames.size,
      needResolve: needResolve.length,
      successful,
      failed: failed.length,
      failedUsernames: failed.map((r: any) => r.username),
      results
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
