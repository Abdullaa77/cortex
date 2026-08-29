'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import LoadingState from '@/components/ui/LoadingState';
import { useFinanceSummary } from '@/hooks/useFinanceSummary';
import { formatAmount, formatMinor } from '@/lib/finance/format';
import {
  activeAccounts,
  validateAccountDraft,
  type AccountDraft,
  type AccountRecord,
} from '@/lib/finance/accounts';
import { today } from '@/lib/finance/positions';
import {
  Check,
  Plus,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  Archive,
  Undo2,
} from 'lucide-react';

/**
 * The cutover: one sitting, not three.
 *
 * Stage 1 stored `cutover_date` and gave it no screen, deliberately — because
 * picking the date, deciding what the containers are, and counting them are
 * one physical act. You sit down with the drawers open. Splitting that across
 * three settings pages would mean each one is done at a different time and the
 * counts stop being simultaneous, which is the only thing that makes an
 * opening position a position rather than three guesses.
 *
 * Coming out of here every account has checkpoint #0 and the household has a
 * real opening. Everything dated before the line stays visible as REFERENCE —
 * real, kept, still shown, and excluded from the position math by the ordinary
 * rule that a count supersedes everything up to its own day.
 */
export default function CutoverPage() {
  const {
    accounts: store,
    movements,
    positions,
    unaccountedCategoryId,
    loading,
  } = useFinanceSummary();

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [date, setDate] = useState<string>(store.settings.cutoverDate ?? today());
  const [error, setError] = useState<string | null>(null);

  const counted = useMemo(
    () =>
      new Set(
        store.checkpoints.filter((c) => c.counted_at === date).map((c) => c.account_id)
      ),
    [store.checkpoints, date]
  );

  if (loading)
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState />
        </div>
      </AppShell>
    );

  // Same rule PositionsCard keeps: a load that failed is not a household with
  // no accounts. Walking someone through a cutover on top of a broken read
  // would have them create accounts that already exist, and count drawers that
  // already have checkpoints.
  if (store.error)
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
          <Header />
          <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/[0.04] px-3 py-3">
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-[#EF4444]">
              <AlertCircle size={12} className="shrink-0" />
              Could not load the accounts.
            </p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-text-muted">
              The cutover cannot start without knowing which accounts already
              exist — an empty list here would be a guess, not an answer.
            </p>
            <p className="mt-1.5 break-words font-mono text-[10px] leading-relaxed text-text-muted/70">
              {store.error}
            </p>
            <button
              type="button"
              onClick={store.refetch}
              className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-accent
                transition-colors hover:text-accent-dim"
            >
              <RefreshCw size={12} /> Try again
            </button>
          </div>
        </div>
      </AppShell>
    );

  const active = store.activeAccounts;
  const allCounted = active.length > 0 && active.every((a) => counted.has(a.id));

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
        <Header />

        <Steps step={step} />

        {step === 0 && (
          <PickDate
            date={date}
            setDate={setDate}
            saved={store.settings.cutoverDate}
            error={error}
            onNext={async () => {
              const err = await store.saveSettings({ cutoverDate: date });
              if (err) setError(err);
              else {
                setError(null);
                setStep(1);
              }
            }}
          />
        )}

        {step === 1 && (
          <AddAccounts
            // All of them, not just the active ones: a row retired by mistake
            // has to be visible to be brought back, and the uniqueness check
            // has to see retired names because the database's UNIQUE does.
            accounts={store.accounts}
            defaultAccountId={store.settings.defaultAccountId}
            onCreate={store.createAccount}
            onRename={store.renameAccount}
            onRetire={store.retireAccount}
            onRestore={(id) => store.updateAccount(id, { is_active: true })}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <CountThem
            accounts={active}
            date={date}
            counted={counted}
            positions={positions}
            onBack={() => setStep(1)}
            onCount={(accountId, countedMinor) =>
              store.recordCount({
                accountId,
                countedAt: date,
                countedMinor,
                note: 'Cutover count.',
                movements,
                unaccountedCategoryId,
              })
            }
            allCounted={allCounted}
          />
        )}
      </div>
    </AppShell>
  );
}

