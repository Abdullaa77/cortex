import { updateSession } from '@/lib/supabase/middleware';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon)
     * - manifest.json (fetched with credentials omitted — a redirect here
     *   makes the app uninstallable as a PWA)
     * - sw.js (service worker script + its scope)
     * - offline (the offline fallback page must render without a session)
     * - api/version (the build stamp. A commit SHA of a public repo is not a
     *   secret, and scripts/check-deployed.mjs has no session to offer — a
     *   redirect to /login here would make "what is deployed" unanswerable,
     *   which is the question that cost a day)
     * - public assets (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
