'use client';

import { useState } from 'react';
import { formatAmount, formatMinor } from '@/lib/finance/format';
import {
  planResolution,
  impliedRateMinor,
  type OpenTransfer,
} from '@/lib/finance/transfers';
import type { AccountRecord } from '@/lib/finance/accounts';
import { ArrowLeftRight } from 'lucide-react';

interface TransferQueueProps {
  open: OpenTransfer[];
  accounts: AccountRecord[];
  onResolve: (
    open: OpenTransfer,
    account: AccountRecord,
    counterpartMinor: number | null
  ) => Promise<string | null>;
}

/**
 * The transfers that are still half-mapped.
 *
 * Stage 1 pointed every imported row at one account and left the far side of
 * each transfer NULL rather than guessing. Now the real accounts exist and
 * those destinations are knowable — the 4,850,000 went to a dollar position,
 * the +151,000 came from his sister — but knowable BY SCOTT. Nothing here
 * infers anything; it asks, one row at a time, and only writes what it is
 * told.
 */
export default function TransferQueue({ open, accounts, onResolve }: TransferQueueProps) {
  if (open.length === 0)
    return (
      <p className="font-mono text-[11px] text-text-muted/70">
        Every transfer names both of its ends.
      </p>
    );

  return (
    <div className="rounded-lg border border-border/60 bg-surface/30 divide-y divide-border/20">
      {open.map((o) => (
        <Row key={o.row.id} open={o} accounts={accounts} onResolve={onResolve} />
      ))}
    </div>
  );
}

function Row({
  open,
  accounts,
  onResolve,
}: {
  open: OpenTransfer;
  accounts: AccountRecord[];
  onResolve: TransferQueueProps['onResolve'];
}) {
  const [picked, setPicked] = useState('');
  const [counterpart, setCounterpart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = accounts.filter((a) => a.is_active && a.id !== open.knownAccountId);
  const account = choices.find((a) => a.id === picked) ?? null;

  const counterpartMinor = (() => {
    const major = Number(counterpart.replace(/[\s,]/g, ''));
    return Number.isFinite(major) && counterpart.trim() !== ''
      ? Math.round(major * 100)
      : null;
  })();

  const plan = account ? planResolution(open, account, counterpartMinor) : null;
  const crossCurrency = account !== null && account.currency !== open.row.currency;

  const submit = async () => {
    if (!account) return;
    setBusy(true);
    setError(null);
    const err = await onResolve(open, account, counterpartMinor);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs tabular-nums text-text-primary">
          {formatAmount(open.row.amount_minor, open.row.currency)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-muted">
          {open.row.raw_input}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-text-muted/60">
          {open.missing === 'destination' ? 'went where?' : 'came from where?'}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <select
          value={picked}
          onChange={(e) => {
            setPicked(e.target.value);
            setError(null);
          }}
          aria-label={open.missing === 'destination' ? 'Destination account' : 'Source account'}
          className="rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
            text-text-primary focus:border-accent/40 focus:outline-none"
        >
          <option value="">pick an account</option>
          {choices.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>

        {crossCurrency && (
          <input
            value={counterpart}
            onChange={(e) => setCounterpart(e.target.value)}
            inputMode="decimal"
            placeholder={`${account!.currency} that ${
              open.missing === 'destination' ? 'arrived' : 'left'
            }`}
            aria-label="Counterpart amount"
            className="w-36 rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
              tabular-nums text-text-primary focus:border-accent/40 focus:outline-none"
          />
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy || !plan || plan.kind === 'refused'}
          className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-xs
            text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
        >
          {plan?.kind === 'pair' ? 'write both rows' : 'set it'}
        </button>
      </div>

      {plan?.kind === 'refused' && (
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-[#F59E0B]">
          {plan.reason}
        </p>
      )}

      {plan?.kind === 'pair' && counterpartMinor !== null && (
        <p className="mt-1 flex items-start gap-1.5 font-mono text-[10px] leading-relaxed text-text-muted">
          <ArrowLeftRight size={11} className="mt-0.5 shrink-0" />
          <span>
            Two movements, not one — the som went out to be changed and the dollars
            came back. Rate implied:{' '}
            <span className="text-text-primary">
              {open.row.currency === 'UZS'
                ? formatMinor(impliedRateMinor(open.row.amount_minor, counterpartMinor) ?? 0)
                : formatMinor(impliedRateMinor(counterpartMinor, open.row.amount_minor) ?? 0)}
            </span>{' '}
            per dollar. That rate is shown, never used — the household total converts
            at the rate you set by hand.
          </span>
        </p>
      )}

      {error && <p className="mt-1 font-mono text-[10px] text-[#EF4444]">{error}</p>}
    </div>
  );
}
