import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const { username } = await req.json();
  const normalized = username.replace(/^@/, '').toLowerCase();

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .or(`tiktok_username.ilike.${normalized}`)
    .single();

  if (error || !data) {
    // Tetap return objek user minimal agar frontend bisa fetch ke /api/fetch-metrics/[username]
    return NextResponse.json({ username: normalized, full_name: normalized, tiktok_username: normalized, notFound: true });
  }

  return NextResponse.json(data);
}