function Header() {
  return (
    <>
      <div
        className="mb-3 mt-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]"
        style={{ color: '#4A6858' }}
      >
        <span>--</span>
        <span>THE CUTOVER</span>
        <span className="flex-1 section-line" />
      </div>
      <p className="mb-4 font-mono text-[11px] leading-relaxed text-text-muted">
        Everything before the line is <span className="text-text-primary">reference</span> —
        real, kept, still shown, and never expected to reconcile against a drawer.
        Everything from the line onward is <span className="text-accent">truth</span>. Do
        this in one sitting with the drawers open; counts taken on three different
        days are three guesses, not a position.
      </p>
    </>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ['pick the date', 'name the containers', 'count them'];
  return (
    <div className="mb-4 flex items-center gap-2 font-mono text-[10px]">
      {labels.map((label, i) => (
        <span key={label} className="flex items-center gap-2">
          <span
            className={
              i === step
                ? 'text-accent'
                : i < step
                  ? 'text-text-muted'
                  : 'text-text-muted/40'
            }
          >
            {i < step && <Check size={10} className="mr-1 inline" />}
            {i + 1}. {label}
          </span>
          {i < labels.length - 1 && <span className="text-text-muted/30">/</span>}
        </span>
      ))}
    </div>
  );
}

function PickDate({
  date,
  setDate,
  saved,
  error,
  onNext,
}: {
  date: string;
  setDate: (d: string) => void;
  saved: string | null;
  error: string | null;
  onNext: () => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] px-3 py-3">
      <p className="font-mono text-[11px] leading-relaxed text-text-muted">
        The day you are counting. Rows dated on the line itself are already inside
        what you count, so the line belongs to the truth side.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Cutover date"
          className="rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
            text-text-primary focus:border-accent/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent/10
            px-2.5 py-1 font-mono text-xs text-accent transition-colors hover:bg-accent/20"
        >
          next <ArrowRight size={11} />
        </button>
      </div>
      {saved && saved !== date && (
        <p className="mt-1.5 font-mono text-[10px] text-[#F59E0B]">
          The line is currently {saved}. Moving it reclassifies rows immediately — the
          mark is derived, never stored, so nothing goes stale.
        </p>
      )}
      {error && <p className="mt-1.5 font-mono text-[11px] text-[#EF4444]">{error}</p>}
    </div>
  );
}

const OWNERS: AccountDraft['owner'][] = ['me', 'mom', 'sister'];
const KINDS: AccountDraft['kind'][] = ['cash', 'card', 'savings'];
const CURRENCIES: AccountDraft['currency'][] = ['UZS', 'USD'];

