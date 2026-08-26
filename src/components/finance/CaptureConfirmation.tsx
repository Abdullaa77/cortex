'use client';

import { useState } from 'react';
import { formatMinor } from '@/lib/finance/format';
import { CATEGORIES } from '@/lib/finance/categorize';
import type { CaptureBooking } from '@/hooks/useFinanceCapture';
import { X } from 'lucide-react';

interface CaptureConfirmationProps {
  booking: CaptureBooking;
  onSetCategory: (transactionId: string, comment: string, slug: string) => Promise<void>;
  onUndo: () => Promise<void>;
  onNotMoney: () => Promise<void>;
  onDismiss: () => void;
}

/**
 * Shown inline under the capture bar, never as a modal — a modal would break
 * the type-and-move rhythm that makes the bar worth using.
 *
 * "not money" is the important control here. The routing rule is allowed to
 * misfire because this escape costs one tap; without it an imperfect detector
 * would quietly write wrong records.
 */
export default function CaptureConfirmation({
  booking,
  onSetCategory,
  onUndo,
  onNotMoney,
  onDismiss,
}: CaptureConfirmationProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
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

  return (
    <div
      className="border-t border-accent/15 bg-accent/[0.04] px-4 py-2 font-mono text-xs page-enter"
      role="status"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-accent text-glow-sm">booked</span>
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
