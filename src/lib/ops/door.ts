import { createClient } from '@supabase/supabase-js';

/**
 * Shared by the Command Centre's token-only routes — the ingest door (013)
 * and the daemon's read/confirm pair (015). Each holds no key beyond the
 * public anon key; the bearer token goes straight through to a SECURITY
 * DEFINER function that compares its sha256 against the stored row.
 */

export const json = (status: number, body: unknown) => Response.json(body, { status });

/** The bearer token, or null. Never logged, never echoed. */
export function bearer(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  return /^Bearer\s+(\S+)$/.exec(auth)?.[1] ?? null;
}

export function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type DbError = { message?: string; code?: string; status?: number } | null;

/** A failure to reach Supabase at all, as opposed to Supabase answering no. */
export function isUnreachable(err: DbError): boolean {
  if (!err) return false;
  const msg = err.message ?? '';
  return (
    /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i.test(msg) ||
    (typeof err.status === 'number' && (err.status === 0 || err.status >= 500))
  );
}

/**
 * Call one token-checked RPC. "Could not ask" is its own answer (503
 * database_unreachable), never a generic 500 and never a success — the free
 * tier pauses a project after 7 idle days.
 */
export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let data: unknown;
  let error: DbError;
  try {
    ({ data, error } = await anonClient().rpc(fn, args));
  } catch (e) {
    error = { message: String(e) };
  }
  if (error) {
    if (isUnreachable(error)) return { ok: false, response: json(503, { ok: false, error: 'database_unreachable' }) };
    // The message is Postgres's, not ours — it may name internals. The code is enough to act on.
    return { ok: false, response: json(500, { ok: false, error: 'database_error', code: error.code ?? null }) };
  }
  return { ok: true, data: data as T };
}
