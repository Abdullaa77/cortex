'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { boardState, INTENTS_WINDOW_MS, type Board, type BoardInput, type Reach, type StoredRun } from '@/lib/ops/board';
import {
  ANSWER_CAP,
  type Check,
  type Decision,
  type GitlabPayload,
  type IntentRequestPayload,
  type SessionCheckPayload,
  type StoredAnswer,
  type WavesPayload,
} from '@/lib/ops/contract';

const RUN_SELECT = 'run_id, finished_at, received_at, payload';
const POLL_MS = 60_000;

/**
 * Why a query failed, in words that say what to do. Every one of these is a
 * red board — "could not ask" never renders as an empty, calm one.
 */
export function classifyFailure(err: { message?: string; code?: string } | null): string {
  const msg = err?.message ?? 'unknown error';
  if ((err?.code === 'PGRST205' || err?.code === '42P01') && /ops_intents/.test(msg))
    return 'ops_intents missing — migration 015 not applied';
  if (err?.code === 'PGRST205' || err?.code === '42P01') return 'ops_runs missing — migration 013 not applied';
  if (/fetch|network|ENOTFOUND|Failed to fetch|Load failed/i.test(msg))
    return 'database unreachable — is the Supabase project paused?';
  return `query failed: ${msg}`;
}

/**
 * Generous over-fetch for the intents window: board.ts owns the real 24h
 * filter, ordering and INTENTS_CAP display cap (so that logic is unit
 * testable without a database) — this just has to bring back at least
 * everything that could fall inside the window. A flood past this count in
 * 24h would undercount "N more"; that is a known, documented limit, not a
 * silent one.
 */
const INTENTS_FETCH_LIMIT = 200;

/**
 * The board's data, read-only. Six small queries every 60 s while the page
 * is open, and a clock tick with them so ages advance and STALE arrives on
 * time even if nothing is re-fetched.
 */
/** What ops_intent_answer (015) said, in words the answer form can show. */
export type AnswerResult = { ok: true } | { ok: false; reason: string };

const ANSWER_REFUSALS: Record<string, string> = {
  unauthorized: 'not signed in',
  authorization: 'an authorization is never given here — it needs you in the session',
  not_a_decision: 'pick which kind of decision this is',
  not_found: 'that question is not in the database (or not yours)',
  not_answerable: 'a permission prompt is answered in the terminal',
  already_answered: 'already answered — one answer per question',
};

export function useOps(): {
  board: Board | null;
  loading: boolean;
  refetch: () => void;
  answer: (runId: string, decision: Decision, text: string) => Promise<AnswerResult>;
} {
  const { supabase, session } = useSupabase();
  const userId = session?.user?.id ?? null;
  const [input, setInput] = useState<BoardInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const sinceIntents = new Date(Date.now() - INTENTS_WINDOW_MS).toISOString();
    const latest = (kind: string, mode?: string) => {
      let q = supabase.from('ops_runs').select(RUN_SELECT).eq('kind', kind);
      if (mode) q = q.eq('mode', mode);
      return q.order('finished_at', { ascending: false }).limit(1).maybeSingle();
    };
    try {
      const [live, control, waves, gitlab, samples, intents, answers] = await Promise.all([
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
        supabase
          .from('ops_runs')
          .select(RUN_SELECT)
          .eq('kind', 'intent_request')
          .gte('finished_at', sinceIntents)
          .order('finished_at', { ascending: false })
          .limit(INTENTS_FETCH_LIMIT),
        // Answers to anything that can still be in the window. Keyed on
        // asked_at (the run's domain time), matching the band's own filter.
        supabase
          .from('ops_intents')
          .select('id, run_id, decision, answer, answered_at, status, applied_at')
          .gte('asked_at', sinceIntents)
          .limit(INTENTS_FETCH_LIMIT),
      ]);
      const failed = [live, control, waves, gitlab, samples, intents, answers].find((r) => r.error);
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
        intents: (intents.data ?? []) as StoredRun<IntentRequestPayload>[],
        answers: (answers.data ?? []) as StoredAnswer[],
      });
    } catch (err) {
      const reach: Reach = {
        ok: false,
        at: new Date().toISOString(),
        reason: classifyFailure(err as { message?: string; code?: string }),
      };
      // Nothing from before the failure is kept: a board that could not ask
      // shows that it could not ask, not the last thing it heard.
      setInput({ reach, live: null, control: null, waves: null, gitlab: null, apiSamples: [], intents: [], answers: [] });
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

  /**
   * Scott's answer → ops_intent_answer (016). The database decides — decision
   * kind (never an authorization), length, ownership, one answer per question,
   * no permission prompts —
   * and this only turns its refusal into words. Refetches on success so the
   * row flips to "answered — waiting for delivery" from the database's own
   * record, not from local state.
   */
  const answer = useCallback(
    async (runId: string, decision: Decision, text: string): Promise<AnswerResult> => {
      if (!text.trim() || text.length > ANSWER_CAP) return { ok: false, reason: `answer: 1–${ANSWER_CAP} characters` };
      const { data, error } = await supabase.rpc('ops_intent_answer', {
        p_run_id: runId,
        p_decision: decision,
        p_answer: text,
      });
      if (error) return { ok: false, reason: classifyFailure(error) };
      const r = data as { ok: boolean; error?: string; detail?: string };
      if (!r.ok) return { ok: false, reason: ANSWER_REFUSALS[r.error ?? ''] ?? `${r.error}${r.detail ? `: ${r.detail}` : ''}` };
      await fetchAll();
      return { ok: true };
    },
    [supabase, fetchAll]
  );

  const board = useMemo(() => (input ? boardState(input, now) : null), [input, now]);
  return { board, loading, refetch: fetchAll, answer };
}
