import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - bulk import operations

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
  return data?.role === 'admin';
}

function normalizeUsername(u: string): string {
  return String(u || '').trim().replace(/^@+/, '').toLowerCase();
}

function parseCSV(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].split(/,|;|\t/).map(s => s.trim().toLowerCase());
  const hasHeader = first.includes('username');
  const usernames: string[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach(line => {
    const cols = line.split(/,|;|\t/);
    const value = hasHeader ? cols[first.indexOf('username')] : cols[0];
    if (value) usernames.push(normalizeUsername(value));
  });
  return usernames.filter(Boolean);
}

function parseXLSX(ab: ArrayBuffer): string[] {
  const wb = XLSX.read(ab, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];
  let startRow = 0;
  let usernameIdx = 0;
  const header = rows[0].map((v: any) => String(v).trim().toLowerCase());
  if (header.includes('username')) {
    usernameIdx = header.indexOf('username');
    startRow = 1;
  }
  const usernames: string[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    const value = row[usernameIdx];
    if (value) usernames.push(normalizeUsername(String(value)));
  }
  return usernames.filter(Boolean);
}

export async function POST(req: Request, context: any) {
  try {
    const isAdmin = await ensureAdmin();
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const fileName = (file as any).name || 'upload';
    const lower = String(fileName).toLowerCase();

    let usernames: string[] = [];
    if (lower.endsWith('.csv')) {
      const text = await file.text();
      usernames = parseCSV(text);
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const ab = await file.arrayBuffer();
      usernames = parseXLSX(ab);
    } else {
      // Try generic parse as text first, fallback to xlsx
      const text = await file.text().catch(() => null);
      if (text) usernames = parseCSV(text);
      if (!usernames.length) {
        const ab = await file.arrayBuffer();
        usernames = parseXLSX(ab);
      }
    }

    // Clean & dedupe
    const set = new Set(usernames.map(normalizeUsername).filter(Boolean));
    if (set.size === 0) return NextResponse.json({ error: 'No valid usernames found' }, { status: 400 });

    const rows = Array.from(set).map(u => ({
      campaign_id: id,
      user_id: null,
      tiktok_username: u,
    }));

    const supabaseAdmin = adminClient();
    const { data, error } = await supabaseAdmin
      .from('campaign_participants')
      .upsert(rows, { onConflict: 'campaign_id,tiktok_username', ignoreDuplicates: true })
      .select('id, tiktok_username, created_at');

    if (error) throw error;

    return NextResponse.json({ inserted: data?.length || 0, participants: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
