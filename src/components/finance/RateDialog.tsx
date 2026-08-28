'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatMinor } from '@/lib/finance/format';
import { today } from '@/lib/finance/positions';
import type { FinanceSettings } from '@/hooks/useAccounts';

interface RateDialogProps {
  open: boolean;
  settings: FinanceSettings;
  onClose: () => void;
  onSave: (patch: Partial<FinanceSettings>) => Promise<string | null>;
}

/**
 * The rate the household total is stated at.
 *
 * Entered by hand, and there is no fetch button. A rate that moves on its own
 * makes yesterday's total unreproducible — open the page twice and get two
 * answers with no edit in between — and Scott changes money at a counter, at a
 * rate he knows and can type. Its date is stored with it so the total can say
 * how old the number underneath it is.
 *
 * It converts positions only. It never touches a month total: those are so'm
 * figures built from so'm rows, and putting a hand-entered rate under them
 * would mean one edit here silently restates months of history.
 */
export default function RateDialog({ open, settings, onClose, onSave }: RateDialogProps) {
  const [rate, setRate] = useState(
    settings.uzsPerUsdMinor === null ? '' : String(settings.uzsPerUsdMinor / 100)
  );
  const [setAt, setSetAt] = useState(settings.fxRateSetAt ?? today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    const major = Number(rate.replace(/[\s,]/g, ''));
    if (!Number.isFinite(major) || major <= 0) {
      setError("Enter how many so'm one dollar is.");
      return;
    }
    setBusy(true);
    const err = await onSave({
      uzsPerUsdMinor: Math.round(major * 100),
      fxRateSetAt: setAt,
    });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  const clear = async () => {
    setBusy(true);
    const err = await onSave({ uzsPerUsdMinor: null, fxRateSetAt: null });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="Exchange rate">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-[11px] leading-relaxed text-text-muted">
          So&apos;m to the dollar, as you last changed it. Typed, never fetched — a
          rate that drifts on its own makes yesterday&apos;s household total
          impossible to reproduce. Positions stay native either way; this only
          converts them into the one figure at the bottom.
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            inputMode="decimal"
            autoFocus
            placeholder="12650"
            aria-label="So'm per dollar"
            className="w-32 rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
              tabular-nums text-text-primary focus:border-accent/40 focus:outline-none"
          />
          <span className="font-mono text-[10px] text-text-muted">so&apos;m / $</span>
          <input
            type="date"
            value={setAt}
            onChange={(e) => setSetAt(e.target.value)}
            aria-label="Rate set on"
            className="rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
              text-text-primary focus:border-accent/40 focus:outline-none"
          />
        </div>

        {error && <p className="font-mono text-[11px] text-[#EF4444]">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-xs
              text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          >
            save
          </button>
          {settings.uzsPerUsdMinor !== null && (
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              title="The household total goes back to saying it has no rate, rather than guessing one"
              className="font-mono text-[11px] text-text-muted transition-colors
                hover:text-[#EF4444] disabled:opacity-40"
            >
              remove ({formatMinor(settings.uzsPerUsdMinor)}/$)
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
