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
    const today = new Date().toISOString().slice(0, 10);
    
    // Get ALL campaigns (no date filter)
    const { data: allCampaigns } = await supa
      .from('campaigns')
      .select('id, title, start_date, end_date, created_at')
      .order('created_at', { ascending: false });
    
    // Get active campaigns
    const { data: activeCampaigns } = await supa
      .from('campaigns')
      .select('id, title, start_date, end_date')
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('start_date', { ascending: false });
    
    // For each campaign, count participants
    const campaignsWithCounts = await Promise.all(
      (allCampaigns || []).map(async (c) => {
        const { count } = await supa
          .from('campaign_participants')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', c.id);
        
        return {
          ...c,
          participants_count: count || 0,
          is_active: c.end_date === null || c.end_date >= today,
          days_until_end: c.end_date ? Math.ceil((new Date(c.end_date).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)) : null
        };
      })
    );
    
    return NextResponse.json({
      today,
      total_campaigns: allCampaigns?.length || 0,
      active_campaigns: activeCampaigns?.length || 0,
      campaigns: campaignsWithCounts,
      issue: activeCampaigns?.length === 0 
        ? 'NO ACTIVE CAMPAIGNS - all campaigns have ended! Need to create new campaign or extend end_date'
        : 'OK'
    });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
