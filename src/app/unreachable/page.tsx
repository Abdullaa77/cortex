import Link from 'next/link';

/**
 * The database did not answer.
 *
 * Reached from src/middleware.ts when Supabase fails to respond at all — never
 * for a missing session, which still goes to /login. The distinction is the
 * point: in September 2026 the free-tier project paused itself after 7 idle
 * days, and every page quietly became the login screen, which reads as "you
 * were signed out" rather than "the database is asleep". This page says the
 * second thing, with the time it was measured, and what fixes it.
 *
 * Renders without a session (middleware exempts it). Writes nothing.
 */
export default async function UnreachablePage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string; from?: string; status?: string }>;
}) {
  const { at, from, status } = await searchParams;
  const back = from && from.startsWith('/') && !from.startsWith('//') ? from : '/';

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg font-mono">
      <div className="max-w-md space-y-6 px-4 text-center">
        <p className="text-xs tracking-[4px] text-[#EF4444]">── DATABASE UNREACHABLE ──</p>
        <p className="text-sm text-text-muted">
          <span className="text-text-primary">&gt;</span> Supabase did not answer.
        </p>
        <div className="space-y-2 text-left text-xs leading-relaxed text-text-muted">
          <p>
            This is not a sign-out. Your session could not be checked because the database behind
            Cortex did not respond{status && status !== '0' ? ` (HTTP ${status})` : ''}.
          </p>
          <p>
            The usual cause: the free-tier project pauses itself after 7 days without activity.
            Restore it from the Supabase dashboard → Cortex → Restore. Nothing is lost while paused.
          </p>
          <p className="text-text-muted/60">measured {at ?? '— (no time recorded)'}</p>
        </div>
        <Link
          href={back}
          className="inline-block rounded border border-border px-3 py-1 text-xs text-text-muted hover:border-accent/40 hover:text-accent"
        >
          try again
        </Link>
      </div>
    </div>
  );
}
