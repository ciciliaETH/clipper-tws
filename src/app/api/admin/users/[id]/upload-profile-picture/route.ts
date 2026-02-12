import { NextResponse } from 'next/server';
import { createClient as createSSR } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabaseSSR = await createSSR();
    const { data: { user } } = await supabaseSSR.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: me } = await supabaseSSR.from('users').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin' && me?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const targetId = params.id;
    if (!targetId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    // Validate
    const allowed = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
    if (!allowed.includes(file.type)) return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 });

    // Admin storage client
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `profile-pictures/${targetId}-${Date.now()}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: upErr } = await supabaseAdmin.storage.from('avatars').upload(filePath, buffer, { contentType: file.type, upsert: false });
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

    const { data: { publicUrl } } = supabaseAdmin.storage.from('avatars').getPublicUrl(filePath);

    const { error: updErr } = await supabaseAdmin.from('users').update({ profile_picture_url: publicUrl }).eq('id', targetId);
    if (updErr) return NextResponse.json({ error: `DB update failed: ${updErr.message}` }, { status: 500 });

    return NextResponse.json({ success: true, url: publicUrl });
  } catch (e: any) {
    console.error('[admin upload avatar] error', e);
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
