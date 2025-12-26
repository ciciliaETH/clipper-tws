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
    
    // Check active campaigns
    const today = new Date().toISOString().slice(0, 10);
    const { data: activeCampaigns } = await supa
      .from('campaigns')
      .select('id, title, start_date, end_date')
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('start_date', { ascending: false });
    
    // Check total campaign_participants
    const { count: totalParticipants } = await supa
      .from('campaign_participants')
      .select('*', { count: 'exact', head: true });
    
    // Check participants with TikTok username
    const { count: tiktokCount } = await supa
      .from('campaign_participants')
      .select('*', { count: 'exact', head: true })
      .not('tiktok_username', 'is', null);
    
    // Sample 10 participants
    const { data: sampleParticipants } = await supa
      .from('campaign_participants')
      .select('campaign_id, tiktok_username, instagram_username, last_refreshed')
      .limit(10);
    
    return NextResponse.json({
      campaigns: {
        total_active: activeCampaigns?.length || 0,
        list: activeCampaigns?.map(c => ({ id: c.id, title: c.title })) || []
      },
      participants: {
        total: totalParticipants || 0,
        with_tiktok: tiktokCount || 0,
        sample: sampleParticipants || []
      },
      issue: totalParticipants === 0 
        ? 'campaign_participants table is EMPTY - need to add employees to campaigns!' 
        : tiktokCount === 0
          ? 'Participants exist but tiktok_username is NULL - need to populate from user data'
          : 'Data looks OK'
    });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
