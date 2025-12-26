import { rapidApiRequest } from '@/lib/rapidapi';

export function parseMs(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0) return n > 1e12 ? n : n * 1000;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export async function resolveTimestamp(media: any, node: any, IG_HOST: string): Promise<number | null> {
  const code = String(media?.code || node?.code || '');
  const id = String(media?.id || media?.pk || node?.id || node?.pk || '');
  const tryUrls: string[] = [];
  if (code) {
    tryUrls.push(
      `https://${IG_HOST}/api/instagram/post_info?code=${encodeURIComponent(code)}`,
      `https://${IG_HOST}/api/instagram/media_info?code=${encodeURIComponent(code)}`
    );
  }
  if (id) {
    tryUrls.push(
      `https://${IG_HOST}/api/instagram/media_info?id=${encodeURIComponent(id)}`,
      `https://${IG_HOST}/api/instagram/post_info?id=${encodeURIComponent(id)}`
    );
  }
  for (const url of tryUrls) {
    try {
      const j = await rapidApiRequest<any>({ url, method: 'GET', rapidApiHost: IG_HOST, timeoutMs: 20000 });
      const m = j?.result?.items?.[0] || j?.result?.media || j?.result || j?.item || j;
      const ts = parseMs(m?.taken_at) || parseMs(m?.taken_at_ms) || parseMs(m?.caption?.created_at) || null;
      if (ts) return ts;
    } catch {}
  }
  return null;
}

export async function resolveCounts(media: any, node: any, IG_HOST: string): Promise<{play:number, like:number, comment:number} | null> {
  const code = String(media?.code || node?.code || '');
  const id = String(media?.id || media?.pk || node?.id || node?.pk || '');
  const tryUrls: string[] = [];
  if (code) {
    tryUrls.push(
      `https://${IG_HOST}/api/instagram/post_info?code=${encodeURIComponent(code)}`,
      `https://${IG_HOST}/api/instagram/media_info?code=${encodeURIComponent(code)}`
    );
  }
  if (id) {
    tryUrls.push(
      `https://${IG_HOST}/api/instagram/media_info?id=${encodeURIComponent(id)}`,
      `https://${IG_HOST}/api/instagram/post_info?id=${encodeURIComponent(id)}`
    );
  }
  for (const url of tryUrls) {
    try {
      const j = await rapidApiRequest<any>({ url, method: 'GET', rapidApiHost: IG_HOST, timeoutMs: 20000 });
      const m = j?.result?.items?.[0] || j?.result?.media || j?.result || j?.item || j;
      const play = Number(m?.play_count || m?.view_count || m?.video_view_count || 0) || 0;
      const like = Number(m?.like_count || m?.edge_liked_by?.count || 0) || 0;
      const comment = Number(m?.comment_count || m?.edge_media_to_comment?.count || 0) || 0;
      if (play > 0 || like > 0 || comment > 0) return { play, like, comment };
    } catch {}
  }
  return null;
}
