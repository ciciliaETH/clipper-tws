import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rapidApiRequest } from '@/lib/rapidapi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s Vercel limit

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// RapidAPI host for media details
const IG_MEDIA_API = 'instagram-media-api.p.rapidapi.com';

// Helper to fetch taken_at from RapidAPI
async function fetchTakenAt(shortcode: string): Promise<number | null> {
  if (!shortcode) return null;
  try {
    const j = await rapidApiRequest<any>({
      url: `https://${IG_MEDIA_API}/media/shortcode_reels`,
      method: 'POST',
      rapidApiHost: IG_MEDIA_API,
      body: { shortcode, proxy: '' },
      timeoutMs: 10000,
      maxPerKeyRetries: 3
    });
    const items = j?.data?.xdt_api__v1__media__shortcode__web_info?.items || j?.items || [];
    const item = items[0] || j;
    const ts = item?.taken_at || item?.taken_at_timestamp;
    if (!ts) return null;
    const num = Number(ts);
    if (isNaN(num) || num <= 0) return null;
    // Convert to milliseconds if needed
    return num > 1e12 ? num : num * 1000;
  } catch (e: any) {
    console.error('[Backfill] fetchTakenAt error:', e.message);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(200, Number(body?.limit || 100))); // Process 100 per batch, max 200
    const delayMs = Math.max(200, Math.min(10000, Number(body?.delay_ms || 800))); // 800ms delay between requests
    const timeoutMs = Math.min(55000, Number(body?.timeout_ms || 55000)); // Max 55s to stay under 60s Vercel limit

    const supa = adminClient();
    const startTime = Date.now();
    
    // AUTO-LOOP: Keep processing until no more posts or timeout
    let totalUpdated = 0;
    let totalFailed = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    const allFailedDetails: Array<{ id: string; username: string; error: string }> = [];

    console.log(`[Backfill] Starting auto-loop backfill (limit=${limit} per batch, timeout=${timeoutMs}ms)...`);

    while (true) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        console.log(`[Backfill] ⚠️ Timeout reached (${timeoutMs}ms), stopping...`);
        break;
      }

      batchCount++;
      
      // Get Instagram posts with NULL taken_at (need backfill)
      const { data: posts, error: fetchError } = await supa
        .from('instagram_posts_daily')
        .select('id, code, username')
        .is('taken_at', null) // Only posts missing taken_at
        .not('code', 'is', null) // Must have shortcode
        .limit(limit);

      if (fetchError) {
        console.error('[Backfill] Database error:', fetchError);
        return NextResponse.json({
          error: 'Database error',
          message: fetchError.message
        }, { status: 500 });
      }

      // No more posts to process - SUCCESS!
      if (!posts || posts.length === 0) {
        console.log(`[Backfill] ✅ All posts backfilled! No more posts with NULL taken_at.`);
        break;
      }

      console.log(`[Backfill] Batch ${batchCount}: Found ${posts.length} posts missing taken_at, processing...`);

      let updated = 0;
      let failed = 0;

      for (const post of posts) {
        const { id, code, username } = post;
        
        try {
          const ms = await fetchTakenAt(code);
          
          if (!ms) {
            console.warn(`[Backfill] ⚠️ Could not fetch taken_at for ${code}`);
            failed++;
            allFailedDetails.push({ id, username, error: 'RapidAPI returned no timestamp' });
            continue;
          }

          const takenAt = new Date(ms).toISOString();
          
          // Update the post with taken_at
          const { error: updateError } = await supa
            .from('instagram_posts_daily')
            .update({ taken_at: takenAt })
            .eq('id', id);

          if (updateError) {
            console.error(`[Backfill] ❌ Failed to update ${id}:`, updateError.message);
            failed++;
            allFailedDetails.push({ id, username, error: updateError.message });
          } else {
            updated++;
            if (updated % 10 === 0) { // Log every 10 successes
              console.log(`[Backfill] Batch ${batchCount}: ${updated} updated so far...`);
            }
          }

          // Delay between requests to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, delayMs));

        } catch (error: any) {
          console.error(`[Backfill] ❌ Error processing ${id}:`, error.message);
          failed++;
          allFailedDetails.push({ id, username, error: error.message });
        }
      }

      totalUpdated += updated;
      totalFailed += failed;
      totalProcessed += posts.length;

      console.log(`[Backfill] Batch ${batchCount} complete: ✅ ${updated} updated, ❌ ${failed} failed out of ${posts.length} total`);
      
      // If we processed less than limit, we're done (no more posts)
      if (posts.length < limit) {
        console.log(`[Backfill] ✅ Processed ${posts.length} < ${limit}, all done!`);
        break;
      }
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Backfill] AUTO-LOOP COMPLETE: ✅ ${totalUpdated} updated, ❌ ${totalFailed} failed out of ${totalProcessed} total across ${batchCount} batches in ${elapsedSec}s`);

    return NextResponse.json({
      success: true,
      message: `Auto-loop backfill complete: ${totalUpdated} updated, ${totalFailed} failed across ${batchCount} batches`,
      batches: batchCount,
      processed: totalProcessed,
      updated: totalUpdated,
      failed: totalFailed,
      elapsedSeconds: parseFloat(elapsedSec),
      failedDetails: totalFailed > 0 ? allFailedDetails.slice(0, 50) : undefined, // Only return first 50 failures
      note: totalFailed > 0 ? 'Some posts failed - may need manual retry' : 'All posts processed successfully'
    });

  } catch (error: any) {
    console.error('[Backfill] Error:', error);
    return NextResponse.json({
      error: 'Backfill failed',
      message: error.message
    }, { status: 500 });
  }
}

// GET endpoint to check how many posts need backfill
export async function GET() {
  try {
    const supa = adminClient();

    const { count, error } = await supa
      .from('instagram_posts_daily')
      .select('id', { count: 'exact', head: true })
      .is('taken_at', null)
      .not('code', 'is', null);

    if (error) {
      return NextResponse.json({
        error: 'Database error',
        message: error.message
      }, { status: 500 });
    }

    return NextResponse.json({
      posts_need_backfill: count || 0,
      message: count === 0 
        ? 'No posts need backfill' 
        : `${count} posts need taken_at backfill. Use POST to start backfill.`,
      endpoint: '/api/admin/ig/backfill-taken-at',
      usage: 'POST with optional body: { "limit": 10, "delay_ms": 1000 }'
    });

  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to check backfill status',
      message: error.message
    }, { status: 500 });
  }
}
