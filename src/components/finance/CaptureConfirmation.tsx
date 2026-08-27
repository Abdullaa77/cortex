'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMinor } from '@/lib/finance/format';
import { CATEGORIES } from '@/lib/finance/categorize';
import { toDraftDateTime, fromDraftDateTime } from '@/lib/finance/edit';
import type { CaptureBooking } from '@/hooks/useFinanceCapture';
import { CalendarClock, Check, X } from 'lucide-react';

interface CaptureConfirmationProps {
  booking: CaptureBooking;
  onSetCategory: (transactionId: string, comment: string, slug: string) => Promise<void>;
  onSetOccurredAt: (transactionId: string, occurredAt: string) => Promise<void>;
  onUndo: () => Promise<void>;
  onNotMoney: () => Promise<void>;
  onDismiss: () => void;
}

/**
 * Shown inline under the capture bar, never as a modal — a modal would break
 * the type-and-move rhythm that makes the bar worth using.
 *
 * The success state has to be unmistakable. "booked" on its own did not read
 * as confirmation — Scott went looking for a confirm button that deliberately
 * does not exist. A tick, the word "saved", and a link that shows him the row
 * answer "did that land?" by proof rather than by wording.
 *
 * "not money" is the important control here. The routing rule is allowed to
 * misfire because this escape costs one tap; without it an imperfect detector
 * would quietly write wrong records.
 *
 * Date and time sit here for the same reason the category does: the row is
 * already saved. Putting a picker in front of the input would tax every
 * capture to serve the few that were not today. "-10k banana" and enter still
 * books instantly; the date is a tap away afterwards, on the occasions it is
 * wrong.
 */
export default function CaptureConfirmation({
  booking,
  onSetCategory,
  onSetOccurredAt,
  onUndo,
  onNotMoney,
  onDismiss,
}: CaptureConfirmationProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(booking.rows);

  const single = rows.length === 1 ? rows[0] : null;
  const totalMinor = rows.reduce((n, r) => n + r.amountMinor, 0);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const chooseCategory = async (slug: string) => {
    if (!single) return;
    setPickerOpen(false);
    setRows((curr) => curr.map((r) => ({ ...r, categorySlug: slug })));
    await run(() => onSetCategory(single.id, single.comment, slug));
  };

  const currentCategory = single?.categorySlug
    ? CATEGORIES.find((c) => c.slug === single.categorySlug)
    : undefined;

  const when = single ? toDraftDateTime(single.occurredAt) : { date: '', time: '' };

  const chooseWhen = async (date: string, time: string) => {
    if (!single) return;
    const occurredAt = fromDraftDateTime(date, time);
    if (!occurredAt) return;
    setRows((curr) => curr.map((r) => ({ ...r, occurredAt })));
    await run(() => onSetOccurredAt(single.id, occurredAt));
  };

  return (
    <div
      className="border-t border-accent/15 bg-accent/[0.04] px-4 py-2 font-mono text-xs page-enter"
      role="status"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex items-center gap-1 text-accent text-glow-sm">
          <Check size={13} strokeWidth={3} />
          saved to Finance
        </span>
        <span className="text-accent/25">·</span>

        {single ? (
          <>
            <span
              style={{ color: single.direction === 'income' ? '#00FF88' : '#EF4444' }}
            >
              {single.direction}
            </span>
            <span className="text-accent/25">·</span>
            <span className="tabular-nums text-text-primary">
              {formatMinor(single.amountMinor)} {single.currency}
            </span>
            <span className="text-accent/25">·</span>

            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                disabled={busy}
                className="rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40"
                style={{
                  borderColor: `${currentCategory?.color ?? '#6B7280'}55`,
                  color: currentCategory?.color ?? '#6B7280',
                  backgroundColor: `${currentCategory?.color ?? '#6B7280'}15`,
                }}
              >
                {currentCategory
                  ? `${currentCategory.icon} ${currentCategory.name}`
                  : '? uncategorised'}
                <span className="ml-1 opacity-60">▾</span>
              </button>

              {pickerOpen && (
                <div
                  className="absolute bottom-full left-0 z-50 mb-1.5 max-h-64 w-52 overflow-y-auto
                    rounded-lg border border-border bg-surface p-1 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
                >
                  {CATEGORIES.filter((c) => c.kind !== 'income').map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => chooseCategory(c.slug)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px]
                        text-text-muted transition-colors hover:bg-surface2 hover:text-text-primary"
                    >
                      <span style={{ color: c.color }}>{c.icon}</span>
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="text-accent/25">·</span>

            <div className="relative">
              <button
                type="button"
                onClick={() => setWhenOpen((o) => !o)}
                disabled={busy}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5
                  text-[11px] text-text-muted transition-colors hover:text-text-primary
                  disabled:opacity-40"
              >
                <CalendarClock size={11} />
                {whenLabel(single.occurredAt)}
                <span className="ml-0.5 opacity-60">▾</span>
              </button>

              {whenOpen && (
                <div
                  className="absolute bottom-full left-0 z-50 mb-1.5 flex w-max flex-col gap-1.5
                    rounded-lg border border-border bg-surface p-2 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={when.date}
                      onChange={(e) => chooseWhen(e.target.value, when.time)}
                      aria-label="Date"
                      className="rounded border border-border bg-surface2 px-1.5 py-0.5 text-[11px]
                        text-text-primary focus:border-accent/40 focus:outline-none"
                    />
                    <input
                      type="time"
                      value={when.time}
                      onChange={(e) => chooseWhen(when.date, e.target.value)}
                      aria-label="Time"
                      className="rounded border border-border bg-surface2 px-1.5 py-0.5 text-[11px]
                        text-text-primary focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setWhenOpen(false)}
                    className="self-end text-[11px] text-accent transition-colors hover:text-accent-dim"
                  >
                    done
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="text-text-primary">{rows.length} entries</span>
            <span className="text-accent/25">·</span>
            <span className="tabular-nums text-text-primary">{formatMinor(totalMinor)}</span>
            <span className="text-text-muted/60">— set categories in /finance</span>
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          <Link
            href={
              single
                ? `/finance/transactions?highlight=${single.id}`
                : '/finance/transactions'
            }
            onClick={onDismiss}
            className="text-accent transition-colors hover:text-accent-dim"
          >
            view
          </Link>
          <button
            type="button"
            onClick={() => run(onUndo)}
            disabled={busy}
            className="text-text-muted transition-colors hover:text-text-primary disabled:opacity-40"
          >
            undo
          </button>
          <button
            type="button"
            onClick={() => run(onNotMoney)}
            disabled={busy}
            className="text-text-muted transition-colors hover:text-[#F59E0B] disabled:opacity-40"
            title="Remove this and file the original text to inbox instead"
          >
            not money
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-text-muted/50 transition-colors hover:text-text-primary"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "now" while the row still carries the instant it was captured, and the real
 * date once it has been moved. The strip is read at a glance — repeating
 * today's date on every capture would be noise, and saying "now" makes the
 * control's purpose obvious without a label.
 */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay && Math.abs(now.getTime() - d.getTime()) < 60_000) return 'now';
  if (sameDay)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
