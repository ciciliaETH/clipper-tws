import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hasRequiredHashtag } from '@/lib/hashtag-filter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Paginated fetch: keeps fetching pages until all rows are retrieved.
// This bypasses Supabase/PostgREST max-rows server limit which silently
// truncates results even when .limit() is set higher.
// IMPORTANT: The caller MUST include .order() with a stable (unique) secondary
// sort column in the query builder to prevent rows being skipped across pages.
const PAGE_SIZE = 10000

async function fetchAllPages(queryFn: () => any): Promise<any[]> {
  const all: any[] = []
  let offset = 0
  while (true) {
    const { data, error } = await queryFn().range(offset, offset + PAGE_SIZE - 1)
    if (error) { console.error('[PAGINATE] error:', error.message); break }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break // last page
    offset += PAGE_SIZE
  }
  return all
}

// Fetch a reference table that might exceed Supabase default 1000 row limit
async function fetchAllRef(queryFn: () => any): Promise<any[]> {
  const all: any[] = []
  let offset = 0
  const size = 5000
  while (true) {
    const { data, error } = await queryFn().range(offset, offset + size - 1)
    if (error) break
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < size) break
    offset += size
  }
  return all
}

export async function GET(req: Request, context: any) {
  try {
    const { id: campaignId } = await context.params as { id: string }
    if (!campaignId) return NextResponse.json({ error: 'campaign id required' }, { status: 400 })

    const url = new URL(req.url)
    const platform = (url.searchParams.get('platform') || 'all').toLowerCase()
    const startDate = url.searchParams.get('start') || ''
    const endDate = url.searchParams.get('end') || ''
    const extraHashtag = url.searchParams.get('hashtag') || ''
    const summaryOnly = url.searchParams.get('summary') === '1'
    const employeesOnly = url.searchParams.get('employees_only') === '1'

    const supabase = supabaseAdmin()

    // 1. Get campaign info + required_hashtags
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id, name, required_hashtags, start_date, end_date')
      .eq('id', campaignId)
      .single()
    if (campErr || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    const requiredHashtags: string[] | null = (campaign as any).required_hashtags || null

    // 2. Get employees in this campaign (paginated to avoid 1000 row default limit)
    const empRows = await fetchAllRef(
      () => supabase.from('employee_groups').select('employee_id').eq('campaign_id', campaignId)
    )
    const employeeIds = empRows.map((e: any) => String(e.employee_id))
    if (employeeIds.length === 0) {
      return NextResponse.json({
        campaign: { id: campaign.id, name: campaign.name, required_hashtags: requiredHashtags },
        videos: [], count: 0
      })
    }

    // 3. Resolve all platform usernames (paginated reference queries)
    const users = await fetchAllRef(
      () => supabase.from('users').select('id, full_name, username, tiktok_username, instagram_username').in('id', employeeIds)
    )

    // Employee-level assignments (filtered by campaign_id to match members API)
    const ttAliases = await fetchAllRef(() => supabase.from('user_tiktok_usernames').select('user_id, tiktok_username').in('user_id', employeeIds))
    const igAliases = await fetchAllRef(() => supabase.from('user_instagram_usernames').select('user_id, instagram_username').in('user_id', employeeIds))
    const ttEmpParts = await fetchAllRef(() => supabase.from('employee_participants').select('employee_id, tiktok_username').in('employee_id', employeeIds).eq('campaign_id', campaignId))
    const igEmpParts = await fetchAllRef(() => supabase.from('employee_instagram_participants').select('employee_id, instagram_username').in('employee_id', employeeIds).eq('campaign_id', campaignId))

    // Campaign-level participants (same source as members API fallback)
    const campTT = await fetchAllRef(() => supabase.from('campaign_participants').select('tiktok_username').eq('campaign_id', campaignId))
    const campIG = await fetchAllRef(() => supabase.from('campaign_instagram_participants').select('instagram_username').eq('campaign_id', campaignId))

    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/^@+/, '')
    const userMap = new Map<string, string>()
    // Store BOTH normalized and original-case usernames to handle case-sensitivity in DB
    const ttUserToId = new Map<string, string>()
    const ttOriginalCase = new Set<string>() // track original-case usernames
    const igUserToId = new Map<string, string>()
    const igOriginalCase = new Set<string>()
    const ytChannelToId = new Map<string, string>()

    for (const u of users) {
      userMap.set(u.id, (u as any).full_name || (u as any).username || (u as any).tiktok_username || u.id)
      if ((u as any).tiktok_username) {
        ttUserToId.set(norm((u as any).tiktok_username), u.id)
        ttOriginalCase.add(String((u as any).tiktok_username).trim())
      }
      if ((u as any).instagram_username) {
        igUserToId.set(norm((u as any).instagram_username), u.id)
        igOriginalCase.add(String((u as any).instagram_username).trim())
      }
    }
    for (const a of ttAliases) { if (a.tiktok_username) { ttUserToId.set(norm(a.tiktok_username), a.user_id); ttOriginalCase.add(String(a.tiktok_username).trim()) } }
    for (const a of igAliases) { if (a.instagram_username) { igUserToId.set(norm(a.instagram_username), a.user_id); igOriginalCase.add(String(a.instagram_username).trim()) } }
    for (const a of ttEmpParts) { if (a.tiktok_username) { ttUserToId.set(norm(a.tiktok_username), a.employee_id); ttOriginalCase.add(String(a.tiktok_username).trim()) } }
    for (const a of igEmpParts) { if (a.instagram_username) { igUserToId.set(norm(a.instagram_username), a.employee_id); igOriginalCase.add(String(a.instagram_username).trim()) } }
    // Add campaign-level participants only when NOT filtering to group employees only
    if (!employeesOnly) {
      for (const r of campTT) {
        const u = (r as any).tiktok_username
        if (u) { const n = norm(u); if (!ttUserToId.has(n)) ttUserToId.set(n, 'campaign'); ttOriginalCase.add(String(u).trim()) }
      }
      for (const r of campIG) {
        const u = (r as any).instagram_username
        if (u) { const n = norm(u); if (!igUserToId.has(n)) igUserToId.set(n, 'campaign'); igOriginalCase.add(String(u).trim()) }
      }
    }

    // Build username arrays for querying: include BOTH normalized AND original case
    // to handle case-sensitive .in() filter in PostgreSQL
    const buildUsernameSet = (normalized: Map<string, string>, original: Set<string>): string[] => {
      const all = new Set<string>()
      for (const k of normalized.keys()) all.add(k)
      for (const o of original) all.add(o)
      return Array.from(all).filter(Boolean)
    }

    // Date range defaults
    const now = new Date()
    const defaultStart = new Date()
    defaultStart.setUTCDate(defaultStart.getUTCDate() - 30)
    const startISO = startDate || defaultStart.toISOString().slice(0, 10)
    const endISO = endDate || now.toISOString().slice(0, 10)

    const videos: any[] = []

    // === TIKTOK ===
    // TWO queries: posts WITH taken_at + posts with NULL taken_at (fallback to created_at)
    if (platform === 'all' || platform === 'tiktok') {
      const ttUsernames = buildUsernameSet(ttUserToId, ttOriginalCase)
      if (ttUsernames.length > 0) {
        // Query 1: Posts WITH taken_at
        const ttPostsWithDate = await fetchAllPages(
          () => supabase
            .from('tiktok_posts_daily')
            .select('video_id, username, taken_at, title, play_count, digg_count, comment_count, share_count, save_count')
            .in('username', ttUsernames)
            .not('taken_at', 'is', null)
            .gte('taken_at', startISO + 'T00:00:00Z')
            .lte('taken_at', endISO + 'T23:59:59Z')
            .order('play_count', { ascending: false })
            .order('video_id', { ascending: true })
        )

        // Query 2: Posts WITHOUT taken_at (fallback to post_date or created_at)
        let ttPostsNoDate: any[] = []
        try {
          ttPostsNoDate = await fetchAllPages(
            () => supabase
              .from('tiktok_posts_daily')
              .select('video_id, username, taken_at, title, play_count, digg_count, comment_count, share_count, save_count, created_at')
              .in('username', ttUsernames)
              .is('taken_at', null)
              .order('play_count', { ascending: false })
              .order('video_id', { ascending: true })
          )
        } catch {} // column might not exist

        const ttPosts = [...ttPostsWithDate, ...ttPostsNoDate]
        console.log(`[VIDEOS] TikTok: fetched ${ttPosts.length} raw rows (${ttPostsWithDate.length} with taken_at, ${ttPostsNoDate.length} without) for ${ttUsernames.length} usernames`)

        // Deduplicate: keep first occurrence per video_id (= highest play_count due to order)
        const seen = new Map<string, any>()
        for (const p of ttPosts) {
          const vid = String(p.video_id)
          if (vid && !seen.has(vid)) seen.set(vid, p)
        }

        console.log(`[VIDEOS] TikTok: ${seen.size} unique videos after dedup`)

        let hashtagFiltered = 0
        const hashtagFilteredSamples: string[] = []
        for (const [videoId, row] of seen.entries()) {
          if (!hasRequiredHashtag(row.title, requiredHashtags)) {
            hashtagFiltered++
            // Log first 5 filtered videos for debugging
            if (hashtagFilteredSamples.length < 5) {
              hashtagFilteredSamples.push(`${videoId} (${row.username}, ${Number(row.play_count||0).toLocaleString()} views): "${(row.title||'').slice(0,80)}"`)
            }
            continue
          }
          if (extraHashtag && !hasRequiredHashtag(row.title, [extraHashtag])) { hashtagFiltered++; continue }

          const ownerId = ttUserToId.get(norm(row.username)) || null
          const ownerName = ownerId && userMap.has(ownerId) ? userMap.get(ownerId)! : row.username

          videos.push({
            platform: 'tiktok',
            id: videoId,
            username: row.username,
            owner_name: ownerName,
            title: row.title || '',
            caption: row.title || '',
            taken_at: row.taken_at,
            link: `https://www.tiktok.com/@${row.username}/video/${videoId}`,
            views: Number(row.play_count || 0),
            likes: Number(row.digg_count || 0),
            comments: Number(row.comment_count || 0),
            shares: Number(row.share_count || 0),
          })
        }
        if (hashtagFiltered > 0) {
          console.log(`[VIDEOS] TikTok: ${hashtagFiltered} videos EXCLUDED by hashtag filter (required: ${JSON.stringify(requiredHashtags)})`)
          console.log(`[VIDEOS] TikTok: Sample excluded videos:`)
          hashtagFilteredSamples.forEach(s => console.log(`  - ${s}`))
        }
      }
    }

    // === INSTAGRAM ===
    // TWO queries: posts WITH taken_at + posts with NULL taken_at (fallback to created_at)
    if (platform === 'all' || platform === 'instagram') {
      const igUsernames = buildUsernameSet(igUserToId, igOriginalCase)
      if (igUsernames.length > 0) {
        // Query 1: Posts WITH taken_at
        const igPostsWithDate = await fetchAllPages(
          () => supabase
            .from('instagram_posts_daily')
            .select('id, code, username, taken_at, caption, play_count, like_count, comment_count')
            .in('username', igUsernames)
            .not('taken_at', 'is', null)
            .gte('taken_at', startISO + 'T00:00:00Z')
            .lte('taken_at', endISO + 'T23:59:59Z')
            .order('play_count', { ascending: false })
            .order('id', { ascending: true })
        )

        // Query 2: Posts WITHOUT taken_at (fallback to created_at)
        const igPostsNoDate = await fetchAllPages(
          () => supabase
            .from('instagram_posts_daily')
            .select('id, code, username, taken_at, caption, play_count, like_count, comment_count, created_at')
            .in('username', igUsernames)
            .is('taken_at', null)
            .gte('created_at', startISO + 'T00:00:00Z')
            .lte('created_at', endISO + 'T23:59:59Z')
            .order('play_count', { ascending: false })
            .order('id', { ascending: true })
        )

        const igPosts = [...igPostsWithDate, ...igPostsNoDate]
        console.log(`[VIDEOS] Instagram: fetched ${igPosts.length} raw rows (${igPostsWithDate.length} with taken_at, ${igPostsNoDate.length} without) for ${igUsernames.length} usernames`)

        // Deduplicate: keep first occurrence per id (= highest play_count)
        const seen = new Map<string, any>()
        for (const p of igPosts) {
          const vid = String(p.id)
          if (vid && !seen.has(vid)) seen.set(vid, p)
        }

        console.log(`[VIDEOS] Instagram: ${seen.size} unique videos after dedup`)

        let hashtagFiltered = 0
        for (const [postId, row] of seen.entries()) {
          if (!hasRequiredHashtag(row.caption, requiredHashtags)) { hashtagFiltered++; continue }
          if (extraHashtag && !hasRequiredHashtag(row.caption, [extraHashtag])) { hashtagFiltered++; continue }

          const ownerId = igUserToId.get(norm(row.username)) || null
          const ownerName = ownerId && userMap.has(ownerId) ? userMap.get(ownerId)! : row.username

          // Use taken_at if available, otherwise created_at
          const postDate = row.taken_at || (row as any).created_at

          videos.push({
            platform: 'instagram',
            id: postId,
            username: row.username,
            owner_name: ownerName,
            title: row.caption || '',
            caption: row.caption || '',
            taken_at: postDate,
            link: `https://www.instagram.com/reel/${row.code || postId}/`,
            views: Number(row.play_count || 0),
            likes: Number(row.like_count || 0),
            comments: Number(row.comment_count || 0),
            shares: 0,
          })
        }
        if (hashtagFiltered > 0) console.log(`[VIDEOS] Instagram: ${hashtagFiltered} videos filtered by hashtag requirement`)
      }
    }

    // === YOUTUBE ===
    if (platform === 'all' || platform === 'youtube') {
      const channels: string[] = []
      for (const u of users) {
        const cid = (u as any).youtube_channel_id; if (cid) channels.push(String(cid).trim())
      }
      if (employeeIds.length > 0) {
        const ytMap = await fetchAllRef(() => supabase.from('user_youtube_channels').select('user_id, youtube_channel_id').in('user_id', employeeIds))
        for (const r of ytMap) {
          const cid = (r as any).youtube_channel_id; if (cid) { channels.push(String(cid).trim()); ytChannelToId.set(String(cid).trim(), (r as any).user_id) }
        }
        const ytEmp = await fetchAllRef(() => supabase.from('employee_youtube_participants').select('employee_id, youtube_channel_id').in('employee_id', employeeIds).eq('campaign_id', campaignId))
        for (const r of ytEmp) {
          const cid = (r as any).youtube_channel_id; if (cid) { channels.push(String(cid).trim()); ytChannelToId.set(String(cid).trim(), (r as any).employee_id) }
        }
      }
      // Campaign-level YouTube participants
      if (!employeesOnly) {
        try {
          const campYT = await fetchAllRef(() => supabase.from('campaign_youtube_participants').select('youtube_channel_id').eq('campaign_id', campaignId))
          for (const r of campYT) {
            const cid = (r as any).youtube_channel_id; if (cid) channels.push(String(cid).trim())
          }
        } catch {} // table might not exist
      }
      const uniqueChannels = Array.from(new Set(channels.filter(Boolean)))
      if (uniqueChannels.length > 0) {
        const ytRows = await fetchAllPages(
          () => supabase
            .from('youtube_posts_daily')
            .select('video_id, channel_id, post_date, title, views, likes, comments')
            .in('channel_id', uniqueChannels)
            .gte('post_date', startISO)
            .lte('post_date', endISO)
            .order('views', { ascending: false })
            .order('video_id', { ascending: true })
        )

        console.log(`[VIDEOS] YouTube: fetched ${ytRows.length} raw rows for ${uniqueChannels.length} channels`)

        // Deduplicate: keep first occurrence per video_id (= highest views)
        const seen = new Map<string, any>()
        for (const r of ytRows) {
          const vid = String((r as any).video_id)
          if (vid && !seen.has(vid)) seen.set(vid, r)
        }

        console.log(`[VIDEOS] YouTube: ${seen.size} unique videos after dedup`)

        let hashtagFiltered = 0
        for (const [vid, row] of seen.entries()) {
          if (!hasRequiredHashtag((row as any).title, requiredHashtags)) { hashtagFiltered++; continue }
          if (extraHashtag && !hasRequiredHashtag((row as any).title, [extraHashtag])) { hashtagFiltered++; continue }

          const channelId = String((row as any).channel_id)
          const ownerId = ytChannelToId.get(channelId) || null
          const ownerName = ownerId && userMap.has(ownerId) ? userMap.get(ownerId)! : channelId

          videos.push({
            platform: 'youtube',
            id: vid,
            username: channelId,
            owner_name: ownerName,
            title: (row as any).title || '',
            caption: (row as any).title || '',
            taken_at: (row as any).post_date,
            link: `https://www.youtube.com/shorts/${vid}`,
            views: Number((row as any).views || 0),
            likes: Number((row as any).likes || 0),
            comments: Number((row as any).comments || 0),
            shares: 0,
          })
        }
        if (hashtagFiltered > 0) console.log(`[VIDEOS] YouTube: ${hashtagFiltered} videos filtered by hashtag requirement`)
      }
    }

    // Sort by views desc (highest first) as default
    videos.sort((a, b) => (b.views || 0) - (a.views || 0))

    // === AUDIT LOG ===
    const ttCount = videos.filter(v => v.platform === 'tiktok').length
    const igCount = videos.filter(v => v.platform === 'instagram').length
    const ytCount = videos.filter(v => v.platform === 'youtube').length
    const totalViews = videos.reduce((s, v) => s + (v.views || 0), 0)
    console.log(`[VIDEOS] ═══════════════════════════════════════`)
    console.log(`[VIDEOS] FINAL: ${videos.length} videos (TT:${ttCount} IG:${igCount} YT:${ytCount})`)
    console.log(`[VIDEOS] Total views: ${totalViews.toLocaleString()}`)
    console.log(`[VIDEOS] Required hashtags: ${JSON.stringify(requiredHashtags)}`)
    console.log(`[VIDEOS] TT usernames queried: ${buildUsernameSet(ttUserToId, ttOriginalCase).length}`)
    console.log(`[VIDEOS] IG usernames queried: ${buildUsernameSet(igUserToId, igOriginalCase).length}`)
    console.log(`[VIDEOS] Date range: ${startISO} to ${endISO}`)
    console.log(`[VIDEOS] ═══════════════════════════════════════`)

    // Compute totals + daily time series (bucketed by date and platform)
    const totals = { views: 0, likes: 0, comments: 0, shares: 0 }
    const totalByDate = new Map<string, { views: number; likes: number; comments: number; posts: number }>()
    const ttByDate = new Map<string, { views: number; likes: number; comments: number; posts: number }>()
    const igByDate = new Map<string, { views: number; likes: number; comments: number; posts: number }>()
    const ytByDate = new Map<string, { views: number; likes: number; comments: number; posts: number }>()

    for (const v of videos) {
      const views = Number(v.views || 0)
      const likes = Number(v.likes || 0)
      const comments = Number(v.comments || 0)
      totals.views += views
      totals.likes += likes
      totals.comments += comments
      totals.shares += Number(v.shares || 0)

      const date = String(v.taken_at || '').slice(0, 10)
      if (!date) continue

      // Total series
      const tc = totalByDate.get(date) || { views: 0, likes: 0, comments: 0, posts: 0 }
      tc.views += views; tc.likes += likes; tc.comments += comments; tc.posts += 1
      totalByDate.set(date, tc)

      // Platform series
      const pMap = v.platform === 'tiktok' ? ttByDate : v.platform === 'instagram' ? igByDate : ytByDate
      const pc = pMap.get(date) || { views: 0, likes: 0, comments: 0, posts: 0 }
      pc.views += views; pc.likes += likes; pc.comments += comments; pc.posts += 1
      pMap.set(date, pc)
    }

    const toSeries = (m: Map<string, any>) =>
      Array.from(m.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      campaign: { id: campaign.id, name: campaign.name, required_hashtags: requiredHashtags },
      count: videos.length,
      totals,
      series_total: toSeries(totalByDate),
      series_tiktok: toSeries(ttByDate),
      series_instagram: toSeries(igByDate),
      series_youtube: toSeries(ytByDate),
      ...(summaryOnly ? {} : { videos }),
      start: startISO,
      end: endISO,
      platform,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
