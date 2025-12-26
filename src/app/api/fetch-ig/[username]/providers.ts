import { rapidApiRequest } from '@/lib/rapidapi';

// Default RapidAPI host prioritized by user: instagram-media-api.p.rapidapi.com
const IG_HOST = process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram-media-api.p.rapidapi.com';
const IG_SCRAPER_HOST = process.env.RAPIDAPI_IG_SCRAPER_HOST || 'instagram-scraper-api11.p.rapidapi.com';
const IG_FAST_HOST = process.env.RAPIDAPI_IG_FAST_HOST || 'instagram-api-fast-reliable-data-scraper.p.rapidapi.com';
const IG_BEST_HOST = process.env.RAPIDAPI_IG_BEST_HOST || 'instagram-best-experience.p.rapidapi.com';
const IG_PROFILE1_HOST = process.env.RAPIDAPI_IG_PROFILE1_HOST || 'instagram-profile1.p.rapidapi.com';

export interface ProviderResult {
  source: string;
  items: any[];
}

async function fetchFromProvider(name: string, fetcher: () => Promise<any[]>): Promise<ProviderResult> {
  for (let retry = 0; retry < 3; retry++) {
    try {
      const items = await fetcher();
      if (items && items.length > 0) {
        return { source: name, items };
      }
    } catch (e) {
      if (retry === 2) console.warn(`[fetch-ig] ${name} failed after 3 retries:`, (e as any)?.message);
    }
    if (retry < 2) await new Promise(r => setTimeout(r, 1000 * (retry + 1))); // 1s, 2s delay (rate limit)
  }
  return { source: name, items: [] };
}

export async function fetchAllProviders(userId: string): Promise<ProviderResult[]> {
  const providers = [
    // Provider 1: Scraper (MOST RELIABLE - PRIMARY)
    fetchFromProvider('scraper', async () => {
      const sj = await rapidApiRequest<any>({ 
        url: `https://${IG_SCRAPER_HOST}/get_instagram_reels_details_from_id?user_id=${encodeURIComponent(userId)}`, 
        method: 'GET', 
        rapidApiHost: IG_SCRAPER_HOST, 
        timeoutMs: 30000, 
        maxPerKeyRetries: 3 
      });
      return (sj?.data?.reels || sj?.reels || sj?.data?.items || sj?.items || []) as any[];
    }),
    
    // Provider 2: IG_HOST reels
    fetchFromProvider('ig_host', async () => {
      const rj = await rapidApiRequest<any>({ 
        url: `https://${IG_HOST}/api/instagram/reels`, 
        method: 'POST', 
        rapidApiHost: IG_HOST, 
        body: { userid: userId, user_id: userId, maxId: '' }, 
        timeoutMs: 30000, 
        maxPerKeyRetries: 3 
      });
      return (rj?.result?.edges || rj?.result?.items || []) as any[];
    }),
    
    // Provider 3: Fast provider
    fetchFromProvider('fast', async () => {
      if (!IG_FAST_HOST) return [];
      const fr = await rapidApiRequest<any>({ 
        url: `https://${IG_FAST_HOST}/reels?user_id=${encodeURIComponent(userId)}&include_feed_video=true`, 
        method: 'GET', 
        rapidApiHost: IG_FAST_HOST, 
        timeoutMs: 30000, 
        maxPerKeyRetries: 3 
      });
      const items: any[] = Array.isArray(fr?.data?.items) ? fr.data.items : (Array.isArray(fr?.items) ? fr.items : []);
      return items.map((it:any)=> ({ media: it?.media || it }));
    }),

    // Provider 4: Best provider
    fetchFromProvider('best', async () => {
      const bj = await rapidApiRequest<any>({ 
        url: `https://${IG_BEST_HOST}/feed?user_id=${encodeURIComponent(userId)}`, 
        method: 'GET', 
        rapidApiHost: IG_BEST_HOST, 
        timeoutMs: 30000, 
        maxPerKeyRetries: 3 
      });
      return (bj?.items || bj?.data?.items || bj?.result?.items || (Array.isArray(bj) ? bj : [])) as any[];
    })
  ];
  
  // SEQUENTIAL EXECUTION with 1s delay to avoid rate limit (Premium: 1 req/sec)
  const results: ProviderResult[] = [];
  for (const provider of providers) {
    const result = await provider;
    results.push(result);
    if (result.items.length > 0) break; // Stop if provider succeeds
    await new Promise(r => setTimeout(r, 1000)); // 1 second delay
  }
  return results;
}

export async function fetchProfileData(norm: string): Promise<any[]> {
  try {
    const pj = await rapidApiRequest<any>({ 
      url: `https://${IG_PROFILE1_HOST}/getreel/${encodeURIComponent(norm)}`, 
      method: 'GET', 
      rapidApiHost: IG_PROFILE1_HOST, 
      timeoutMs: 20000 
    });
    return (pj?.data?.media || pj?.media || pj?.items || []) as any[];
  } catch {
    return [];
  }
}

export async function fetchLinksData(url: string): Promise<any[]> {
  try {
    const lj = await rapidApiRequest<any>({ 
      url: `https://${IG_HOST}/api/instagram/links`, 
      method: 'POST', 
      rapidApiHost: IG_HOST, 
      body: { url }, 
      timeoutMs: 20000 
    });
    return (lj?.urls || lj?.result?.urls || lj?.data || []);
  } catch {
    return [];
  }
}

export { IG_HOST, IG_SCRAPER_HOST, IG_FAST_HOST, IG_BEST_HOST, IG_PROFILE1_HOST };
