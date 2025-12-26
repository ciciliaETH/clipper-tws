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

export async function GET(req: Request) {
  try {
    const ok = await ensureAdmin();
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const supa = adminClient();
    const url = new URL(req.url);
    const campaignId = url.searchParams.get('campaign_id');
    
    // Get all active campaigns
    const today = new Date().toISOString().slice(0, 10);
    let campaignsQuery = supa
      .from('campaigns')
      .select('id, title, start_date, end_date, required_hashtags')
      .order('start_date', { ascending: false });
    
    if (campaignId) {
      campaignsQuery = campaignsQuery.eq('id', campaignId);
    } else {
      campaignsQuery = campaignsQuery.or(`end_date.is.null,end_date.gte.${today}`);
    }
    
    const { data: campaigns, error: campaignsError } = await campaignsQuery;
    
    if (campaignsError) {
      return NextResponse.json({ error: campaignsError.message }, { status: 500 });
    }
    
    if (!campaigns || campaigns.length === 0) {
      return NextResponse.json({ 
        error: 'No campaigns found',
        searched_for: campaignId || 'active campaigns'
      }, { status: 404 });
    }
    
    const diagnostics = [];
    
    for (const campaign of campaigns) {
      const cId = campaign.id;
      
      // Count TikTok participants
      const { data: ttParticipants, count: ttCount } = await supa
        .from('campaign_participants')
        .select('tiktok_username', { count: 'exact' })
        .eq('campaign_id', cId);
      
      // Count Instagram participants
      const { data: igParticipants, count: igCount } = await supa
        .from('campaign_instagram_participants')
        .select('instagram_username', { count: 'exact' })
        .eq('campaign_id', cId);
      
      // Count employee_groups (authorized employees)
      const { data: employeeGroups, count: egCount } = await supa
        .from('employee_groups')
        .select('employee_id', { count: 'exact' })
        .eq('campaign_id', cId);
      
      // Check how many TikTok participants have data in tiktok_posts_daily
      const ttUsernames = (ttParticipants || [])
        .map((p: any) => String(p.tiktok_username || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean);
      
      let ttWithData = 0;
      if (ttUsernames.length > 0) {
        const { count } = await supa
          .from('tiktok_posts_daily')
          .select('username', { count: 'exact', head: true })
          .in('username', ttUsernames)
          .gte('post_date', campaign.start_date);
        ttWithData = count || 0;
      }
      
      // Check how many Instagram participants have data in instagram_posts_daily
      const igUsernames = (igParticipants || [])
        .map((p: any) => String(p.instagram_username || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean);
      
      let igWithData = 0;
      if (igUsernames.length > 0) {
        const { count } = await supa
          .from('instagram_posts_daily')
          .select('username', { count: 'exact', head: true })
          .in('username', igUsernames)
          .gte('post_date', campaign.start_date);
        igWithData = count || 0;
      }
      
      // Get unique TikTok usernames with actual posts
      let ttUsernamesWithPosts: string[] = [];
      if (ttUsernames.length > 0) {
        const { data: postsData } = await supa
          .from('tiktok_posts_daily')
          .select('username')
          .in('username', ttUsernames)
          .gte('post_date', campaign.start_date);
        
        ttUsernamesWithPosts = Array.from(new Set(
          (postsData || []).map((p: any) => String(p.username).toLowerCase())
        ));
      }
      
      // Get unique Instagram usernames with actual posts
      let igUsernamesWithPosts: string[] = [];
      if (igUsernames.length > 0) {
        const { data: postsData } = await supa
          .from('instagram_posts_daily')
          .select('username')
          .in('username', igUsernames)
          .gte('post_date', campaign.start_date);
        
        igUsernamesWithPosts = Array.from(new Set(
          (postsData || []).map((p: any) => String(p.username).toLowerCase())
        ));
      }
      
      diagnostics.push({
        campaign_id: cId,
        campaign_title: campaign.title,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        required_hashtags: campaign.required_hashtags || null,
        tiktok: {
          participants_count: ttCount || 0,
          unique_usernames: ttUsernames.length,
          posts_count: ttWithData,
          usernames_with_posts: ttUsernamesWithPosts.length,
          missing_data: ttUsernames.filter(u => !ttUsernamesWithPosts.includes(u)),
          sample_usernames: ttUsernames.slice(0, 5)
        },
        instagram: {
          participants_count: igCount || 0,
          unique_usernames: igUsernames.length,
          posts_count: igWithData,
          usernames_with_posts: igUsernamesWithPosts.length,
          missing_data: igUsernames.filter(u => !igUsernamesWithPosts.includes(u)),
          sample_usernames: igUsernames.slice(0, 5)
        },
        employee_groups: {
          count: egCount || 0
        },
        issues: [] as string[]
      });
      
      // Add warnings
      const lastDiag = diagnostics[diagnostics.length - 1];
      if (ttCount === 0 && igCount === 0) {
        lastDiag.issues.push('NO_PARTICIPANTS: No TikTok or Instagram participants found');
      }
      if (ttCount && ttCount > 0 && ttWithData === 0) {
        lastDiag.issues.push('NO_TIKTOK_DATA: TikTok participants exist but no posts found in database');
      }
      if (igCount && igCount > 0 && igWithData === 0) {
        lastDiag.issues.push('NO_INSTAGRAM_DATA: Instagram participants exist but no posts found in database');
      }
      if (egCount === 0) {
        lastDiag.issues.push('NO_EMPLOYEE_GROUPS: No employees assigned to this campaign (accrual will be empty)');
      }
    }
    
    return NextResponse.json({
      total_campaigns: diagnostics.length,
      diagnostics,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('[diagnostics/campaigns] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Internal server error',
      details: error.toString()
    }, { status: 500 });
  }
}
