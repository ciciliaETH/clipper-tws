import { rapidApiRequest } from '@/lib/rapidapi';
import { parseMs, resolveCounts } from './helpers';

const IG_HOST = process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram-media-api.p.rapidapi.com';

export async function processScraperItems(items: any[], norm: string): Promise<any[]> {
  const upserts: any[] = [];
  
  for (const it of items) {
    const id = String(it?.id || it?.code || ''); 
    if (!id) continue;
    
    const ms =
      parseMs(it?.taken_at) ||
      parseMs(it?.device_timestamp) ||
      parseMs(it?.taken_at_timestamp) ||
      parseMs(it?.timestamp) ||
      parseMs(it?.taken_at_ms) ||
      parseMs(it?.created_at) ||
      parseMs(it?.created_at_utc) || null;
    if (!ms) continue;
    
    const post_date = new Date(ms).toISOString().slice(0,10);
    let play = Number(it?.play_count ?? it?.ig_play_count ?? it?.view_count ?? it?.video_view_count ?? 0) || 0;
    let like = Number(it?.like_count ?? 0) || 0;
    let comment = Number(it?.comment_count ?? 0) || 0;
    
    // If zero, try ONE additional resolve attempt
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
    
    upserts.push({ id, username: norm, post_date, play_count: play, like_count: like, comment_count: comment });
  }
  
  return upserts;
}

export async function processBestItems(items: any[], norm: string): Promise<any[]> {
  const upserts: any[] = [];
  
  for (const it of items) {
    const media = it;
    const code = String(media?.code || '');
    const pid = String(media?.id || media?.pk || code || ''); 
    if (!pid) continue;
    
    const ms =
      parseMs(media?.taken_at) ||
      parseMs(media?.device_timestamp) ||
      parseMs(media?.taken_at_timestamp) ||
      parseMs(media?.timestamp) || null;
    if (!ms) continue;
    
    const post_date = new Date(ms).toISOString().slice(0,10);
    let play = Number(media?.play_count || media?.view_count || media?.video_view_count || 0) || 0;
    let like = Number(media?.like_count || 0) || 0;
    let comment = Number(media?.comment_count || 0) || 0;
    
    if ((play + like + comment) === 0) {
      const counts = await resolveCounts({ id: pid, code }, { id: pid, code });
      if (counts) { play = counts.play; like = counts.like; comment = counts.comment; }
    }
    
    upserts.push({ id: pid, username: norm, post_date, play_count: play, like_count: like, comment_count: comment });
  }
  
  return upserts;
}

export async function processEdges(edges: any[], norm: string, linksMap: Map<string, number>, telemetry: any): Promise<any[]> {
  const upserts: any[] = [];
  
  for (const e of edges) {
    const node = e?.node || e?.media || e;
    const media = node?.media || node;
    const id = String(media?.pk || media?.id || media?.code || '');
    if (!id) continue;
    
    telemetry.edges += 1;
    
    let ms =
      parseMs(media?.taken_at) ||
      parseMs(media?.taken_at_ms) ||
      parseMs(media?.device_timestamp) ||
      parseMs(media?.timestamp) ||
      parseMs(node?.taken_at) ||
      parseMs(node?.caption?.created_at) ||
      parseMs(node?.caption?.created_at_utc);
    
    if (!ms) {
      const code = String(media?.code || node?.code || '');
      if (code && linksMap.has(code)) { 
        ms = linksMap.get(code)!; 
        telemetry.linkMatches += 1; 
      }
      if (!ms) {
        telemetry.skippedNoTimestamp += 1; 
        continue; 
      }
    }
    
    const d = new Date(ms!);
    const post_date = d.toISOString().slice(0,10);
    let play = Number(media?.play_count ?? media?.view_count ?? media?.video_view_count ?? 0) || 0;
    let like = Number(media?.like_count ?? media?.edge_liked_by?.count ?? 0) || 0;
    let comment = Number(media?.comment_count ?? media?.edge_media_to_comment?.count ?? 0) || 0;
    
    if ((play + like + comment) === 0) {
      const fixed = await resolveCounts(media, node);
      if (fixed) { play = fixed.play; like = fixed.like; comment = fixed.comment; }
    }
    
    if ((play + like + comment) === 0) continue;
    upserts.push({ id, username: norm, post_date, play_count: play, like_count: like, comment_count: comment });
  }
  
  return upserts;
}

export async function processProfileMedia(medias: any[], norm: string): Promise<any[]> {
  const upserts: any[] = [];
  
  for (const m of medias) {
    const id = String(m?.id || m?.shortcode || ''); 
    if (!id) continue;
    
    const ms = parseMs(m?.timestamp) || parseMs(m?.taken_at) || null; 
    if (!ms) continue;
    
    const post_date = new Date(ms).toISOString().slice(0,10);
    let play = Number(m?.video_views || m?.play_count || m?.view_count || m?.video_view_count || 0) || 0;
    let like = Number(m?.like || m?.like_count || 0) || 0;
    let comment = Number(m?.comment_count || 0) || 0;
    
    if ((play + like + comment) === 0) {
      const counts = await resolveCounts({ id, code: m?.shortcode }, { id, code: m?.shortcode });
      if (counts) { play = counts.play; like = counts.like; comment = counts.comment; }
    }
    
    if ((play + like + comment) === 0) continue;
    upserts.push({ id, username: norm, post_date, play_count: play, like_count: like, comment_count: comment });
  }
  
  return upserts;
}

export async function processLinksArray(arr: any[], norm: string, telemetry: any): Promise<any[]> {
  const upserts: any[] = [];
  
  for (const it of arr) {
    const sc = String(it?.shortcode || it?.meta?.shortcode || '');
    const ts = parseMs(it?.takenAt || it?.meta?.takenAt);
    if (!sc || !ts) continue;
    
    const post_date = new Date(ts).toISOString().slice(0,10);
    let views = Number(it?.playCount || it?.viewCount || 0) || 0;
    let likes = Number(it?.likeCount || 0) || 0;
    let comments = Number(it?.commentCount || 0) || 0;
    
    if ((views + likes + comments) === 0) {
      const counts = await resolveCounts({ code: sc }, { code: sc });
      if (counts) { views = counts.play; likes = counts.like; comments = counts.comment; }
    }
    
    if ((views + likes + comments) === 0) continue;
    upserts.push({ id: sc, username: norm, post_date, play_count: views, like_count: likes, comment_count: comments });
    telemetry.fallbackLinksUsed += 1;
  }
  
  return upserts;
}
