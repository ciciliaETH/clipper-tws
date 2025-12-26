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
    
    // Count Instagram participants
    const { count: totalIG } = await supa
      .from('campaign_instagram_participants')
      .select('*', { count: 'exact', head: true });
    
    const { count: withUsername } = await supa
      .from('campaign_instagram_participants')
      .select('*', { count: 'exact', head: true })
      .not('instagram_username', 'is', null);
    
    // Get sample
    const { data: sample } = await supa
      .from('campaign_instagram_participants')
      .select('instagram_username, campaign_id')
      .not('instagram_username', 'is', null)
      .limit(20);
    
    // Get unique usernames
    const unique = Array.from(new Set(
      (sample || []).map((r: any) => String(r.instagram_username || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
    ));
    
    // Check instagram_user_ids
    const { count: withUserId } = await supa
      .from('instagram_user_ids')
      .select('*', { count: 'exact', head: true })
      .not('instagram_user_id', 'is', null);
    
    return NextResponse.json({
      campaign_instagram_participants: {
        total: totalIG || 0,
        with_username: withUsername || 0,
        sample_count: sample?.length || 0,
        unique_usernames: unique.length,
        sample_usernames: unique.slice(0, 10)
      },
      instagram_user_ids: {
        total_with_user_id: withUserId || 0
      },
      issue: totalIG === 0 
        ? 'No Instagram participants found - need to add Instagram accounts to campaigns'
        : withUsername === 0
          ? 'Participants exist but instagram_username is NULL'
          : 'OK'
    });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
