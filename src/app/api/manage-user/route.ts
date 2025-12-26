import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient as createSSR } from '@/lib/supabase/server';

// Initialize Supabase Admin Client
// This should only be done in a secure server-side environment
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  try {
    // Iterate through user pages to find matching email. Suitable for admin panels (low frequency ops).
    let page = 1;
    const perPage = 200;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const found = data.users.find((u: any) => String(u.email || '').toLowerCase() === email.toLowerCase());
      if (found) return found.id as string;
      if (data.users.length < perPage) break; // last page
      page += 1;
    }
  } catch {}
  return null;
}

async function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function createAuthUserWithRetry(email: string, password: string, retries = 2): Promise<{ id: string | null, error?: any }> {
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
      if (!error && data?.user?.id) return { id: data.user.id };
      lastErr = error;
      // If not a server error, break early
      const msg = String(error?.message || '').toLowerCase();
      if (!msg.includes('database error') && !msg.includes('unexpected_failure') && !(error?.status === 500)) break;
    } catch (e: any) {
      lastErr = e;
    }
    // backoff before retry
    await delay(400 * (attempt + 1));
  }
  return { id: null, error: lastErr };
}

async function ensureUniqueUsername(base: string, currentId?: string | null): Promise<string> {
  const norm = base.trim().toLowerCase().replace(/[^a-z0-9_\.\-]/g, '').slice(0, 24) || 'user';
  let candidate = norm;
  for (let i = 0; i < 6; i++) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('username', candidate)
      .maybeSingle();
    if (!data || (currentId && data.id === currentId)) return candidate;
    const suffix = Math.random().toString(36).slice(2, 6);
    candidate = `${norm}-${suffix}`;
  }
  return `${norm}-${Date.now().toString().slice(-4)}`;
}

