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
     * - public assets (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
