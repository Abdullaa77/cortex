'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { boardState, type Board, type BoardInput, type Reach, type StoredRun } from '@/lib/ops/board';
import type { Check, GitlabPayload, SessionCheckPayload, WavesPayload } from '@/lib/ops/contract';

const RUN_SELECT = 'run_id, finished_at, received_at, payload';
const POLL_MS = 60_000;

/**
 * Why a query failed, in words that say what to do. Every one of these is a
 * red board — "could not ask" never renders as an empty, calm one.
 */
export function classifyFailure(err: { message?: string; code?: string } | null): string {
  const msg = err?.message ?? 'unknown error';
  if (err?.code === 'PGRST205' || err?.code === '42P01') return 'ops_runs missing — migration 013 not applied';
  if (/fetch|network|ENOTFOUND|Failed to fetch|Load failed/i.test(msg))
    return 'database unreachable — is the Supabase project paused?';
  return `query failed: ${msg}`;
}

/**
 * The board's data, read-only. Five small queries every 60 s while the page
 * is open, and a clock tick with them so ages advance and STALE arrives on
 * time even if nothing is re-fetched.
 */
export function useOps(): { board: Board | null; loading: boolean; refetch: () => void } {
  const { supabase, session } = useSupabase();
  const userId = session?.user?.id ?? null;
  const [input, setInput] = useState<BoardInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const latest = (kind: string, mode?: string) => {
      let q = supabase.from('ops_runs').select(RUN_SELECT).eq('kind', kind);
      if (mode) q = q.eq('mode', mode);
      return q.order('finished_at', { ascending: false }).limit(1).maybeSingle();
    };
    try {
      const [live, control, waves, gitlab, samples] = await Promise.all([
        latest('session_check', 'live'),
        latest('session_check', 'control'),
        latest('waves'),
        latest('gitlab'),
        supabase
          .from('ops_runs')
          .select('finished_at, checks:payload->checks')
          .eq('kind', 'session_check')
          .eq('mode', 'live')
          .gte('finished_at', since),
      ]);
      const failed = [live, control, waves, gitlab, samples].find((r) => r.error);
      if (failed) throw failed.error;

      const apiSamples = ((samples.data ?? []) as { finished_at: string; checks: Check[] | null }[]).flatMap((r) => {
        const h = r.checks?.find((c) => c.id === 'api.health');
        return h ? [{ at: r.finished_at, state: h.state }] : [];
      });

      setInput({
        reach: { ok: true },
        live: live.data as StoredRun<SessionCheckPayload> | null,
        control: control.data as StoredRun<SessionCheckPayload> | null,
        waves: waves.data as StoredRun<WavesPayload> | null,
        gitlab: gitlab.data as StoredRun<GitlabPayload> | null,
        apiSamples,
      });
    } catch (err) {
      const reach: Reach = {
        ok: false,
        at: new Date().toISOString(),
        reason: classifyFailure(err as { message?: string; code?: string }),
      };
      // Nothing from before the failure is kept: a board that could not ask
      // shows that it could not ask, not the last thing it heard.
      setInput({ reach, live: null, control: null, waves: null, gitlab: null, apiSamples: [] });
    } finally {
      setLoading(false);
      setNow(new Date());
    }
  }, [supabase, userId]);

  useEffect(() => {
    // Deferred a tick so the fetch's state updates don't land synchronously
    // inside the effect body.
    const first = setTimeout(fetchAll, 0);
    const id = setInterval(fetchAll, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [fetchAll]);

  const board = useMemo(() => (input ? boardState(input, now) : null), [input, now]);
  return { board, loading, refetch: fetchAll };
}