export async function POST(request: Request) {
  // Ensure admin
  const supabaseSSR = await createSSR();
  const { data: { user } } = await supabaseSSR.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: me } = await supabaseSSR.from('users').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin' && me?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { isEditing, isDeleting, userId, userData, password } = await request.json();

  try {
    // --- DELETE USER ---
    if (isDeleting) {
      if (!userId) throw new Error('User ID is required for deletion.');

      // Admin cannot delete super_admin
      if (me?.role !== 'super_admin') {
        const { data: target } = await supabaseAdmin.from('users').select('role').eq('id', userId).single();
        if (target?.role === 'super_admin') {
          return NextResponse.json({ error: 'Cannot delete super admin' }, { status: 403 });
        }
      }

      // Delete in auth first; ignore "User not found" to make operation idempotent
      try {
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (authError && !/not\s*found/i.test(String(authError.message || ''))) {
          throw new Error(`Failed to delete from auth: ${authError.message}`);
        }
      } catch (e: any) {
        // Re-throw only if other errors (network, permission)
        if (!/not\s*found/i.test(String(e?.message || ''))) throw e;
      }

      // Then remove profile record (and dependent rows via cascade)
      const { error: dbError } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', userId);
      if (dbError) throw new Error(`Failed to delete from database: ${dbError.message}`);

      return NextResponse.json({ message: 'User deleted successfully.' });
    }

    // --- CREATE OR UPDATE USER ---
    if (isEditing) {
      // --- UPDATE USER ---
      if (!userData.id) throw new Error('User ID is required for updating.');

      // Only super_admin can elevate/set admin or super_admin roles
      if (me?.role !== 'super_admin' && (userData.role === 'admin' || userData.role === 'super_admin')) {
        return NextResponse.json({ error: 'Only super admin can assign admin roles' }, { status: 403 });
      }

      // Normalize multi TikTok usernames
      const list: string[] = Array.isArray(userData.tiktok_usernames)
        ? userData.tiktok_usernames
        : String(userData.tiktok_username || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
      const normalized = Array.from(new Set(list.map((u: string) => u.replace(/^@/, '').toLowerCase())));
      const primary = normalized[0] || null;

      // Normalize multi Instagram usernames
      const igList: string[] = Array.isArray((userData as any).instagram_usernames)
        ? (userData as any).instagram_usernames
        : String((userData as any).instagram_username || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      const igNormalized = Array.from(new Set(igList.map((u: string) => u.replace(/^@/, '').toLowerCase())));
      const igPrimary = igNormalized[0] || null;

      // 1. Update profile in public.users
      const { error: profileError } = await supabaseAdmin
        .from('users')
        .update({
          full_name: userData.full_name,
          username: userData.username,
          role: userData.role,
          tiktok_username: primary,
          instagram_username: igPrimary,
        })
        .eq('id', userData.id);
      if (profileError) throw profileError;

      // 1b. Upsert extra usernames mapping
      try {
        // fetch existing
        const { data: existing } = await supabaseAdmin
          .from('user_tiktok_usernames')
          .select('tiktok_username')
          .eq('user_id', userData.id);
        const existingSet = new Set((existing || []).map((r: any) => String(r.tiktok_username)));
        // add missing
        const toAdd = normalized.filter(u => !existingSet.has(u)).map(u => ({ user_id: userData.id, tiktok_username: u }));
        if (toAdd.length) {
          await supabaseAdmin.from('user_tiktok_usernames').upsert(toAdd, { onConflict: 'user_id,tiktok_username', ignoreDuplicates: true });
        }
        // remove extras not in list
        const toRemove = Array.from(existingSet).filter(u => !normalized.includes(u));
        if (toRemove.length) {
          await supabaseAdmin.from('user_tiktok_usernames').delete().eq('user_id', userData.id).in('tiktok_username', toRemove);
        }
      } catch {}

      // 1c. Upsert Instagram usernames mapping
      try {
        const { data: existingIG } = await supabaseAdmin
          .from('user_instagram_usernames')
          .select('instagram_username')
          .eq('user_id', userData.id);
        const existingSetIG = new Set((existingIG || []).map((r: any) => String(r.instagram_username)));
        const toAddIG = igNormalized.filter(u => !existingSetIG.has(u)).map(u => ({ user_id: userData.id, instagram_username: u }));
        if (toAddIG.length) {
          await supabaseAdmin.from('user_instagram_usernames').upsert(toAddIG, { onConflict: 'user_id,instagram_username', ignoreDuplicates: true });
        }
        const toRemoveIG = Array.from(existingSetIG).filter(u => !igNormalized.includes(u));
        if (toRemoveIG.length) {
          await supabaseAdmin.from('user_instagram_usernames').delete().eq('user_id', userData.id).in('instagram_username', toRemoveIG);
        }
      } catch {}

      // 1c. Sync employee_participants across all campaigns to mirror updated username list
      try {
        // campaigns where this employee is present
        const { data: eg } = await supabaseAdmin
          .from('employee_groups')
          .select('campaign_id')
          .eq('employee_id', userData.id);
        const campaigns = (eg || []).map((r:any)=> r.campaign_id);
        if (campaigns.length) {
          for (const cid of campaigns) {
            const { data: ep } = await supabaseAdmin
              .from('employee_participants')
              .select('tiktok_username')
              .eq('employee_id', userData.id)
              .eq('campaign_id', cid);
            const currentSet = new Set((ep||[]).map((r:any)=> String(r.tiktok_username)));
            const desiredSet = new Set(normalized);
            const toAdd = normalized.filter(u => !currentSet.has(u)).map(u => ({ employee_id: userData.id, campaign_id: cid, tiktok_username: u }));
            const toRemove = Array.from(currentSet).filter(u => !desiredSet.has(u));
            if (toAdd.length) await supabaseAdmin.from('employee_participants').upsert(toAdd, { onConflict: 'employee_id,campaign_id,tiktok_username', ignoreDuplicates: true });
            if (toRemove.length) await supabaseAdmin.from('employee_participants').delete().eq('employee_id', userData.id).eq('campaign_id', cid).in('tiktok_username', toRemove);
            // ensure participants exist on the campaign for added usernames (idempotent)
            if (toAdd.length) {
              const cpRows = toAdd.map(r => ({ campaign_id: cid, tiktok_username: r.tiktok_username }));
              await supabaseAdmin.from('campaign_participants').upsert(cpRows, { onConflict: 'campaign_id,tiktok_username', ignoreDuplicates: true });
            }
          }
        }
      } catch {}

      // 2. Update password if provided
      if (password) {
        const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(
          userData.id,
          { password }
        );
        if (passwordError) throw passwordError;
      }

      return NextResponse.json({ message: 'User updated successfully.' });

    } else {
      // --- CREATE USER ---
      if (!userData.email || !password) {
        throw new Error('Email and password are required for new users.');
      }

      // Only super_admin can create admin/super_admin users
      if (me?.role !== 'super_admin' && (userData.role === 'admin' || userData.role === 'super_admin')) {
        return NextResponse.json({ error: 'Only super admin can create admin accounts' }, { status: 403 });
      }

      // Basic validations to avoid opaque DB errors
      const emailStr = String(userData.email).trim();
      const pwdStr = String(password);
      const emailOk = /.+@.+\..+/.test(emailStr);
      if (!emailOk) return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });
      if (pwdStr.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });

      // If email already exists in auth, reuse id and just ensure profile exists
      let existingId = await findAuthUserIdByEmail(emailStr);
      if (existingId) {
        // Optionally set/refresh password for the account
        try { await supabaseAdmin.auth.admin.updateUserById(existingId, { password: pwdStr }); } catch {}

        // Upsert profile row
        const { error: upErr } = await supabaseAdmin
          .from('users')
          .upsert({
            id: existingId,
            email: emailStr,
            full_name: userData.full_name,
            username: userData.username || emailStr.split('@')[0],
            role: userData.role,
            tiktok_username: userData.tiktok_username,
          }, { onConflict: 'id' });
        if (upErr) throw upErr;

        return NextResponse.json({ message: 'User already existed. Profile synced.' });
      }

      // 1. Create user in auth.users (with fallback strategies)
      let newUserId: string | null = null;
      let createErr: any = null;
      {
        const res = await createAuthUserWithRetry(emailStr, pwdStr, 2);
        newUserId = res.id; createErr = res.error || null;
      }

      if (!newUserId) {
        // Fallback 1: try create without password, then set password
        try {
          const { data: fallback, error: fbErr } = await supabaseAdmin.auth.admin.createUser({
            email: userData.email,
            email_confirm: true,
          });
          if (!fbErr && fallback?.user?.id) {
            newUserId = fallback.user.id;
            const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(newUserId, { password });
            if (pwErr) throw pwErr;
          }
        } catch {}
      }

      if (!newUserId) {
        // Fallback 2: try inviteUserByEmail to force creation, then set password
        try {
          const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(emailStr, { redirectTo: undefined });
          if (!inviteErr && invited?.user?.id) {
            newUserId = invited.user.id;
            // try to set password now
            try { await supabaseAdmin.auth.admin.updateUserById(newUserId, { password: pwdStr }); } catch {}
          }
        } catch {}
      }

      if (!newUserId) {
        // Fallback 3: re-check by email and then set password
        existingId = await findAuthUserIdByEmail(emailStr);
        if (existingId) {
          newUserId = existingId;
          await supabaseAdmin.auth.admin.updateUserById(existingId, { password: pwdStr });
        } else {
          // No way to recover — bubble up original error message if any (surface diagnostic info)
          return NextResponse.json({
            error: 'Supabase Auth createUser failed',
            details: String(createErr?.message || createErr || 'unknown'),
            supabase: { status: (createErr as any)?.status, code: (createErr as any)?.code, name: (createErr as any)?.name }
          }, { status: 400 });
        }
      }

      // Normalize multi TikTok usernames
      const list: string[] = Array.isArray(userData.tiktok_usernames)
        ? userData.tiktok_usernames
        : String(userData.tiktok_username || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
      const normalized = Array.from(new Set(list.map((u: string) => u.replace(/^@/, '').toLowerCase())));
      const primary = normalized[0] || null;

      // Normalize multi Instagram usernames
      const igList: string[] = Array.isArray((userData as any).instagram_usernames)
        ? (userData as any).instagram_usernames
        : String((userData as any).instagram_username || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      const igNormalized = Array.from(new Set(igList.map((u: string) => u.replace(/^@/, '').toLowerCase())));
      const igPrimary = igNormalized[0] || null;

      // 2. Create profile in public.users
      const safeUsername = await ensureUniqueUsername(userData.username || emailStr.split('@')[0], newUserId);
      let profileError: any = null;
      try {
        const { error } = await supabaseAdmin
          .from('users')
          .upsert({
            id: newUserId,
            email: emailStr,
            full_name: userData.full_name,
            username: safeUsername,
            role: userData.role,
            tiktok_username: primary,
            instagram_username: igPrimary,
          }, { onConflict: 'id' });
        profileError = error;
      } catch (e: any) {
        profileError = e;
      }
      if (profileError) {
        // Handle unique(email) conflict by updating the existing row to the new id
        try {
          const { data: existing } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('email', emailStr)
            .maybeSingle();
          if (existing?.id && existing.id !== newUserId) {
            // Update PK id to the new auth id and merge fields
            const { error: updErr } = await supabaseAdmin
              .from('users')
              .update({ id: newUserId, full_name: userData.full_name, username: safeUsername, role: userData.role, tiktok_username: primary })
              .eq('email', emailStr);
            if (!updErr) profileError = null;
          }
        } catch {}
      }
      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return NextResponse.json({ error: String(profileError?.message || profileError) }, { status: 400 });
      }
      // 2b. Upsert extra usernames mapping (TikTok)
      try {
        const toAdd = normalized.map(u => ({ user_id: newUserId!, tiktok_username: u }));
        if (toAdd.length) {
          await supabaseAdmin.from('user_tiktok_usernames').upsert(toAdd, { onConflict: 'user_id,tiktok_username', ignoreDuplicates: true });
        }
      } catch {}

      // 2c. Upsert Instagram usernames mapping
      try {
        const toAddIG = igNormalized.map(u => ({ user_id: newUserId!, instagram_username: u }));
        if (toAddIG.length) {
          await supabaseAdmin.from('user_instagram_usernames').upsert(toAddIG, { onConflict: 'user_id,instagram_username', ignoreDuplicates: true });
        }
      } catch {}

      // Note: social_metrics akan di-upsert saat fetch TikTok metrics pertama kali

      return NextResponse.json({ message: 'User created successfully.' });
    }

  } catch (error: any) {
    console.error('Error in manage-user function:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
