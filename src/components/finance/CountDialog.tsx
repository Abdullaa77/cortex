'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatAmount, formatMinor } from '@/lib/finance/format';
import {
  planCount,
  explainGap,
  type CountResult,
  type MovementRow,
  type BalanceCheckpoint,
} from '@/lib/finance/checkpoints';
import { today } from '@/lib/finance/positions';
import type { AccountRecord } from '@/lib/finance/accounts';
import type { GapPattern } from '@/lib/finance/checkpoints';
import { AlertCircle, Trash2 } from 'lucide-react';

interface CountDialogProps {
  account: AccountRecord | null;
  checkpoints: BalanceCheckpoint[];
  movements: MovementRow[];
  /**
   * The line. A count dated on it is establishing ground zero, not
   * reconciling a period, so the preview must be asked the same question the
   * write path will ask — otherwise the screen promises an adjustment that
   * never gets written, or stays silent about one that does.
   */
  cutoverDate: string | null;
  history: { ledger: CountResult[]; pattern: GapPattern };
  onClose: () => void;
  onSave: (input: {
    countedAt: string;
    countedMinor: number;
    note: string | null;
  }) => Promise<string | null>;
  onDeleteCheckpoint: (id: string) => Promise<string | null>;
}

/**
 * Counting a drawer.
 *
 * The whole screen is one idea: you type what is actually there, and before
 * you save, the app tells you what it thought was there and which way the two
 * disagree. The gap is shown in words as well as in a number, because the sign
 * is the message and a minus in front of a large figure is easy to read as the
 * opposite of what it says.
 *
 * The adjustment is described before it is written. It is never silent, and it
 * never goes into a real category — a recurring gap of the same sign says
 * something is systematically not getting typed, and burying it in "Other"
 * destroys exactly that.
 */
export default function CountDialog({
  account,
  checkpoints,
  movements,
  cutoverDate,
  history,
  onClose,
  onSave,
  onDeleteCheckpoint,
}: CountDialogProps) {
  const [countedAt, setCountedAt] = useState(today());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedMinor = useMemo(() => {
    const major = Number(amount.replace(/[\s,]/g, ''));
    return Number.isFinite(major) && amount.trim() !== '' ? Math.round(major * 100) : null;
  }, [amount]);

  // The PLAN, not the pure comparison underneath it. The preview and the write
  // path now ask one function the same question, so the screen cannot promise
  // an adjustment that never gets written or stay quiet about one that does.
  const preview = useMemo(() => {
    if (!account || countedMinor === null) return null;
    return planCount({
      accountId: account.id,
      countedAt,
      countedMinor,
      checkpoints,
      movements,
      cutoverDate,
    });
  }, [account, checkpoints, movements, countedAt, countedMinor, cutoverDate]);

  if (!account) return null;

  const submit = async () => {
    if (countedMinor === null) {
      setError('Enter what you counted.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onSave({
      countedAt,
      countedMinor,
      note: note.trim() || null,
    });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title={`Count — ${account.name}`}>
      <div className="flex flex-col gap-3">
        <p className="font-mono text-[11px] leading-relaxed text-text-muted">
          Open it and count it. What you find is the truth; the ledger is the story
          about how it got there. Where they disagree, this is where you find out.
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={countedAt}
            onChange={(e) => setCountedAt(e.target.value)}
            aria-label="Counted on"
            className="rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
              text-text-primary focus:border-accent/40 focus:outline-none"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            inputMode="decimal"
            autoFocus
            placeholder={account.currency === 'USD' ? 'dollars counted' : "so'm counted"}
            aria-label="Amount counted"
            className="w-40 rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
              tabular-nums text-text-primary focus:border-accent/40 focus:outline-none"
          />
        </div>

        {preview && (
          <GapPreview
            result={preview.result}
            establishesLine={preview.establishesLine}
            account={account}
          />
        )}

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
          aria-label="Note"
          className="rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
            text-text-primary focus:border-accent/40 focus:outline-none"
        />

        {error && <p className="font-mono text-[11px] text-[#EF4444]">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy || countedMinor === null}
            className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-xs
              text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          >
            save the count
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] text-text-muted transition-colors hover:text-text-primary"
          >
            cancel
          </button>
        </div>

        <History
          history={history}
          account={account}
          checkpoints={checkpoints}
          onDelete={onDeleteCheckpoint}
        />
      </div>
    </Modal>
  );
}

