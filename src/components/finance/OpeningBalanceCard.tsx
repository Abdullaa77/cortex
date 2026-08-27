'use client';

import { useState } from 'react';
import { formatMinor } from '@/lib/finance/format';
import type { OpeningBalance } from '@/hooks/useOpeningBalance';
import type { Reconciliation } from '@/lib/finance/reconcile';
import { Pencil, X } from 'lucide-react';

interface OpeningBalanceCardProps {
  reconciliation: Reconciliation;
  /** Label of the first month with rows — the one the balance opens. */
  firstMonthLabel: string | null;
  onSave: (next: OpeningBalance) => Promise<void>;
  onClear: () => Promise<void>;
}

/**
 * One amount, one as-of date, entered once.
 *
 * Until it is set, the page states what the first month would have needed
 * instead of printing a closing balance. That figure is derived from the
 * transactions themselves, so it is a real claim about the data rather than a
 * placeholder — and it is usually close enough that Scott can confirm or
 * correct it in one go, which is the point of showing it.
 */
export default function OpeningBalanceCard({
  reconciliation,
  firstMonthLabel,
  onSave,
  onClear,
}: OpeningBalanceCardProps) {
  const { opening, requiredOpeningMinor, firstMonthKey } = reconciliation;
  const [editing, setEditing] = useState(false);

  if (!firstMonthKey) return null;

  const month = firstMonthLabel ?? firstMonthKey;

  if (editing || !opening)
    return (
      <Editor
        opening={opening}
        month={month}
        firstMonthKey={firstMonthKey}
        requiredOpeningMinor={requiredOpeningMinor}
        onCancel={opening ? () => setEditing(false) : null}
        onClear={
          opening
            ? async () => {
                await onClear();
                setEditing(false);
              }
            : null
        }
        onSave={async (next) => {
          await onSave(next);
          setEditing(false);
        }}
      />
    );

  return (
    <div className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
          Opening balance
        </span>
        <span className="font-mono text-sm tabular-nums text-text-primary">
          {formatMinor(opening.amountMinor)}
        </span>
        <span className="font-mono text-[10px] text-text-muted/60">
          held on {opening.asOf}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit opening balance"
          className="ml-auto text-text-muted transition-colors hover:text-text-primary"
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
}

function Editor({
  opening,
  month,
  firstMonthKey,
  requiredOpeningMinor,
  onCancel,
  onClear,
  onSave,
}: {
  opening: OpeningBalance | null;
  month: string;
  firstMonthKey: string;
  requiredOpeningMinor: number;
  onCancel: (() => void) | null;
  onClear: (() => Promise<void>) | null;
  onSave: (next: OpeningBalance) => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    opening ? (opening.amountMinor / 100).toString() : ''
  );
  const [asOf, setAsOf] = useState(opening?.asOf ?? `${firstMonthKey}-01`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const major = Number(amount.replace(/[\s,]/g, ''));
    if (!Number.isFinite(major)) {
      setError('Enter a number.');
      return;
    }
    if (!asOf) {
      setError('Pick the date that amount was held.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave({ amountMinor: Math.round(major * 100), asOf });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
          Opening balance
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {!opening && (
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-text-muted">
          Not set, so no month has a closing balance.{' '}
          {requiredOpeningMinor > 0 ? (
            <>
              {month} would need to start with at least{' '}
              <button
                type="button"
                onClick={() => setAmount((requiredOpeningMinor / 100).toString())}
                className="text-accent underline decoration-dotted underline-offset-2"
              >
                {formatMinor(requiredOpeningMinor)}
              </button>{' '}
              for these numbers to be possible.
            </>
          ) : (
            <>Every month stays above zero from nothing, so any figure works.</>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          inputMode="decimal"
          placeholder="amount held"
          aria-label="Opening balance amount"
          className="w-36 rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
            tabular-nums text-text-primary focus:border-accent/40 focus:outline-none"
        />
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          aria-label="Held as of"
          className="rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
            text-text-primary focus:border-accent/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-xs
            text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
        >
          save
        </button>

        {onClear && (
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onClear();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            title="Remove it — the page goes back to stating what the first month would need"
            className="font-mono text-[11px] text-text-muted transition-colors
              hover:text-[#EF4444] disabled:opacity-40"
          >
            remove
          </button>
        )}
      </div>

      {error && <p className="mt-1.5 font-mono text-[11px] text-[#EF4444]">{error}</p>}
    </div>
  );
}
