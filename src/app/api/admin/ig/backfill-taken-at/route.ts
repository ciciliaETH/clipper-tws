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
    // Batch processing params
    const batchSize = Math.max(1, Math.min(50, Number(body?.limit || 20))); // Process 20 by default per inner batch
    const delayMs = Math.max(100, Math.min(10000, Number(body?.delay_ms || 200))); // 200ms delay between requests
    const timeoutThreshold = 55000; // Stop after 55s (Vercel limit 60s)

    const supa = adminClient();
    const startTime = Date.now();
    
    // Server-side loop: Keep processing small batches until time runs out
    let totalUpdated = 0;
    let totalFailed = 0;
    const allFailedDetails: Array<{ id: string; username: string; error: string }> = [];
    
    console.log(`[Backfill] Starting time-boxed loop (batchSize=${batchSize}, stop at 55s)...`);

    while (true) {
      // 1. Check time budget
      if (Date.now() - startTime > timeoutThreshold) {
        console.log(`[Backfill] ⏱️ 55s time limit reached, stopping safely.`);
        break;
      }

      // 2. Fetch one batch
      const { data: posts, error: fetchError } = await supa
        .from('instagram_posts_daily')
        .select('id, code, username, post_date')
        .is('taken_at', null)      // Only posts missing taken_at
        .not('code', 'is', null)   // Must have shortcode
        .gte('post_date', '2026-01-01') // Only recent posts
        .limit(batchSize);

      if (fetchError) {
        console.error('[Backfill] Database error:', fetchError);
        // Break instead of returning to return partial progress
        break;
      }
      
      // If no data, we are done
      if (!posts || posts.length === 0) {
        console.log(`[Backfill] ✅ No more posts to process.`);
        break;
      }

      console.log(`[Backfill] Processing batch of ${posts.length} posts...`);
      let batchUpdated = 0;

      // 3. Process items in batch
      for (const post of posts) {
        // Inner loop time check (granularity per item)
        if (Date.now() - startTime > timeoutThreshold) {
          console.log(`[Backfill] ⏱️ Timeout mid-batch, stopping.`);
          break;
        }

        const { id, code, username } = post;
        try {
          const ms = await fetchTakenAt(code);
          if (!ms) {
            totalFailed++;
            allFailedDetails.push({ id, username, error: 'RapidAPI returned no timestamp' });
            continue; // Move to next
          }

          const takenAt = new Date(ms).toISOString();
          const { error: updateError } = await supa
            .from('instagram_posts_daily')
            .update({ taken_at: takenAt })
            .eq('id', id);

          if (updateError) {
            console.error(`[Backfill] ❌ update failed ${id}:`, updateError.message);
            totalFailed++;
            allFailedDetails.push({ id, username, error: updateError.message });
          } else {
            totalUpdated++;
            batchUpdated++;
          }
           // Delay between API calls
          await new Promise(resolve => setTimeout(resolve, delayMs));

        } catch (error: any) {
          console.error(`[Backfill] ❌ Error ${id}:`, error.message);
          totalFailed++;
          allFailedDetails.push({ id, username, error: error.message });
        }
      }
      
      // If we fetched fewer than batch limit, we are done with all data
      if (posts.length < batchSize) {
        break;
      }
      
      // Loop continues... fetching next batch
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Check remaining count for frontend loop
    const { count: remainingCount } = await supa
      .from('instagram_posts_daily')
      .select('id', { count: 'exact', head: true })
      .is('taken_at', null)
      .not('code', 'is', null)
      .gte('post_date', '2026-01-01');

    return NextResponse.json({
      success: true,
      batch_processed: totalUpdated + totalFailed,
      batch_updated: totalUpdated,
      batch_failed: totalFailed,
      remaining: remainingCount || 0,
      completed: (remainingCount || 0) === 0,
      elapsed_seconds: parseFloat(elapsedSec),
      message: `Processed ${totalUpdated+totalFailed} posts (${totalUpdated} OK, ${totalFailed} failed) in ${elapsedSec}s. Remaining: ${remainingCount}`,
      failed_details: allFailedDetails
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
      .not('code', 'is', null)
      .gte('post_date', '2026-01-01'); // Only recent posts

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
