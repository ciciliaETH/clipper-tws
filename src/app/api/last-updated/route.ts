import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds to stay safe

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET() {
  try {
    const supa = adminClient();

    const [tt, ig, sm, hist] = await Promise.all([
      supa.from('tiktok_posts_daily').select('created_at').order('created_at', { ascending: false }).limit(1),
      supa.from('instagram_posts_daily').select('created_at').order('created_at', { ascending: false }).limit(1),
      supa.from('social_metrics').select('last_updated').order('last_updated', { ascending: false }).limit(1),
      supa.from('social_metrics_history').select('captured_at').order('captured_at', { ascending: false }).limit(1),
    ]);

    const times: number[] = [];
    const push = (v: any) => { const t = v ? Date.parse(String(v)) : NaN; if (!Number.isNaN(t)) times.push(t); };
    push(tt.data?.[0]?.created_at);
    push(ig.data?.[0]?.created_at);
    push(sm.data?.[0]?.last_updated);
    push(hist.data?.[0]?.captured_at);

    const latest = times.length ? new Date(Math.max(...times)) : new Date();
    return NextResponse.json({ last_updated: latest.toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
