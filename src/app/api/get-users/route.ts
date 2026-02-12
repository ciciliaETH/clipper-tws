import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds to stay safe

export async function GET() {
  // Verify admin session first
  const supabaseSSR = await createSSR();
  const { data: { user } } = await supabaseSSR.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: me } = await supabaseSSR.from('users').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Use service_role key for admin operations
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Only show real employees/admins; hide auto-created 'umum' placeholders from fetch jobs
  const allowedRoles = ['karyawan','leader','admin','super_admin'];
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .in('role', allowedRoles)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error fetching users with admin client:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Attach extra TikTok and Instagram usernames (if any)
  try {
    const ids = (data || []).map((u: any) => u.id);
    if (ids.length) {
      const { data: extras } = await supabaseAdmin
        .from('user_tiktok_usernames')
        .select('user_id, tiktok_username')
        .in('user_id', ids);
      const { data: extrasIG } = await supabaseAdmin
        .from('user_instagram_usernames')
        .select('user_id, instagram_username')
        .in('user_id', ids);
      const { data: extrasYT } = await supabaseAdmin
        .from('user_youtube_channels')
        .select('user_id, youtube_channel_id')
        .in('user_id', ids);
      const { data: extrasYTUsernames } = await supabaseAdmin
        .from('user_youtube_usernames')
        .select('user_id, youtube_username')
        .in('user_id', ids);

      const map = new Map<string, string[]>();
      for (const r of extras || []) {
        const arr = map.get(r.user_id) || [];
        arr.push(String(r.tiktok_username));
        map.set(r.user_id, arr);
      }
      const mapIG = new Map<string, string[]>();
      for (const r of extrasIG || []) {
        const arr = mapIG.get(r.user_id) || [];
        arr.push(String(r.instagram_username));
        mapIG.set(r.user_id, arr);
      }
      const mapYT = new Map<string, string[]>();
      for (const r of extrasYT || []) {
        const arr = mapYT.get(r.user_id) || [];
        arr.push(String(r.youtube_channel_id));
        mapYT.set(r.user_id, arr);
      }
      const mapYTUsernames = new Map<string, string[]>();
      for (const r of extrasYTUsernames || []) {
        const arr = mapYTUsernames.get(r.user_id) || [];
        arr.push(String(r.youtube_username));
        mapYTUsernames.set(r.user_id, arr);
      }

      const withExtras = (data || []).map((u: any) => ({
        ...u,
        extra_tiktok_usernames: map.get(u.id) || [],
        extra_instagram_usernames: mapIG.get(u.id) || [],
        extra_youtube_channel_ids: mapYT.get(u.id) || [],
        extra_youtube_usernames: mapYTUsernames.get(u.id) || [],
      }));
      return NextResponse.json(withExtras);
    }
  } catch {}

  return NextResponse.json(data);
}
