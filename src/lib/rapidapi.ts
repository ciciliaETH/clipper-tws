/*
  Unified RapidAPI key rotation helper
  - Reads a comma-separated list of keys from RAPID_API_KEYS (preferred) or RAPIDAPI_KEYS fallback
  - Also supports single-key fallback from RAPIDAPI_KEY for backward compatibility
  - Skips keys on cooldown (per-process in-memory, persists across warm invocations on serverless)
  - Detects rate-limit/quota responses (429/403 or quota text) and puts that key on cooldown
  - Optional per-key retries for transient network errors
  - Distributes load by starting index based on time bucket + URL hash (approx round-robin)

  Usage:
    const data = await rapidApiRequest({
      url: `https://${host}/path`,
      method: 'GET',
      rapidApiHost: host, // if the RapidAPI endpoint requires X-RapidAPI-Host
      headers: { /* any extra headers */ /* },
      body: undefined,
    });
*/

import { setTimeout as delay } from 'timers/promises';

export type RapidRequestOpts = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  rapidApiHost?: string; // if endpoint requires X-RapidAPI-Host
  maxPerKeyRetries?: number; // how many retries on the same key for network/transient errors (default: 5)
  cooldownMsOnLimit?: number; // cooldown if rate-limited/quota, default 5 min premium / 15 min free
  keysEnvName?: string; // by default reads RAPID_API_KEYS, fallback RAPIDAPI_KEYS, RAPIDAPI_KEY
};

function isRateLimitStatus(status: number) {
  return status === 429 || status === 403;
}
function looksLikeQuotaError(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes('rate limit') ||
    t.includes('quota') ||
    t.includes('exceeded') ||
    t.includes('over limit') ||
    t.includes('too many requests')
  );
}
function stableHash(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Per-process cooldown map: keyIndex -> epoch millis until usable
const cooldownUntil = new Map<number, number>();

export async function rapidApiRequest<T = any>(opts: RapidRequestOpts): Promise<T> {
  const {
    url,
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 20000,
    rapidApiHost,
    maxPerKeyRetries = 5, // DEFAULT 5 RETRIES FOR RELIABILITY
    cooldownMsOnLimit = 15 * 60 * 1000, // Will override for premium key below
    keysEnvName,
  } = opts;

  const primaryName = keysEnvName || 'RAPID_API_KEYS';
  
  // PREMIUM KEY PRIORITY: Always use RAPIDAPI_KEY first (premium account)
  const premiumKey = process.env.RAPIDAPI_KEY?.trim() || '';
  const rotationKeysRaw =
    process.env[primaryName] ||
    process.env.RAPIDAPI_KEYS ||
    process.env.RAPID_KEY_BACKFILL ||
    '';
  const rotationKeys = rotationKeysRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(k => k !== premiumKey); // Remove premium from rotation to avoid duplicate
  
  // Combine: premium first, then rotation keys
  const keys = premiumKey ? [premiumKey, ...rotationKeys] : rotationKeys;

  if (keys.length === 0) {
    throw new Error(
      'No RapidAPI keys configured. Set RAPID_API_KEYS (comma separated) or RAPIDAPI_KEY.'
    );
  }

  // PREMIUM KEY FIRST: Always try index 0 (premium) before rotating
  // Only rotate to other keys if premium is on cooldown
  let start = 0; // Start with premium key (index 0)

  const errors: string[] = [];
  const now = Date.now();

  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    const key = keys[idx];

    // skip if on cooldown
    const until = cooldownUntil.get(idx) || 0;
    if (until > now) {
      errors.push(`Key#${idx + 1} on cooldown until ${new Date(until).toISOString()}`);
      continue;
    }

    // per-key attempts
    for (let attempt = 0; attempt <= maxPerKeyRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method,
          headers: {
            ...headers,
            ...(rapidApiHost ? { 'X-RapidAPI-Host': rapidApiHost } : {}),
            'X-RapidAPI-Key': key,
            ...(headers['Content-Type'] ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (isRateLimitStatus(res.status)) {
          let text = '';
          try { text = await res.text(); } catch {}
          // Premium key (idx 0) gets shorter cooldown: 5 min vs 15 min for free keys
          const cooldown = idx === 0 ? 5 * 60 * 1000 : cooldownMsOnLimit;
          cooldownUntil.set(idx, Date.now() + cooldown);
          errors.push(`Key#${idx + 1} rate-limited (${res.status}) ${text.slice(0, 200)}`);
          break; // move to next key
        }

        if (!res.ok) {
          let text = '';
          try { text = await res.text(); } catch {}
          if (looksLikeQuotaError(text)) {
            // Premium key (idx 0) gets shorter cooldown: 5 min vs 15 min
            const cooldown = idx === 0 ? 5 * 60 * 1000 : cooldownMsOnLimit;
            cooldownUntil.set(idx, Date.now() + cooldown);
            errors.push(`Key#${idx + 1} quota msg: ${text.slice(0, 200)}`);
            break; // move to next key
          }
          if (attempt < maxPerKeyRetries) {
            // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
            const backoffMs = Math.min(500 * Math.pow(2, attempt), 10000);
            await delay(backoffMs);
            continue; // retry same key
          }
          errors.push(`Key#${idx + 1} non-ok ${res.status}: ${text.slice(0, 200)}`);
          break; // move to next key
        }

        // success
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return (await res.json()) as T;
        }
        return (await res.text()) as unknown as T;
      } catch (e: any) {
        clearTimeout(timer);
        const msg = String(e?.message || e);
        // Retry on abort/timeout/network with exponential backoff
        if (attempt < maxPerKeyRetries && (msg.includes('aborted') || msg.includes('timeout') || msg.includes('network'))) {
          const backoffMs = Math.min(500 * Math.pow(2, attempt), 10000);
          await delay(backoffMs);
          continue;
        }
        errors.push(`Key#${idx + 1} exception: ${msg}`);
        break; // move to next key
      }
    }
  }

  throw new Error(`All RapidAPI keys failed or on cooldown. Details: ${errors.join(' | ')}`);
}

export function markRapidApiKeyCooldown(indexZeroBased: number, ms: number) {
  cooldownUntil.set(indexZeroBased, Date.now() + Math.max(ms, 1000));
}
