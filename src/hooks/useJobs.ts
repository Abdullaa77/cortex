'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { INTENTS_WINDOW_MS, type Reach, type StoredRun } from '@/lib/ops/board';
import { jobsScreen, type JobsInput, type JobsScreen } from '@/lib/ops/jobs';
import type { GitlabPayload, IntentRequestPayload, JobStatusPayload, SessionCheckPayload, StoredResolution } from '@/lib/ops/contract';
import { classifyFailure } from './useOps';

const RUN_SELECT = 'run_id, finished_at, received_at, payload';
const POLL_MS = 30_000;
/**
 * job_status runs are pushed on every Stop of every session in a Job, and 019
 * keeps 7 days — so the whole kept window is fetched: a Job waiting on Scott
 * for three days must still have a card. jobs.ts picks the latest per Job.
 * Known limit, not a silent one: a quiet Job whose latest run sits behind more
 * than FETCH_LIMIT newer runs of other Jobs drops off until it pushes again.
 */
const JOBS_WINDOW_MS = 7 * 86_400_000;
const FETCH_LIMIT = 1000;

const EMPTY: Omit<JobsInput, 'reach'> = { live: null, gitlab: null, jobs: [], intents: [], resolutions: [] };

/**
 * The Jobs screen's data, read-only — nothing here writes (Scott, 2026-10-15:
 * "I just want to see there not manage"). Five queries every 30 s, and a clock
 * tick beside them so ages advance and STALE arrives on time.
 */
export function useJobs(): { screen: JobsScreen | null; loading: boolean } {
  const { supabase, session } = useSupabase();
  const userId = session?.user?.id ?? null;
  const [input, setInput] = useState<JobsInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  // Only the newest fetch may land: a slow poll that returns after a newer
  // one (or after unmount) must not put older data back on the screen.
  const seq = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    const mine = ++seq.current;
    const since = (ms: number) => new Date(Date.now() - ms).toISOString();
    const latest = (kind: string, mode?: string) => {
      let q = supabase.from('ops_runs').select(RUN_SELECT).eq('kind', kind);
      if (mode) q = q.eq('mode', mode);
      return q.order('finished_at', { ascending: false }).limit(1).maybeSingle();
    };
    try {
      const [live, gitlab, jobs, intents, resolutions] = await Promise.all([
        latest('session_check', 'live'),
        latest('gitlab'),
        supabase
          .from('ops_runs')
          .select(RUN_SELECT)
          .eq('kind', 'job_status')
          .gte('finished_at', since(JOBS_WINDOW_MS))
          .order('finished_at', { ascending: false })
          .limit(FETCH_LIMIT),
        supabase
          .from('ops_runs')
          .select(RUN_SELECT)
          .eq('kind', 'intent_request')
          .gte('finished_at', since(INTENTS_WINDOW_MS))
          .order('finished_at', { ascending: false })
          .limit(FETCH_LIMIT),
        supabase
          .from('ops_intent_resolutions')
          .select('run_id, reason, resolved_at')
          .gte('resolved_at', since(INTENTS_WINDOW_MS))
          .limit(FETCH_LIMIT),
      ]);
      if (mine !== seq.current) return;
      const failed = [live, gitlab, jobs, intents, resolutions].find((r) => r.error);
      if (failed) throw failed.error;
      setInput({
        reach: { ok: true },
        live: live.data as StoredRun<SessionCheckPayload> | null,
        gitlab: gitlab.data as StoredRun<GitlabPayload> | null,
        jobs: (jobs.data ?? []) as StoredRun<JobStatusPayload>[],
        intents: (intents.data ?? []) as StoredRun<IntentRequestPayload>[],
        resolutions: (resolutions.data ?? []) as StoredResolution[],
      });
    } catch (err) {
      if (mine !== seq.current) return;
      const reach: Reach = { ok: false, at: new Date().toISOString(), reason: classifyFailure(err as { message?: string; code?: string }) };
      // A screen that could not ask shows that, not the last thing it heard.
      setInput({ reach, ...EMPTY });
    } finally {
      if (mine === seq.current) {
        setLoading(false);
        setNow(new Date());
      }
    }
  }, [supabase, userId]);

  useEffect(() => {
    const first = setTimeout(fetchAll, 0);
    const id = setInterval(fetchAll, POLL_MS);
    // The clock ticks on its own: a fetch that hangs must not freeze ages, or
    // a building Job would never turn stale while it waits.
    const tick = setInterval(() => setNow(new Date()), POLL_MS);
    const live = seq;
    return () => {
      clearTimeout(first);
      clearInterval(id);
      clearInterval(tick);
      live.current++; // anything still in flight lands nowhere
    };
  }, [fetchAll]);

  const screen = useMemo(() => (input ? jobsScreen(input, now) : null), [input, now]);
  return { screen, loading };
}
