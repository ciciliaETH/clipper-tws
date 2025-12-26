
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const { user_id, start, end } = await req.json().catch(() => ({}));

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get username from user_id
  const { data: userData, error: userError } = await supabaseAdmin
    .from('users')
    .select('tiktok_username')
    .eq('id', user_id)
    .single();
  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const username = String(userData.tiktok_username || '').replace(/^@/, '').toLowerCase();
  if (!username) return NextResponse.json({ error: 'User has no tiktok_username' }, { status: 400 });

  // Aggregate strictly from DB only (no external fetch). UI should use refresh endpoint to update DB first.
  const startISO = start || new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
  const endISO = end || new Date().toISOString().slice(0,10);

  const { data: rows, error: aggErr } = await supabaseAdmin
    .from('tiktok_posts_daily')
    .select('play_count, digg_count, comment_count, share_count, save_count')
    .eq('username', username)
    .gte('post_date', startISO)
    .lte('post_date', endISO);
  if (aggErr) return NextResponse.json({ error: aggErr.message }, { status: 500 });

  let views = 0, likes = 0, comments = 0, shares = 0, saves = 0;
  for (const r of rows || []) {
    views += Number(r.play_count) || 0;
    likes += Number(r.digg_count) || 0;
    comments += Number(r.comment_count) || 0;
    shares += Number(r.share_count) || 0;
    saves += Number(r.save_count) || 0;
  }

  return NextResponse.json({ tiktok: { views, likes, comments, shares, saves, posts_total: (rows || []).length } });
}
