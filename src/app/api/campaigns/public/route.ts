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

// Public endpoint - returns campaigns that have required_hashtags (for leaderboard filter)
export async function GET() {
  try {
    const supabase = adminClient();
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, required_hashtags, start_date, end_date')
      .not('required_hashtags', 'is', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Filter out campaigns where required_hashtags is empty array
    const filtered = (data || []).filter(
      (c: any) => Array.isArray(c.required_hashtags) && c.required_hashtags.length > 0
    );

    return NextResponse.json(filtered);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
