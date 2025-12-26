import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSSR } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds to stay safe

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function ensureAdmin() {
  const supabase = await createServerSSR();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}

export async function GET() {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const supa = adminClient();
    
    // 1. Check active campaigns
    const today = new Date().toISOString().slice(0, 10);
    const { data: activeCampaigns, error: campError } = await supa
      .from('campaigns')
      .select('id, title, start_date, end_date')
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('start_date', { ascending: false });
    
    // 2. Check total campaign_participants
    const { count: totalParticipants } = await supa
      .from('campaign_participants')
      .select('*', { count: 'exact', head: true });
    
    // 3. Check participants with TikTok username
    const { count: tiktokCount } = await supa
      .from('campaign_participants')
      .select('*', { count: 'exact', head: true })
      .not('tiktok_username', 'is', null);
    
    // 4. Check participants with Instagram username
    const { count: instagramCount } = await supa
      .from('campaign_participants')
      .select('*', { count: 'exact', head: true })
      .not('instagram_username', 'is', null);
    
    // 5. Sample 10 participants to check data structure
    const { data: sampleParticipants } = await supa
      .from('campaign_participants')
      .select('campaign_id, user_id, tiktok_username, instagram_username, last_refreshed')
      .limit(10);
    
    // 6. Check if there are users with TikTok/Instagram usernames in users table
    const { count: usersTikTokCount } = await supa
      .from('user_tiktok_usernames')
      .select('*', { count: 'exact', head: true });
    
    const { count: usersInstagramCount } = await supa
      .from('user_instagram_usernames')
      .select('*', { count: 'exact', head: true });
    
    // 7. Sample users data
    const { data: sampleUsers } = await supa
      .from('users')
      .select('id, email, role')
      .limit(5);
    
    const { data: sampleTikTokUsers } = await supa
      .from('user_tiktok_usernames')
      .select('user_id, username, sec_uid')
      .limit(5);
    
    const { data: sampleInstagramUsers } = await supa
      .from('user_instagram_usernames')
      .select('user_id, username, user_id_instagram')
      .limit(5);
    
    return NextResponse.json({
      status: 'ok',
      campaigns: {
        total_active: activeCampaigns?.length || 0,
        list: activeCampaigns || []
      },
      campaign_participants: {
        total: totalParticipants || 0,
        with_tiktok_username: tiktokCount || 0,
        with_instagram_username: instagramCount || 0,
        sample: sampleParticipants || []
      },
      users: {
        total_tiktok_usernames: usersTikTokCount || 0,
        total_instagram_usernames: usersInstagramCount || 0,
        sample_users: sampleUsers || [],
        sample_tiktok: sampleTikTokUsers || [],
        sample_instagram: sampleInstagramUsers || []
      },
      diagnosis: {
        issue_detected: (totalParticipants || 0) === 0 || (tiktokCount || 0) === 0,
        possible_causes: [
          (totalParticipants || 0) === 0 ? 'campaign_participants table is empty - no participants added to campaigns' : null,
          (tiktokCount || 0) === 0 && (totalParticipants || 0) > 0 ? 'Participants exist but tiktok_username not populated' : null,
          (usersTikTokCount || 0) === 0 ? 'user_tiktok_usernames table is empty - users have no TikTok accounts linked' : null,
        ].filter(Boolean),
        recommended_action: (totalParticipants || 0) === 0 
          ? 'Add participants to campaigns via admin panel or API'
          : (tiktokCount || 0) === 0 
            ? 'Populate tiktok_username in campaign_participants by joining with user_tiktok_usernames'
            : 'Data looks good, check refresh endpoint logic'
      }
    });
    
  } catch (error: any) {
    console.error('[check-participants] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Internal server error',
      details: error.toString()
    }, { status: 500 });
  }
}
