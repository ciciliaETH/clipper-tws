import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(req: Request) {
  try {
    const supa = adminClient();
    const url = new URL(req.url);
    const startISO = url.searchParams.get('start') || '2025-08-01';
    const endISO = url.searchParams.get('end') || '2026-02-04';
    
    // Query TikTok historical data
    const { data: ttRows, error: ttErr } = await supa
      .from('weekly_historical_data')
      .select('week_label, start_date, end_date, platform, views, likes, comments, shares, saves')
      .eq('platform', 'tiktok')
      .gte('start_date', startISO)
      .lte('start_date', endISO)
      .order('start_date', { ascending: true });
    
    if (ttErr) {
      console.error('[weekly-historical] TikTok query error:', ttErr);
    }
    
    // Query Instagram historical data
    const { data: igRows, error: igErr } = await supa
      .from('weekly_historical_data')
      .select('week_label, start_date, end_date, platform, views, likes, comments')
      .eq('platform', 'instagram')
      .gte('start_date', startISO)
      .lte('start_date', endISO)
      .order('start_date', { ascending: true });
    
    if (igErr) {
      console.error('[weekly-historical] Instagram query error:', igErr);
    }
    
    // Query YouTube historical data
    const { data: ytRows, error: ytErr } = await supa
      .from('weekly_historical_data')
      .select('week_label, start_date, end_date, platform, views, likes, comments')
      .ilike('platform', 'youtube')
      .gte('start_date', startISO)
      .lte('start_date', endISO)
      .order('start_date', { ascending: true });
    
    if (ytErr) {
      console.error('[weekly-historical] YouTube query error:', ytErr);
    }
    
    return NextResponse.json({
      tiktok: ttRows || [],
      instagram: igRows || [],
      youtube: ytRows || [],
      start: startISO,
      end: endISO
    });
  } catch (e: any) {
    console.error('[weekly-historical] Error:', e);
    return NextResponse.json({ error: e.message || 'Unknown error' }, { status: 500 });
  }
}