function AddAccounts({
  accounts,
  defaultAccountId,
  onCreate,
  onRename,
  onRetire,
  onRestore,
  onBack,
  onNext,
}: {
  accounts: AccountRecord[];
  defaultAccountId: string | null;
  onCreate: (draft: AccountDraft) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  onRetire: (
    id: string
  ) => Promise<{ error: string | null; defaultMovedTo: AccountRecord | null }>;
  onRestore: (id: string) => Promise<string | null>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState<AccountDraft>({
    name: '',
    owner: 'me',
    currency: 'UZS',
    kind: 'cash',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Said out loud when retiring moves where captures land. Never silent. */
  const [notice, setNotice] = useState<string | null>(null);

  const check = validateAccountDraft(draft, accounts);
  const active = activeAccounts(accounts);
  const retired = accounts.filter((a) => !a.is_active);

  const add = async () => {
    setBusy(true);
    const err = await onCreate(draft);
    setBusy(false);
    if (err) setError(err);
    else {
      setError(null);
      setDraft({ ...draft, name: '' });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[11px] leading-relaxed text-text-muted">
        One account per thing you can count separately. Mom&apos;s som cash and
        mom&apos;s dollar cash are two accounts even in one drawer — that is how they
        get counted, and the counting is the point.
      </p>

      {accounts.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-surface/30 divide-y divide-border/20">
          {[...active, ...retired].map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              isDefault={a.id === defaultAccountId}
              onRename={(name) => onRename(a.id, name)}
              onRetire={async () => {
                const result = await onRetire(a.id);
                if (!result.error && result.defaultMovedTo)
                  setNotice(`Captures now land in ${result.defaultMovedTo.name}.`);
                return result.error;
              }}
              onRestore={() => onRestore(a.id)}
            />
          ))}
        </div>
      )}

      {notice && (
        <p className="font-mono text-[11px] leading-relaxed text-[#F59E0B]">{notice}</p>
      )}

      <div className="rounded-lg border border-accent/20 bg-accent/[0.03] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && check.ok && add()}
            placeholder="name it as you say it out loud"
            aria-label="Account name"
            className="w-56 rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
              text-text-primary focus:border-accent/40 focus:outline-none"
          />
          <Select
            label="Owner"
            value={draft.owner}
            options={OWNERS}
            onChange={(v) => setDraft({ ...draft, owner: v })}
          />
          <Select
            label="Currency"
            value={draft.currency}
            options={CURRENCIES}
            onChange={(v) => setDraft({ ...draft, currency: v })}
          />
          <Select
            label="Kind"
            value={draft.kind}
            options={KINDS}
            onChange={(v) => setDraft({ ...draft, kind: v })}
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !check.ok}
            className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10
              px-2.5 py-1 font-mono text-xs text-accent transition-colors hover:bg-accent/20
              disabled:opacity-40"
          >
            <Plus size={11} /> add
          </button>
        </div>
        {(error || (draft.name && !check.ok)) && (
          <p className="mt-1.5 font-mono text-[11px] text-[#EF4444]">
            {error ?? check.errors[0]}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted
            transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={11} /> back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={active.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-accent/40
            bg-accent/10 px-2.5 py-1 font-mono text-xs text-accent transition-colors
            hover:bg-accent/20 disabled:opacity-40"
        >
          count them <ArrowRight size={11} />
        </button>
      </div>
    </div>
  );
}

/**
 * One existing account, editable in place.
 *
 * Editable here rather than on a settings screen somewhere, because this is
 * the screen where six accounts get made in one sitting at speed, and a
 * mistyped name currently has no undo: it defaults to active, never gets
 * counted, and shows in the household total as uncounted from then on. The
 * repair belongs next to the mistake.
 *
 * Retire, never delete. Transactions point at accounts; deleting a drawer
 * would take the record of what was spent from it. A retired account keeps
 * every row and only stops claiming to hold something.
 */
function AccountRow({
  account,
  isDefault,
  onRename,
  onRetire,
  onRestore,
}: {
  account: AccountRecord;
  isDefault: boolean;
  onRename: (name: string) => Promise<string | null>;
  onRetire: () => Promise<string | null>;
  onRestore: () => Promise<string | null>;
}) {
  const [name, setName] = useState(account.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Follow the record when it changes underneath — a rejected rename rolls the
  // optimistic update back, and the field has to roll back with it rather than
  // sitting there showing a name the account does not have.
  const [seen, setSeen] = useState(account.name);
  if (seen !== account.name) {
    setSeen(account.name);
    setName(account.name);
  }

  const commit = async () => {
    if (name === account.name) return setError(null);
    setBusy(true);
    const err = await onRename(name);
    setBusy(false);
    setError(err);
  };

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(await fn());
    setBusy(false);
  };

  return (
    <div className="px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {account.is_active ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setName(account.name);
                setError(null);
              }
            }}
            aria-label={`Rename ${account.name}`}
            className="w-44 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono
              text-xs text-text-primary hover:border-border focus:border-accent/40
              focus:bg-surface2 focus:outline-none"
          />
        ) : (
          <span className="w-44 truncate px-1 py-0.5 font-mono text-xs text-text-muted/50 line-through">
            {account.name}
          </span>
        )}

        <span className="font-mono text-[10px] text-text-muted/60">
          {account.owner} · {account.currency} · {account.kind}
        </span>

        {isDefault && account.is_active && (
          <span
            title="New captures land here"
            className="rounded border border-accent/30 px-1 font-mono text-[10px] text-accent"
          >
            default
          </span>
        )}

        {account.is_active ? (
          <button
            type="button"
            onClick={() => act(onRetire)}
            disabled={busy}
            title="Keep its history, stop it holding anything"
            className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-text-muted
              transition-colors hover:text-[#F59E0B] disabled:opacity-40"
          >
            <Archive size={10} /> retire
          </button>
        ) : (
          <button
            type="button"
            onClick={() => act(onRestore)}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-text-muted
              transition-colors hover:text-accent disabled:opacity-40"
          >
            <Undo2 size={10} /> restore
          </button>
        )}
      </div>
      {error && <p className="mt-0.5 font-mono text-[10px] text-[#EF4444]">{error}</p>}
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
        text-text-primary focus:border-accent/40 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function CountThem({
  accounts,
  date,
  counted,
  positions,
  onBack,
  onCount,
  allCounted,
}: {
  accounts: AccountRecord[];
  date: string;
  counted: Set<string>;
  positions: ReturnType<typeof useFinanceSummary>['positions'];
  onBack: () => void;
  onCount: (accountId: string, countedMinor: number) => Promise<string | null>;
  allCounted: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[11px] leading-relaxed text-text-muted">
        Count each one and type what is there. These become checkpoint #0 — an
        opening balance is not a setting, it is the first time somebody counted.
      </p>

      <div className="rounded-lg border border-border/60 bg-surface/30 divide-y divide-border/20">
        {accounts.map((a) => (
          <CountRow
            key={a.id}
            account={a}
            done={counted.has(a.id)}
            position={positions.find((p) => p.account.id === a.id) ?? null}
            onCount={(minor) => onCount(a.id, minor)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted
            transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={11} /> back
        </button>
        {allCounted && (
          <Link
            href="/finance"
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-accent/40
              bg-accent/10 px-2.5 py-1 font-mono text-xs text-accent transition-colors
              hover:bg-accent/20"
          >
            done — {date} is the line <ArrowRight size={11} />
          </Link>
        )}
      </div>
    </div>
  );
}

function CountRow({
  account,
  done,
  position,
  onCount,
}: {
  account: AccountRecord;
  done: boolean;
  position: ReturnType<typeof useFinanceSummary>['positions'][number] | null;
  onCount: (countedMinor: number) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const major = Number(amount.replace(/[\s,]/g, ''));
    if (!Number.isFinite(major) || amount.trim() === '') {
      setError('Enter what you counted.');
      return;
    }
    setBusy(true);
    const err = await onCount(Math.round(major * 100));
    setBusy(false);
    if (err) setError(err);
    else {
      setError(null);
      setAmount('');
    }
  };

  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
          {account.name}
          <span className="ml-1.5 text-[10px] text-text-muted/60">
            {account.owner} · {account.currency}
          </span>
        </span>

        {done ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-accent">
            <Check size={11} />
            {position?.balance.basis
              ? formatAmount(position.balance.basis.counted_minor, account.currency)
              : 'counted'}
          </span>
        ) : (
          <>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              inputMode="decimal"
              placeholder={account.currency === 'USD' ? 'dollars' : "so'm"}
              aria-label={`Amount counted in ${account.name}`}
              className="w-32 rounded border border-border bg-surface2 px-2 py-1 font-mono text-xs
                tabular-nums text-text-primary focus:border-accent/40 focus:outline-none"
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
          </>
        )}
      </div>
      {done && position?.balance.movementCount ? (
        <p className="mt-0.5 font-mono text-[10px] text-text-muted/60">
          {position.balance.movementCount} rows since, netting{' '}
          {formatMinor(position.balance.movedMinor)} — now{' '}
          {formatAmount(position.balance.minor ?? 0, account.currency)}.
        </p>
      ) : null}
      {error && <p className="mt-1 font-mono text-[10px] text-[#EF4444]">{error}</p>}
    </div>
  );
}
