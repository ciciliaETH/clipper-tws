import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Paginated fetch
async function fetchAll(queryFn: () => any): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const size = 5000;
  while (true) {
    const { data, error } = await queryFn().range(offset, offset + size - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < size) break;
    offset += size;
  }
  return all;
}

export async function POST(req: Request) {
  const supa = adminClient();
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false; // default: dry run (no actual deletes)
  const platform = body?.platform || 'all'; // 'tiktok' | 'instagram' | 'all'

  const results: any = { dry_run: dryRun, tiktok: null, instagram: null };

  // === TIKTOK: Find duplicates by content fingerprint ===
  if (platform === 'all' || platform === 'tiktok') {
    const ttRows = await fetchAll(
      () => supa.from('tiktok_posts_daily')
        .select('video_id, username, title, play_count')
        .order('play_count', { ascending: false })
        .order('video_id', { ascending: true })
    );

    // Group by fingerprint: username + title (first 50 chars) + play_count
    const fpMap = new Map<string, any[]>();
    for (const r of ttRows) {
      const title = String(r.title || '').slice(0, 50).toLowerCase().trim();
      const username = String(r.username || '').toLowerCase();
      const views = Number(r.play_count || 0);
      if (!title || !username) continue;
      const fp = `${username}|${title}|${views}`;
      const arr = fpMap.get(fp) || [];
      arr.push(r);
      fpMap.set(fp, arr);
    }

    // Find groups with duplicates
    const duplicateGroups: any[] = [];
    const idsToDelete: string[] = [];
    for (const [fp, rows] of fpMap) {
      if (rows.length <= 1) continue;
      // Keep the one with numeric video_id (not aweme_id format), prefer shortest ID
      rows.sort((a: any, b: any) => {
        const aIsNumeric = /^\d+$/.test(String(a.video_id));
        const bIsNumeric = /^\d+$/.test(String(b.video_id));
        if (aIsNumeric && !bIsNumeric) return -1;
        if (!aIsNumeric && bIsNumeric) return 1;
        return String(a.video_id).length - String(b.video_id).length;
      });
      const keep = rows[0];
      const dupes = rows.slice(1);
      duplicateGroups.push({
        fingerprint: fp,
        keep: keep.video_id,
        delete: dupes.map((d: any) => d.video_id),
        count: rows.length
      });
      idsToDelete.push(...dupes.map((d: any) => String(d.video_id)));
    }

    let deleted = 0;
    if (!dryRun && idsToDelete.length > 0) {
      // Delete in batches of 100
      for (let i = 0; i < idsToDelete.length; i += 100) {
        const batch = idsToDelete.slice(i, i + 100);
        const { error } = await supa.from('tiktok_posts_daily').delete().in('video_id', batch);
        if (!error) deleted += batch.length;
        else console.error('[Cleanup] TikTok delete error:', error.message);
      }
    }

    results.tiktok = {
      total_rows: ttRows.length,
      duplicate_groups: duplicateGroups.length,
      duplicate_rows: idsToDelete.length,
      deleted: dryRun ? 0 : deleted,
      sample_duplicates: duplicateGroups.slice(0, 10)
    };
  }

  // === INSTAGRAM: Find duplicates by code (shortcode) ===
  if (platform === 'all' || platform === 'instagram') {
    const igRows = await fetchAll(
      () => supa.from('instagram_posts_daily')
        .select('id, code, username, caption, play_count')
        .order('play_count', { ascending: false })
        .order('id', { ascending: true })
    );

    // Group by code (shortcode) - most reliable unique identifier
    const codeMap = new Map<string, any[]>();
    // Also group by fingerprint for entries without code
    const fpMap = new Map<string, any[]>();

    for (const r of igRows) {
      const code = String(r.code || '').trim();
      if (code) {
        const arr = codeMap.get(code) || [];
        arr.push(r);
        codeMap.set(code, arr);
      } else {
        const caption = String(r.caption || '').slice(0, 50).toLowerCase().trim();
        const username = String(r.username || '').toLowerCase();
        const views = Number(r.play_count || 0);
        if (!caption || !username) continue;
        const fp = `${username}|${caption}|${views}`;
        const arr = fpMap.get(fp) || [];
        arr.push(r);
        fpMap.set(fp, arr);
      }
    }

    const idsToDelete: string[] = [];
    const duplicateGroups: any[] = [];

    // Dedup by code
    for (const [code, rows] of codeMap) {
      if (rows.length <= 1) continue;
      // Keep first (highest play_count due to sort)
      const keep = rows[0];
      const dupes = rows.slice(1);
      duplicateGroups.push({
        code,
        keep: keep.id,
        delete: dupes.map((d: any) => d.id),
        count: rows.length
      });
      idsToDelete.push(...dupes.map((d: any) => String(d.id)));
    }

    // Dedup by fingerprint (for entries without code)
    for (const [fp, rows] of fpMap) {
      if (rows.length <= 1) continue;
      const keep = rows[0];
      const dupes = rows.slice(1);
      duplicateGroups.push({
        fingerprint: fp,
        keep: keep.id,
        delete: dupes.map((d: any) => d.id),
        count: rows.length
      });
      idsToDelete.push(...dupes.map((d: any) => String(d.id)));
    }

    let deleted = 0;
    if (!dryRun && idsToDelete.length > 0) {
      for (let i = 0; i < idsToDelete.length; i += 100) {
        const batch = idsToDelete.slice(i, i + 100);
        const { error } = await supa.from('instagram_posts_daily').delete().in('id', batch);
        if (!error) deleted += batch.length;
        else console.error('[Cleanup] Instagram delete error:', error.message);
      }
    }

    results.instagram = {
      total_rows: igRows.length,
      duplicate_groups: duplicateGroups.length,
      duplicate_rows: idsToDelete.length,
      deleted: dryRun ? 0 : deleted,
      sample_duplicates: duplicateGroups.slice(0, 10)
    };
  }

  return NextResponse.json(results);
}
