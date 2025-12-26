import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const res = NextResponse.next();

  // Supabase client bound to middleware cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isDashboard = url.pathname.startsWith('/dashboard');
  const isAdminOnly = url.pathname.startsWith('/dashboard/admin') || url.pathname.startsWith('/dashboard/campaigns');
  const isAuthPage = url.pathname === '/login' || url.pathname === '/signup';

  // Require auth for dashboard
  if (isDashboard && !user) {
    const loginUrl = new URL('/login', url.origin);
    loginUrl.searchParams.set('next', url.pathname + (url.search || ''));
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in users away from /login or /signup
  if (isAuthPage && user) {
    return NextResponse.redirect(new URL('/dashboard', url.origin));
  }

  // Admin-gate admin/campaigns sections
  if (isDashboard && isAdminOnly && user) {
    // Get own role via RLS-safe select
    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', url.origin));
    }
  }

  return res;
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/signup'],
};
