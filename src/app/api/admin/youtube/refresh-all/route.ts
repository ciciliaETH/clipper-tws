import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const offset = Number(body.offset || 0);
    const limit = Number(body.limit || 5); // Conservative limit for YouTube search quota
    const autoContinue = body.auto_continue || false;

    // Get origin for internal fetch
    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('host') || 'localhost:3000';
    const origin = `${proto}://${host}`;

    const supa = adminClient();

    // 1. Get unique channels from official mapping table user_youtube_channels (requested)
    const { data: parts, error } = await supa
      .from('user_youtube_channels')
      .select('user_id, youtube_channel_id', { count: 'exact' })
      .order('youtube_channel_id', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const channels = Array.from(new Set((parts||[]).map((p:any)=> p.youtube_channel_id))).filter(Boolean);

    // Check total for pagination based on mapping table
    const { count } = await supa.from('user_youtube_channels').select('*', { count: 'exact', head: true });
    
    const results = [];
    let successCount = 0;
    
    for (const channelId of channels) {
      try {
        const res = await fetch(`${origin}/api/fetch-youtube/${encodeURIComponent(channelId)}`, {
           method: 'GET'
        });
        const json = await res.json();
        results.push({ channelId, success: res.ok, ...json });
        if (res.ok) successCount++;
      } catch (e: any) {
        results.push({ channelId, success: false, error: e.message });
      }
    }

    const nextOffset = offset + (parts?.length || 0); // advance by rows fetched
    const remaining = (count || 0) - nextOffset;

     return NextResponse.json({
       success: successCount,
       failed: channels.length - successCount,
       total_processed: nextOffset,
       total_channels: count,
       processed_channels: channels,
       next_offset: nextOffset,
       remaining: Math.max(0, remaining),
       message: `Batch ${offset} - ${nextOffset} done.`
     });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
