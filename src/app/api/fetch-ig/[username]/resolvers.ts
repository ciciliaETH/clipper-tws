import { rapidApiRequest } from '@/lib/rapidapi';
import type { SupabaseClient } from '@supabase/supabase-js';

const IG_HOST = process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram-media-api.p.rapidapi.com';
const IG_SCRAPER_HOST = process.env.RAPIDAPI_IG_SCRAPER_HOST || 'instagram-scraper-api11.p.rapidapi.com';

export async function resolveUserIdViaLink(norm: string, supa: SupabaseClient): Promise<string | undefined> {
  try {
    // 0) cache - check if exists and not null
    const { data: cached } = await supa
      .from('instagram_user_ids')
      .select('instagram_user_id')
      .eq('instagram_username', norm)
      .maybeSingle();
    if (cached?.instagram_user_id) return String(cached.instagram_user_id);
  } catch {}
  
  // 1) Scraper host: prioritize link->user_id resolver (PRIMARY METHOD per requirement)
  try {
    const link = encodeURIComponent(`https://www.instagram.com/${norm}`);
    const url = `https://${IG_SCRAPER_HOST}/get_instagram_user_id?link=${link}`;
    const j = await rapidApiRequest<any>({ url, method: 'GET', rapidApiHost: IG_SCRAPER_HOST, timeoutMs: 15000, maxPerKeyRetries: 2 });
    const userId = String(j?.user_id || j?.id || j?.data?.user_id || j?.data?.id || '') || undefined;
    if (userId) {
      try { 
        await supa.from('instagram_user_ids').upsert({ 
          instagram_username: norm, 
          instagram_user_id: userId, 
          created_at: new Date().toISOString() 
        }, { onConflict: 'instagram_username' }); 
      } catch {}
      return userId;
    }
  } catch {}
  
  // 2) Primary host fallback endpoints
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
      if (pk) {
        try { 
          await supa.from('instagram_user_ids').upsert({ 
            instagram_username: norm, 
            instagram_user_id: String(pk), 
            created_at: new Date().toISOString() 
          }, { onConflict: 'instagram_username' }); 
        } catch {}
        return String(pk);
      }
    } catch {}
  }
  
  // 3) Alternative scraper endpoints
  const altEndpoints = [
    `https://${IG_SCRAPER_HOST}/get_user_id?user_name=${encodeURIComponent(norm)}`,
    `https://${IG_SCRAPER_HOST}/get_user_id_from_username?user_name=${encodeURIComponent(norm)}`,
    `https://${IG_SCRAPER_HOST}/get_instagram_user_id_from_username?username=${encodeURIComponent(norm)}`,
  ];
  for (const u of altEndpoints) {
    try {
      const j = await rapidApiRequest<any>({ url: u, method: 'GET', rapidApiHost: IG_SCRAPER_HOST, timeoutMs: 15000 });
      const pk = j?.user_id || j?.id || j?.data?.user_id || j?.data?.id || j?.data?.user?.id || j?.user?.id;
      if (pk) {
        try { 
          await supa.from('instagram_user_ids').upsert({ 
            instagram_username: norm, 
            instagram_user_id: String(pk), 
            created_at: new Date().toISOString() 
          }, { onConflict: 'instagram_username' }); 
        } catch {}
        return String(pk);
      }
    } catch {}
  }
  
  return undefined;
}

export async function resolveUserId(norm: string, supa: SupabaseClient): Promise<string | undefined> {
  // 1) Try primary host
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
      if (pk) return String(pk);
    } catch {}
  }
  
  // 2) Try scraper host variants
  const altEndpoints = [
    `https://${IG_SCRAPER_HOST}/get_instagram_user_id?link=${encodeURIComponent(`https://www.instagram.com/${norm}`)}`,
    `https://${IG_SCRAPER_HOST}/get_user_id?user_name=${encodeURIComponent(norm)}`,
    `https://${IG_SCRAPER_HOST}/get_user_id_from_username?user_name=${encodeURIComponent(norm)}`,
    `https://${IG_SCRAPER_HOST}/get_instagram_user_id_from_username?username=${encodeURIComponent(norm)}`,
    `https://${IG_SCRAPER_HOST}/get_instagram_profile_info?username=${encodeURIComponent(norm)}`,
    `https://${IG_SCRAPER_HOST}/get_instagram_profile_details?username=${encodeURIComponent(norm)}`,
  ];
  for (const u of altEndpoints) {
    try {
      const j = await rapidApiRequest<any>({ url: u, method: 'GET', rapidApiHost: IG_SCRAPER_HOST, timeoutMs: 15000 });
      const pk = j?.user_id || j?.id || j?.data?.user_id || j?.data?.id || j?.data?.user?.id || j?.user?.id;
      if (pk) {
        try { 
          await supa.from('instagram_user_ids').upsert({ 
            instagram_username: norm, 
            instagram_user_id: String(pk), 
            created_at: new Date().toISOString() 
          }, { onConflict: 'instagram_username' }); 
        } catch {}
        return String(pk);
      }
    } catch {}
  }
  return undefined;
}