function GapPreview({
  result,
  establishesLine,
  account,
}: {
  result: CountResult;
  /** The day this count is about to draw the line at, when no line is set. */
  establishesLine: string | null;
  account: AccountRecord;
}) {
  /**
   * SAID OUT LOUD, BEFORE IT HAPPENS.
   *
   * There are two ways to reach this dialog and only one of them — the wizard —
   * ever set a cutover date. So a count taken from the positions card draws the
   * line itself, and this is the sentence that makes that a decision Scott took
   * rather than something the app did behind him. The night it was missing cost
   * 3,488,123.87 so'm of fictional September spending.
   */
  if (establishesLine)
    return (
      <div className="rounded border border-accent/40 bg-accent/[0.06] px-2.5 py-2">
        <p className="font-mono text-[11px] leading-relaxed text-text-primary">
          No cutover is set yet, so saving this draws the line at{' '}
          <span className="text-accent">{establishesLine}</span>.
        </p>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-text-muted">
          Everything before it becomes reference — real, kept, still shown, and never
          expected to reconcile against a drawer. Nothing is written beyond the count
          itself: no gap, no adjustment, however far the earlier notes have drifted.
          Counts from here on are measured against this one.
        </p>
      </div>
    );

  if (result.kind === 'opening' || result.kind === 'cutover')
    return (
      <div className="rounded border border-accent/20 bg-accent/[0.03] px-2.5 py-2">
        <p className="font-mono text-[11px] leading-relaxed text-text-muted">
          {explainGap(result)}{' '}
          {result.kind === 'opening'
            ? `Nothing to reconcile against — this becomes ${account.name}'s opening balance, and everything after it is measured from here.`
            : `Whatever the reconstructed notes derive for ${account.name} is reference, not a claim about this drawer. Nothing is written beyond the count itself, and the next count is measured from here.`}
        </p>
      </div>
    );

  if (result.kind === 'matched')
    return (
      <div className="rounded border border-accent/20 bg-accent/[0.03] px-2.5 py-2">
        <p className="font-mono text-[11px] leading-relaxed text-accent">
          {explainGap(result)} Nothing is written beyond the count itself.
        </p>
      </div>
    );

  const missing = result.kind === 'money-missing';
  const gap = Math.abs(result.gapMinor ?? 0);

  return (
    <div
      className="rounded border px-2.5 py-2"
      style={{
        borderColor: missing ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)',
        background: missing ? 'rgba(239,68,68,0.04)' : 'rgba(245,158,11,0.04)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className="text-text-muted">The ledger says</span>
        <span className="tabular-nums text-text-primary">
          {formatAmount(result.derivedMinor ?? 0, account.currency)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className="text-text-muted">You counted</span>
        <span className="tabular-nums text-text-primary">
          {formatAmount(result.countedMinor, account.currency)}
        </span>
      </div>
      <div
        className="mt-1 flex items-baseline justify-between gap-2 border-t border-border/30 pt-1
          font-mono text-[11px] font-semibold"
        style={{ color: missing ? '#EF4444' : '#F59E0B' }}
      >
        <span>{missing ? 'Missing' : 'Extra'}</span>
        <span className="tabular-nums">{formatAmount(gap, account.currency)}</span>
      </div>

      <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-text-muted">
        {explainGap(result)} Saving writes a visible{' '}
        {formatAmount(gap, account.currency)}{' '}
        {missing ? 'expense' : 'income'} row under{' '}
        <span className="text-text-primary">Unaccounted</span>, dated{' '}
        {result.countedAt}. It is never folded into a real category — a gap that
        keeps pointing the same way is worth seeing.
      </p>
    </div>
  );
}

function History({
  history,
  account,
  checkpoints,
  onDelete,
}: {
  history: { ledger: CountResult[]; pattern: GapPattern };
  account: AccountRecord;
  checkpoints: BalanceCheckpoint[];
  onDelete: (id: string) => Promise<string | null>;
}) {
  const { ledger, pattern } = history;
  if (ledger.length === 0) return null;

  const idFor = (countedAt: string) =>
    checkpoints.find((c) => c.account_id === account.id && c.counted_at === countedAt)?.id ??
    null;

  return (
    <div className="border-t border-border/30 pt-2">
      <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
        Counts so far
      </span>

      {pattern.consistent && pattern.gapCount > 1 && (
        <p className="mt-1 flex items-start gap-1.5 font-mono text-[10px] leading-relaxed text-[#F59E0B]">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          <span>
            {pattern.gapCount} counts in a row came out{' '}
            {pattern.kind === 'money-missing' ? 'short' : 'over'}, averaging{' '}
            {formatMinor(Math.abs(pattern.averageMinor))}. That is not noise — it is
            one kind of {pattern.kind === 'money-missing' ? 'spending' : 'income'} that
            is systematically not getting typed.
          </span>
        </p>
      )}

      <div className="mt-1 flex flex-col">
        {[...ledger].reverse().map((r) => {
          const id = idFor(r.countedAt);
          return (
            <div
              key={r.countedAt}
              className="flex items-baseline gap-2 border-b border-border/15 py-1 last:border-b-0
                font-mono text-[10px]"
            >
              <span className="text-text-muted">{r.countedAt}</span>
              <span className="tabular-nums text-text-primary">
                {formatAmount(r.countedMinor, account.currency)}
              </span>
              <span
                className="ml-auto tabular-nums"
                style={{
                  color:
                    r.kind === 'money-missing'
                      ? '#EF4444'
                      : r.kind === 'money-appeared'
                        ? '#F59E0B'
                        : '#6B7280',
                }}
              >
                {r.gapMinor === null
                  ? r.kind === 'cutover'
                    ? 'cutover'
                    : 'opening'
                  : r.gapMinor === 0
                    ? 'matched'
                    : `${r.gapMinor < 0 ? '-' : '+'}${formatMinor(Math.abs(r.gapMinor))}`}
              </span>
              {id && (
                <button
                  type="button"
                  onClick={() => onDelete(id)}
                  aria-label={`Remove the count from ${r.countedAt}`}
                  title="Removes the count. The adjustment it wrote stays — that money really did go missing."
                  className="shrink-0 text-text-muted/50 transition-colors hover:text-[#EF4444]"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
