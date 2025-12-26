import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSSR } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60; // 60 seconds to stay safe

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function ensureAdmin() {
  try {
    const supa = await createSSR()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return false
    const { data } = await supa.from('users').select('role').eq('id', user.id).single()
    return data?.role === 'admin' || data?.role === 'super_admin'
  } catch { return false }
}

type Row = { user_id: string; instagram_username: string }

function normalize(u: string) {
  return String(u || '').trim().replace(/^@/, '').toLowerCase()
}

export async function POST(req: Request) {
  try {
    const ok = await ensureAdmin()
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { dryRun = false, includeCampaign = false } = await req.json().catch(() => ({ dryRun: false, includeCampaign: false })) as { dryRun?: boolean; includeCampaign?: boolean }

    const supa = adminClient()

    const rows: Row[] = []

    // Source 1: users.instagram_username
    try {
      const { data } = await supa
        .from('users')
        .select('id, instagram_username')
        .not('instagram_username', 'is', null)
      for (const r of data || []) {
        const ig = normalize((r as any).instagram_username)
        if (ig) rows.push({ user_id: String((r as any).id), instagram_username: ig })
      }
    } catch {}

    // Optional Source 2: campaign_instagram_participants → map back to user via ownership tables
    if (includeCampaign) {
      try {
        // Build username → owner user_id mapping from user_instagram_usernames and users
        const map = new Map<string, string>()
        const { data: map1 } = await supa.from('user_instagram_usernames').select('user_id, instagram_username')
        for (const r of map1 || []) map.set(normalize(String((r as any).instagram_username)), String((r as any).user_id))
        const { data: map2 } = await supa.from('users').select('id, instagram_username').not('instagram_username', 'is', null)
        for (const r of map2 || []) map.set(normalize(String((r as any).instagram_username)), String((r as any).id))

        const { data: parts } = await supa.from('campaign_instagram_participants').select('instagram_username')
        for (const r of parts || []) {
          const ig = normalize(String((r as any).instagram_username))
          const owner = ig && map.get(ig)
          if (ig && owner) rows.push({ user_id: owner, instagram_username: ig })
        }
      } catch {}
    }

    // Deduplicate
    const seen = new Set<string>()
    const dedup: Row[] = []
    for (const r of rows) {
      const key = `${r.user_id}::${r.instagram_username}`
      if (!seen.has(key)) { seen.add(key); dedup.push(r) }
    }

    if (dryRun) {
      return NextResponse.json({ dryRun: true, candidates: dedup.length })
    }

    // Upsert in chunks
    let inserted = 0
    const chunk = 500
    for (let i = 0; i < dedup.length; i += chunk) {
      const part = dedup.slice(i, i + chunk)
      if (!part.length) continue
      const { error } = await supa.from('user_instagram_usernames').upsert(part, { onConflict: 'user_id,instagram_username', ignoreDuplicates: true })
      if (error) throw error
      inserted += part.length
    }

    return NextResponse.json({ inserted, processed: dedup.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
