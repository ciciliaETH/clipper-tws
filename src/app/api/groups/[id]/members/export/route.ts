import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSR } from '@/lib/supabase/server';

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
  const supabase = await createSSR()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!data) return false
  return (data.role === 'admin' || data.role === 'super_admin')
}

export async function GET(req: Request, context: any) {
  try {
    const { id } = await context.params
    const isAdmin = await ensureAdmin()
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = adminClient();
    // id already obtained above

    // fetch campaign name (optional)
    const { data: camp } = await supabase.from('campaigns').select('name').eq('id', id).single();

    // get assignments
    const { data: rows, error } = await supabase
      .from('employee_participants')
      .select('employee_id, tiktok_username')
      .eq('campaign_id', id);
    if (error) throw error;

    const empIds = Array.from(new Set((rows || []).map(r => r.employee_id)));
    let names = new Map<string, { name: string; email?: string; username?: string }>();
    if (empIds.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name, email, username')
        .in('id', empIds);
      for (const u of users || []) names.set(u.id, { name: u.full_name || u.username || u.email, email: u.email, username: u.username });
    }

    const header = ['campaign_id','campaign_name','employee_id','employee_name','employee_username','employee_email','tiktok_username'];
    const lines = [header.join(',')];
    for (const r of rows || []) {
      const meta = names.get(r.employee_id) || { name: r.employee_id } as any;
      const vals = [
        id,
        (camp?.name || ''),
        r.employee_id,
        meta.name || '',
        meta.username || '',
        meta.email || '',
        r.tiktok_username,
      ];
      // escape CSV
      lines.push(vals.map(v => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
      }).join(','));
    }

    const csv = lines.join('\n');
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="group_${id}_assignments.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
