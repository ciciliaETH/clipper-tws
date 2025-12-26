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

export async function GET(req: Request, context: any) {
  try {
    const { id } = await context.params as { id: string };
    const admin = adminClient();

    // 1. Get campaign info
    const { data: campaign } = await admin
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // 2. Get TikTok participants
    const { data: ttParts } = await admin
      .from('campaign_participants')
      .select('*')
      .eq('campaign_id', id);

    // 3. Get Instagram participants
    const { data: igParts } = await admin
      .from('campaign_instagram_participants')
      .select('*')
      .eq('campaign_id', id);

    // 4. Check TikTok posts_daily data
    const ttUsernames = (ttParts || []).map(p => String(p.tiktok_username).toLowerCase());
    let ttPostsCount = 0;
    let ttPostsSample: any[] = [];
    if (ttUsernames.length > 0) {
      const { data: ttPosts, count } = await admin
        .from('tiktok_posts_daily')
        .select('*', { count: 'exact' })
        .in('username', ttUsernames)
        .gte('post_date', campaign.start_date)
        .lte('post_date', campaign.end_date || new Date().toISOString().slice(0, 10))
        .limit(5);
      
      ttPostsCount = count || 0;
      ttPostsSample = ttPosts || [];
    }

    // 5. Check Instagram posts_daily data
    const igUsernames = (igParts || []).map(p => String(p.instagram_username).toLowerCase());
    let igPostsCount = 0;
    let igPostsSample: any[] = [];
    if (igUsernames.length > 0) {
      const { data: igPosts, count } = await admin
        .from('instagram_posts_daily')
        .select('*', { count: 'exact' })
        .in('username', igUsernames)
        .gte('post_date', campaign.start_date)
        .lte('post_date', campaign.end_date || new Date().toISOString().slice(0, 10))
        .limit(5);
      
      igPostsCount = count || 0;
      igPostsSample = igPosts || [];
    }

    // 6. Check campaign_participants_snapshot
    const { data: ttSnapshots, count: ttSnapshotCount } = await admin
      .from('campaign_participants_snapshot')
      .select('*', { count: 'exact' })
      .eq('campaign_id', id)
      .limit(5);

    // 7. Check campaign_instagram_participants_snapshot
    const { data: igSnapshots, count: igSnapshotCount } = await admin
      .from('campaign_instagram_participants_snapshot')
      .select('*', { count: 'exact' })
      .eq('campaign_id', id)
      .limit(5);

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        title: campaign.title,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        required_hashtags: campaign.required_hashtags
      },
      tiktok: {
        participants_count: ttParts?.length || 0,
        usernames: ttUsernames,
        posts_daily_count: ttPostsCount,
        posts_daily_sample: ttPostsSample,
        snapshot_count: ttSnapshotCount || 0,
        snapshot_sample: ttSnapshots || [],
        participants_data: ttParts || []
      },
      instagram: {
        participants_count: igParts?.length || 0,
        usernames: igUsernames,
        posts_daily_count: igPostsCount,
        posts_daily_sample: igPostsSample,
        snapshot_count: igSnapshotCount || 0,
        snapshot_sample: igSnapshots || [],
        participants_data: igParts || []
      },
      diagnosis: {
        tiktok_missing_posts: ttUsernames.length > 0 && ttPostsCount === 0,
        instagram_missing_posts: igUsernames.length > 0 && igPostsCount === 0,
        tiktok_no_participants: ttUsernames.length === 0,
        instagram_no_participants: igUsernames.length === 0,
        tiktok_missing_snapshots: (ttParts?.length || 0) > 0 && (ttSnapshotCount || 0) === 0,
        instagram_missing_snapshots: (igParts?.length || 0) > 0 && (igSnapshotCount || 0) === 0
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
