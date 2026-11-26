'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Script from 'next/script';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { useFinanceSummary } from '@/hooks/useFinanceSummary';
import { useFinanceCapture } from '@/hooks/useFinanceCapture';
import { routeCapture } from '@/lib/finance/route';
import { buildRowPatch, toDraft } from '@/lib/finance/edit';
import { dayKey } from '@/lib/finance/cutover';
import { formatAmount, formatBalance, formatMinor } from '@/lib/finance/format';

/**
 * The Telegram Mini App's one screen: today, where the money is, who owes me,
 * the last lines, quick add. Phase-1 scope only; the rest of Cortex stays on
 * the normal website. Gate: the page shows nothing until the server has checked
 * Telegram's signed initData against the owner id.
 */

interface Owed {
  id: string;
  person: string;
  open_minor: number;
  due_on: string | null;
}
type Gate = 'checking' | 'ok' | 'not_telegram' | 'not_owner' | 'error';

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void } };
  }
}

export default function MiniFinancePage() {
  const { supabase, session } = useSupabase();
  const [gate, setGate] = useState<Gate>('checking');
  // Runs when Telegram's script is ready (a callback, not an effect: nothing
  // here is state that must be synced, it is one check on arrival).
  const check = useCallback(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa || !wa.initData) return setGate('not_telegram');
    wa.ready();
    wa.expand();
    fetch('/api/telegram/miniapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: wa.initData }),
    })
      .then(async (res) => {
        if (res.ok) return setGate('ok');
        const body = await res.json().catch(() => ({}));
        setGate(body.reason === 'not_owner' ? 'not_owner' : 'error');
      })
      .catch(() => setGate('error'));
  }, []);

  return (
    <main className="mx-auto max-w-md p-4 pb-24 text-sm">
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onReady={check}
        onError={() => setGate('not_telegram')}
      />
      {gate === 'checking' && <p className="text-muted-foreground">Checking Telegram…</p>}
      {gate === 'not_telegram' && <p>Open this from the Telegram bot menu.</p>}
      {gate === 'not_owner' && <p>Not your Cortex.</p>}
      {gate === 'error' && <p>Could not check Telegram. Close and open again.</p>}
      {gate === 'ok' && session?.user && <Home supabase={supabase} />}
    </main>
  );
}

function Home({ supabase }: { supabase: ReturnType<typeof useSupabase>['supabase'] }) {
  const { rows, positions, deleteRow, updateRow, refetch, loading, error } = useFinanceSummary();
  const capture = useFinanceCapture();
  const [owed, setOwed] = useState<Owed[]>([]);
  const [owedError, setOwedError] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ amount: '', comment: '' });

  useEffect(() => {
    supabase
      .from('bot_owed')
      .select('id, person, open_minor, due_on')
      .gt('open_minor', 0)
      .order('due_on', { ascending: true, nullsFirst: false })
      .then(({ data, error: e }: { data: Owed[] | null; error: unknown }) => {
        if (e) setOwedError(true);
        else setOwed(data ?? []);
      });
  }, [supabase]);

  const todayKey = dayKey(new Date().toISOString());
  const todayMinor = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.direction === 'expense' &&
            r.finance_categories?.kind !== 'transfer' &&
            dayKey(r.occurred_at) === todayKey
        )
        .reduce((s, r) => s + r.amount_minor, 0),
    [rows, todayKey]
  );
  const recent = useMemo(
    () => [...rows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 15),
    [rows]
  );

  const add = useCallback(async () => {
    const line = text.trim();
    if (!line) return;
    const decision = routeCapture(line);
    if (decision.target !== 'finance') return setNote('That does not look like money.');
    const booked = await capture.book(line, decision);
    if (!booked) return setNote('Could not save. Try again.');
    setText('');
    setNote('Saved ✓');
    refetch();
  }, [text, capture, refetch]);

  const saveEdit = async (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const { patch, errors } = buildRowPatch(row, { ...toDraft(row), ...draft });
    if (errors.length) return setNote(errors[0]);
    await updateRow(id, patch);
    setEditing(null);
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p>Could not load your money. Close and open again.</p>;

  return (
    <div className="space-y-5">
      <section>
        <p className="text-xs uppercase text-muted-foreground">Spent today</p>
        <p className="text-3xl font-semibold">{formatMinor(todayMinor)}</p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Where the money is</h2>
        <ul className="divide-y rounded border">
          {positions.map((p) => (
            <li key={p.account.id} className="flex justify-between px-3 py-2">
              <span>{p.account.name}</span>
              <span className={p.uncounted ? 'text-muted-foreground' : ''}>
                {formatBalance(p.balance.minor, p.account.currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Owed to me</h2>
        {owedError ? (
          <p className="text-muted-foreground">Could not load the list.</p>
        ) : owed.length === 0 ? (
          <p className="text-muted-foreground">Nobody owes you.</p>
        ) : (
          <ul className="divide-y rounded border">
            {owed.map((o) => (
              <li key={o.id} className="flex justify-between px-3 py-2">
                <span>
                  {o.person}
                  {o.due_on ? <span className="text-xs text-muted-foreground"> · due {o.due_on}</span> : null}
                </span>
                <span>{formatAmount(o.open_minor, 'UZS')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-medium">Recent</h2>
        <ul className="divide-y rounded border">
          {recent.map((r) => (
            <li key={r.id} className="px-3 py-2">
              {editing === r.id ? (
                <div className="flex flex-wrap gap-2">
                  <input
                    className="w-28 rounded border px-2 py-1"
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  />
                  <input
                    className="min-w-0 flex-1 rounded border px-2 py-1"
                    value={draft.comment}
                    onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                  />
                  <button className="rounded border px-2" onClick={() => saveEdit(r.id)}>Save</button>
                  <button className="rounded border px-2" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {r.comment || r.finance_categories?.name || '—'}
                    <span className="text-xs text-muted-foreground"> · {r.finance_categories?.name ?? 'no category'}</span>
                  </span>
                  <span className={r.direction === 'income' ? 'text-green-600' : ''}>
                    {r.direction === 'income' ? '+' : '−'}
                    {formatMinor(r.amount_minor)}
                  </span>
                  <button
                    aria-label="Edit"
                    className="px-1"
                    onClick={() => {
                      setEditing(r.id);
                      setDraft({ amount: toDraft(r).amount, comment: r.comment });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    aria-label="Delete"
                    className="px-1"
                    onClick={() => {
                      if (window.confirm('Delete this line?')) void deleteRow(r.id);
                    }}
                  >
                    🗑
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form
        className="fixed inset-x-0 bottom-0 flex gap-2 border-t bg-background p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border px-3 py-2"
          placeholder="-10k taxi"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={!capture.ready}>
          Add
        </button>
        {note && <p className="absolute -top-6 left-3 text-xs">{note}</p>}
      </form>
    </div>
  );
}
