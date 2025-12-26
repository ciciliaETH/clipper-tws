import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';
import { endOfDay, parseISO, startOfDay } from 'date-fns';
import { hasRequiredHashtag } from '@/lib/hashtag-filter';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes - aggregates large datasets

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function ensureAdmin() {
  const supabase = await createSSR();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}

async function canViewCampaign(campaignId: string) {
  const supabase = await createSSR();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = data?.role;
  if (role === 'admin' || role === 'super_admin') return true;
  const admin = adminClient();
  const { data: eg } = await admin.from('employee_groups').select('employee_id').eq('campaign_id', campaignId).eq('employee_id', user.id).maybeSingle();
  return !!eg;
}

export async function GET(req: Request, context: any) {
  try {
    const { id } = await context.params;
    const allowed = await canViewCampaign(id);
    if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  // interval: daily | weekly | monthly (default: daily)
  const intervalParam = String(searchParams.get('interval') || 'daily').toLowerCase();
  const interval = (intervalParam === 'weekly' || intervalParam === 'monthly') ? intervalParam : 'daily';

    const supabaseAdmin = adminClient();

    // Get campaign
    const { data: campaign, error: cErr } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();
    if (cErr || !campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    
    const requiredHashtags = (campaign as any).required_hashtags || null;

    // allow date override via query
    let startISO = String(campaign.start_date);
    let endISO = campaign.end_date || new Date().toISOString().slice(0,10);
    if (searchParams.get('start')) startISO = String(searchParams.get('start'));
    if (searchParams.get('end')) endISO = String(searchParams.get('end'));
    const start = startOfDay(parseISO(startISO));
    const end = endOfDay(parseISO(endISO));

    // Get participants
    const { data: parts, error: pErr } = await supabaseAdmin
      .from('campaign_participants')
      .select('tiktok_username')
      .eq('campaign_id', id);
    if (pErr) throw pErr;

    const usernames = (parts || []).map((p: any) => p.tiktok_username);
    if (usernames.length === 0) {
      return NextResponse.json({ interval, start_date: start.toISOString(), end_date: end.toISOString(), totals: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }, series: [], participants: [] });
    }

    // SQL aggregation (fast) for chart
    const { data: seriesRows, error: sErr } = await supabaseAdmin
      .rpc('campaign_series_v2', {
        campaign: id,
        start_date: startISO,
        end_date: endISO,
        p_interval: interval,
      });
    if (sErr) throw sErr;

    // Top totals: prefer snapshot totals stored on campaign_participants; fallback to RPC if empty
    const { data: snapTotals, error: snapErr } = await supabaseAdmin
      .from('campaign_participants')
      .select('tiktok_username, views, likes, comments, shares, saves, posts_total')
      .eq('campaign_id', id);
    let participants: any[] = [];
    if (snapErr) console.warn('snapshot totals error', snapErr.message);
    const hasSnapshots = (snapTotals || []).some(r => r && (r.views || r.likes || r.comments || r.shares || r.saves));
    let totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 } as any;
    const overrideRange = !!(searchParams.get('start') || searchParams.get('end'));
    if (hasSnapshots && !overrideRange) {
      for (const r of snapTotals || []) {
        totals.views += Number(r.views) || 0;
        totals.likes += Number(r.likes) || 0;
        totals.comments += Number(r.comments) || 0;
        totals.shares += Number(r.shares) || 0;
        totals.saves += Number(r.saves) || 0;
      }
      // Build participant list from snapshots as well
      const { data: snapParts } = await supabaseAdmin
        .from('campaign_participants')
        .select('tiktok_username, views, likes, comments, shares, saves, posts_total')
        .eq('campaign_id', id);
      participants = (snapParts || []).map(r => ({
        username: r.tiktok_username,
        views: Number(r.views) || 0,
        likes: Number(r.likes) || 0,
        comments: Number(r.comments) || 0,
        shares: Number(r.shares) || 0,
        saves: Number(r.saves) || 0,
        posts: Number(r.posts_total) || 0,
      }));
    } else {
      const { data: partRows, error: prErr } = await supabaseAdmin
        .rpc('campaign_participant_totals_v2', {
          campaign: id,
          start_date: startISO,
          end_date: endISO,
        });
      if (prErr) throw prErr;
      participants = (partRows || []).map((r: any) => ({
        username: r.username,
        views: Number(r.views) || 0,
        likes: Number(r.likes) || 0,
        comments: Number(r.comments) || 0,
        shares: Number(r.shares) || 0,
        saves: Number(r.saves) || 0,
      }));
      totals = participants.reduce((acc: any, cur: any) => ({
        views: acc.views + cur.views,
        likes: acc.likes + cur.likes,
        comments: acc.comments + cur.comments,
        shares: acc.shares + cur.shares,
        saves: acc.saves + cur.saves,
      }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
    }

    // Enrich participants with posts count only (trend removed for performance/UI simplification)
    try {
      const usernameList = participants.map(p => String(p.username).toLowerCase());
      if (usernameList.length) {
        const endStr = endISO;
        const { data: postsRows } = await supabaseAdmin
          .from('tiktok_posts_daily')
          .select('username, video_id')
          .in('username', usernameList)
          .gte('post_date', startISO)
          .lte('post_date', endStr);
        const postCount = new Map<string, number>();
        for (const r of postsRows || []) postCount.set(String(r.username), (postCount.get(String(r.username))||0)+1);
        participants = participants.map(p => {
          const u = String(p.username).toLowerCase();
          return { ...p, posts: p.posts ?? (postCount.get(u)||0) };
        });
      }
    } catch(e) {
      console.warn('posts enrich error', e);
    }

    // Apply hashtag filtering if required
    if (requiredHashtags && requiredHashtags.length > 0) {
      try {
        // Build set of usernames that have at least one matching post
        const validUsernames = new Set<string>();
        
        // Check TikTok posts
        const ttUsernames = participants.map(p => String(p.username).toLowerCase());
        if (ttUsernames.length > 0) {
          const { data: ttPosts } = await supabaseAdmin
            .from('tiktok_posts_daily')
            .select('username, title')
            .in('username', ttUsernames)
            .gte('post_date', startISO)
            .lte('post_date', endISO);
          for (const post of ttPosts || []) {
            const title = String((post as any).title || '');
            if (hasRequiredHashtag(title, requiredHashtags)) {
              validUsernames.add(String((post as any).username).toLowerCase());
            }
          }
        }
        
        // Check Instagram posts (determine IG usernames first)
        let igUsernames: string[] = [];
        try {
          const { data: igParts } = await supabaseAdmin
            .from('campaign_instagram_participants')
            .select('instagram_username')
            .eq('campaign_id', id);
          igUsernames = (igParts || []).map((r:any)=> String(r.instagram_username).toLowerCase()).filter(Boolean);
        } catch {}
        
        if (igUsernames.length > 0) {
          const { data: igPosts } = await supabaseAdmin
            .from('instagram_posts_daily')
            .select('username, caption')
            .in('username', igUsernames)
            .gte('post_date', startISO)
            .lte('post_date', endISO);
          for (const post of igPosts || []) {
            const caption = String((post as any).caption || '');
            if (hasRequiredHashtag(caption, requiredHashtags)) {
              validUsernames.add(String((post as any).username).toLowerCase());
            }
          }
        }
        
        // Filter participants to only those with valid posts
        participants = participants.filter(p => validUsernames.has(String(p.username).toLowerCase()));
        
        // Recalculate totals after filtering
        totals = participants.reduce((acc: any, cur: any) => ({
          views: acc.views + cur.views,
          likes: acc.likes + cur.likes,
          comments: acc.comments + cur.comments,
          shares: acc.shares + cur.shares,
          saves: acc.saves + cur.saves,
        }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
      } catch(e) {
        console.warn('hashtag filtering error', e);
      }
    }

    let seriesTikTok = (seriesRows || []).map((r: any) => ({
      date: String(r.bucket_date),
      views: Number(r.views) || 0,
      likes: Number(r.likes) || 0,
      comments: Number(r.comments) || 0,
      shares: Number(r.shares) || 0,
      saves: Number(r.saves) || 0,
    }));

    // Instagram series aggregation from instagram_posts_daily
    let seriesInstagram: any[] = [];
    try {
      // Determine IG usernames for this campaign: prefer campaign_instagram_participants if any exist
      let igUsernames: string[] = [];
      try {
        const { data: igParts } = await supabaseAdmin
          .from('campaign_instagram_participants')
          .select('instagram_username')
          .eq('campaign_id', id);
        igUsernames = (igParts || []).map((r:any)=> String(r.instagram_username)).filter(Boolean);
      } catch {}
      // If IG list kosong, coba ambil dari employee_instagram_participants
      if (!igUsernames.length) {
        try {
          const { data: empIg } = await supabaseAdmin
            .from('employee_instagram_participants')
            .select('instagram_username')
            .eq('campaign_id', id);
          igUsernames = (empIg||[]).map((r:any)=> String(r.instagram_username)).filter(Boolean);
        } catch {}
      }
      // Jika masih kosong, turunkan dari pemilik TikTok usernames → (users.instagram_username + user_instagram_usernames)
      if (!igUsernames.length) {
        try {
          const tiktokLc = (usernames || []).map((u:string)=> String(u).replace(/^@/, '').toLowerCase());
          const ownerIds = new Set<string>();
          if (tiktokLc.length) {
            // Map via explicit mapping table
            const { data: mapRows } = await supabaseAdmin
              .from('user_tiktok_usernames')
              .select('user_id, username')
              .in('username', tiktokLc);
            for (const r of mapRows || []) ownerIds.add(String((r as any).user_id));
            // Also check users.tiktok_username direct field
            const { data: userRows } = await supabaseAdmin
              .from('users')
              .select('id, tiktok_username')
              .in('tiktok_username', tiktokLc);
            for (const r of userRows || []) ownerIds.add(String((r as any).id));
          }
          if (ownerIds.size) {
            // Collect instagram handles from owners
            const ids = Array.from(ownerIds);
            const { data: igMap } = await supabaseAdmin
              .from('user_instagram_usernames')
              .select('instagram_username, user_id')
              .in('user_id', ids);
            const { data: igUsers } = await supabaseAdmin
              .from('users')
              .select('instagram_username, id')
              .in('id', ids);
            const set = new Set<string>();
            for (const r of igMap || []) if ((r as any).instagram_username) set.add(String((r as any).instagram_username));
            for (const r of igUsers || []) if ((r as any).instagram_username) set.add(String((r as any).instagram_username));
            if (set.size) igUsernames = Array.from(set);
          }
        } catch {}
      }
      // Terakhir, jika tetap kosong, turunkan dari anggota campaign (employee_groups)
      if (!igUsernames.length) {
        try {
          const { data: eg } = await supabaseAdmin
            .from('employee_groups')
            .select('employee_id')
            .eq('campaign_id', id);
          const empIds = Array.from(new Set((eg||[]).map((r:any)=> String(r.employee_id))));
          if (empIds.length) {
            const { data: igMap } = await supabaseAdmin
              .from('user_instagram_usernames')
              .select('instagram_username, user_id')
              .in('user_id', empIds);
            const { data: igUsers } = await supabaseAdmin
              .from('users')
              .select('instagram_username, id')
              .in('id', empIds);
            const set = new Set<string>();
            for (const r of igMap||[]) if ((r as any).instagram_username) set.add(String((r as any).instagram_username));
            for (const r of igUsers||[]) if ((r as any).instagram_username) set.add(String((r as any).instagram_username));
            if (set.size) igUsernames = Array.from(set);
          }
        } catch {}
      }
      const usernamesLc = (igUsernames.length ? igUsernames : usernames)
        .map((u:string)=> String(u).trim().replace(/^@+/, '').toLowerCase())
        .filter(Boolean);
      if (usernamesLc.length) {
        if (interval === 'monthly') {
          const { data: rows } = await supabaseAdmin
            .from('instagram_posts_daily')
            .select('post_date, play_count, like_count, comment_count, username')
            .in('username', usernamesLc)
            .gte('post_date', startISO)
            .lte('post_date', endISO);
          const map = new Map<string,{views:number;likes:number;comments:number}>();
          for (const r of rows||[]) {
            const d = new Date(String((r as any).post_date)+'T00:00:00Z');
            const key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0,10);
            const cur = map.get(key) || { views:0, likes:0, comments:0 };
            cur.views += Number((r as any).play_count)||0;
            cur.likes += Number((r as any).like_count)||0;
            cur.comments += Number((r as any).comment_count)||0;
            map.set(key, cur);
          }
          seriesInstagram = Array.from(map.entries()).map(([date,v])=>({ date, views:v.views, likes:v.likes, comments:v.comments, shares:0, saves:0 })).sort((a,b)=> a.date.localeCompare(b.date));
        } else if (interval === 'weekly') {
          const { data: rows } = await supabaseAdmin
            .from('instagram_posts_daily')
            .select('post_date, play_count, like_count, comment_count, username')
            .in('username', usernamesLc)
            .gte('post_date', startISO)
            .lte('post_date', endISO);
          const map = new Map<string,{views:number;likes:number;comments:number}>();
          for (const r of rows||[]) {
            const d = new Date(String((r as any).post_date)+'T00:00:00Z');
            const day = d.getUTCDay();
            const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((day+6)%7));
            const key = monday.toISOString().slice(0,10);
            const cur = map.get(key) || { views:0, likes:0, comments:0 };
            cur.views += Number((r as any).play_count)||0;
            cur.likes += Number((r as any).like_count)||0;
            cur.comments += Number((r as any).comment_count)||0;
            map.set(key, cur);
          }
          seriesInstagram = Array.from(map.entries()).map(([date,v])=>({ date, views:v.views, likes:v.likes, comments:v.comments, shares:0, saves:0 })).sort((a,b)=> a.date.localeCompare(b.date));
        } else {
          const { data: rows } = await supabaseAdmin
            .from('instagram_posts_daily')
            .select('post_date, play_count, like_count, comment_count, username')
            .in('username', usernamesLc)
            .gte('post_date', startISO)
            .lte('post_date', endISO);
          const map = new Map<string,{views:number;likes:number;comments:number}>();
          for (const r of rows||[]) {
            const key = String((r as any).post_date);
            const cur = map.get(key) || { views:0, likes:0, comments:0 };
            cur.views += Number((r as any).play_count)||0;
            cur.likes += Number((r as any).like_count)||0;
            cur.comments += Number((r as any).comment_count)||0;
            map.set(key, cur);
          }
          seriesInstagram = Array.from(map.entries()).map(([date,v])=>({ date, views:v.views, likes:v.likes, comments:v.comments, shares:0, saves:0 })).sort((a,b)=> a.date.localeCompare(b.date));
        }
      }
    } catch(e) { console.warn('instagram series error', e); }

    // Fallback when RPC returns kosong/semua nol: hitung langsung dari tiktok_posts_daily
    try {
      const allZero = seriesTikTok.length === 0 || seriesTikTok.every(s => (s.views+s.likes+s.comments+s.shares+s.saves) === 0);
      // Fallback grouping only for daily; weekly/monthly rely on RPC
      if (interval === 'daily' && allZero) {
        // Ambil daftar username campaign (lowercase, tanpa @)
        const { data: parts } = await supabaseAdmin
          .from('campaign_participants')
          .select('tiktok_username')
          .eq('campaign_id', id);
        const usernames = (parts || []).map((p:any)=> String(p.tiktok_username).replace(/^@/, '').toLowerCase());
        if (usernames.length) {
          // Aggregasi harian langsung dari tiktok_posts_daily
          const { data: rows } = await supabaseAdmin
            .from('tiktok_posts_daily')
            .select('post_date, play_count, digg_count, comment_count, share_count, save_count')
            .in('username', usernames)
            .gte('post_date', startISO)
            .lte('post_date', endISO)
            .order('post_date', { ascending: true });
          const byDate = new Map<string, { views:number, likes:number, comments:number, shares:number, saves:number }>();
          for (const r of rows || []) {
            const d = String((r as any).post_date);
            const cur = byDate.get(d) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            cur.views += Number((r as any).play_count)||0;
            cur.likes += Number((r as any).digg_count)||0;
            cur.comments += Number((r as any).comment_count)||0;
            cur.shares += Number((r as any).share_count)||0;
            cur.saves += Number((r as any).save_count)||0;
            byDate.set(d, cur);
          }
          // zero-fill tanggal
          const filled: any[] = [];
          const ds = start.toISOString().slice(0,10);
          const de = end.toISOString().slice(0,10);
          const curDate = new Date(ds + 'T00:00:00Z');
          const lastDate = new Date(de + 'T00:00:00Z');
          for (let d=new Date(curDate); d <= lastDate; d.setDate(d.getDate()+1)) {
            const key = d.toISOString().slice(0,10);
            const v = byDate.get(key) || { views:0, likes:0, comments:0, shares:0, saves:0 };
            filled.push({ date: key, ...v });
          }
          seriesTikTok = filled;
        }
      }
    } catch(e) {
      console.warn('series fallback error', e);
    }

    // Zero-fill buckets for all intervals so chart ALWAYS starts from selected start date
    try {
      const buildKeys = (mode: 'daily'|'weekly'|'monthly'): string[] => {
        const keys: string[] = [];
        const ds = new Date(start.toISOString().slice(0,10)+'T00:00:00Z');
        const de = new Date(end.toISOString().slice(0,10)+'T00:00:00Z');
        if (mode === 'daily') {
          for (let d = new Date(ds); d <= de; d.setUTCDate(d.getUTCDate()+1)) {
            keys.push(d.toISOString().slice(0,10));
          }
        } else if (mode === 'weekly') {
          // Align to Monday for the first bucket
          const d = new Date(ds);
          const day = d.getUTCDay();
          const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((day+6)%7));
          for (let w = new Date(monday); w <= de; w.setUTCDate(w.getUTCDate()+7)) {
            keys.push(w.toISOString().slice(0,10));
          }
        } else { // monthly
          const mStart = new Date(Date.UTC(ds.getUTCFullYear(), ds.getUTCMonth(), 1));
          const mEnd = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), 1));
          for (let d = new Date(mStart); d <= mEnd; d.setUTCMonth(d.getUTCMonth()+1)) {
            keys.push(d.toISOString().slice(0,10));
          }
        }
        return keys;
      };

      const fill = (arr: any[], mode: 'daily'|'weekly'|'monthly') => {
        const map = new Map<string, any>();
        for (const s of arr||[]) map.set(String(s.date), s);
        const keys = buildKeys(mode);
        const filled: any[] = [];
        for (const k of keys) {
          filled.push(map.get(k) || { date: k, views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
        }
        return filled;
      };

      seriesTikTok = fill(seriesTikTok, interval);
      seriesInstagram = fill(seriesInstagram, interval);
    } catch {}

    // Build total series = TikTok + Instagram on same bucket
    const mergeMap = new Map<string, { date:string; views:number; likes:number; comments:number; shares:number; saves:number }>();
    const pushSeries = (arr:any[]) => {
      for (const s of arr||[]) {
        const cur = mergeMap.get(s.date) || { date: s.date, views:0, likes:0, comments:0, shares:0, saves:0 };
        cur.views += Number(s.views)||0; cur.likes += Number(s.likes)||0; cur.comments += Number(s.comments)||0; cur.shares += Number(s.shares)||0; cur.saves += Number(s.saves)||0;
        mergeMap.set(s.date, cur);
      }
    };
    pushSeries(seriesTikTok); pushSeries(seriesInstagram);
    const seriesTotal = Array.from(mergeMap.values()).sort((a,b)=> a.date.localeCompare(b.date));

    // Recalculate totals from series to ensure consistency with chart values
    try {
      const sum = (arr:any[]) => arr.reduce((acc:any, s:any) => ({
        views: acc.views + (Number(s.views)||0),
        likes: acc.likes + (Number(s.likes)||0),
        comments: acc.comments + (Number(s.comments)||0),
        shares: acc.shares + (Number(s.shares)||0),
        saves: acc.saves + (Number(s.saves)||0),
      }), { views:0, likes:0, comments:0, shares:0, saves:0 });
      const s = sum(seriesTotal);
      totals = s;
    } catch {}

    return NextResponse.json({ 
      interval, 
      start_date: start.toISOString(), 
      end_date: end.toISOString(), 
      totals, 
      series_total: seriesTotal, 
      series_tiktok: seriesTikTok, 
      series_instagram: seriesInstagram, 
      participants,
      required_hashtags: requiredHashtags,
      filtered_by_hashtag: requiredHashtags && requiredHashtags.length > 0
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
