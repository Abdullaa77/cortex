import { createServerClient } from '@supabase/ssr';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // "Could not ask" is not "logged out". When Supabase does not answer at all
  // — network failure, 5xx, or a free-tier project paused after 7 days idle,
  // which is what happened in September 2026 and went unnoticed for a week —
  // getUser() returns no user, and the redirect below would show the login
  // page: a dead database dressed as a signed-out session. Say what happened
  // instead. A missing or expired session is not retryable and still goes to
  // /login as before.
  if (isAuthRetryableFetchError(error)) {
    const url = request.nextUrl.clone();
    url.pathname = '/unreachable';
    url.search = '';
    url.searchParams.set('at', new Date().toISOString());
    url.searchParams.set('from', request.nextUrl.pathname);
    url.searchParams.set('status', String(error.status));
    return NextResponse.redirect(url);
  }

  const isAuthPage =
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname.startsWith('/auth/callback');

  // Redirect unauthenticated users to /login
  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users from /login to /
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
