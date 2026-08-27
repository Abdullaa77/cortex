'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useTransactions } from '@/hooks/useTransactions';
import TransactionRow from '@/components/finance/TransactionRow';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import { formatMinor } from '@/lib/finance/format';
import {
  filterTransactions,
  groupByMonth,
  availableMonths,
  availableCategories,
  listStats,
  NO_FILTERS,
  type TransactionFilters,
} from '@/lib/finance/transactions';
import { ArrowLeft } from 'lucide-react';

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="p-6">
            <LoadingState />
          </div>
        </AppShell>
      }
    >
      <TransactionsView />
    </Suspense>
  );
}

function TransactionsView() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');
  // /finance links here with ?flagged=1 from its review count, and with
  // ?month=&category= from the drill-down's "open in list".
  const flaggedFromUrl = searchParams.get('flagged') === '1';
  const monthFromUrl = searchParams.get('month');
  const categoryFromUrl = searchParams.get('category');

  const { rows, categories, loading, error, setCategory, updateRow, deleteRow, acceptRow } =
    useTransactions();
  const [filters, setFilters] = useState<TransactionFilters>({
    ...NO_FILTERS,
    flaggedOnly: flaggedFromUrl,
    month: monthFromUrl,
    categorySlug: categoryFromUrl,
  });

  const shown = useMemo(() => filterTransactions(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupByMonth(shown), [shown]);
  const months = useMemo(() => availableMonths(rows), [rows]);
  const cats = useMemo(() => availableCategories(rows), [rows]);
  const stats = useMemo(() => listStats(rows, shown), [rows, shown]);

  const set = (patch: Partial<TransactionFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  if (loading) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
        <Link
          href="/finance"
          className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-text-muted
            transition-colors hover:text-accent"
        >
          <ArrowLeft size={12} /> Where did my money go
        </Link>

        <SectionHeader title="TRANSACTIONS" count={`${stats.shown} of ${stats.total}`} />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <Chip active={filters.month === null} onClick={() => set({ month: null })}>
            all months
          </Chip>
          {months.map((m) => (
            <Chip
              key={m.key}
              active={filters.month === m.key}
              onClick={() => set({ month: filters.month === m.key ? null : m.key })}
            >
              {m.label.toLowerCase()}
            </Chip>
          ))}

          <span className="mx-1 h-4 w-px bg-border" />

          <Chip
            active={filters.flaggedOnly}
            onClick={() => set({ flaggedOnly: !filters.flaggedOnly })}
            color="#F59E0B"
          >
            flagged ({stats.flagged})
          </Chip>
          <Chip
            active={filters.uncategorisedOnly}
            onClick={() => set({ uncategorisedOnly: !filters.uncategorisedOnly })}
          >
            uncategorised ({stats.uncategorised})
          </Chip>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <Chip
            active={filters.categorySlug === null}
            onClick={() => set({ categorySlug: null })}
          >
            all categories
          </Chip>
          {cats.map((c) => (
            <Chip
              key={c.slug}
              active={filters.categorySlug === c.slug}
              color={c.color}
              onClick={() =>
                set({ categorySlug: filters.categorySlug === c.slug ? null : c.slug })
              }
            >
              {c.name.toLowerCase()}
            </Chip>
          ))}
        </div>

        <p className="mt-3 font-mono text-[10px] text-text-muted/60">
          Showing {stats.shown} entries · {formatMinor(stats.spendMinor)} spent. Rows
          marked <span className="text-text-muted">~</span> know their month but not
          their day — they came from notes with no per-line date.
        </p>

        {error && (
          <p className="mt-4 font-mono text-xs text-[#EF4444]">{error}</p>
        )}

        {shown.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? 'Nothing captured yet.' : 'Nothing matches.'}
            description={
              rows.length === 0
                ? 'Type an amount in the capture bar — "-10k two bananas" — and it lands here.'
                : 'Try clearing a filter.'
            }
          />
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <SectionHeader
                title={group.label}
                count={`${group.rows.length} · ${formatMinor(group.spendMinor)} spent`}
              />
              <div className="rounded-lg border border-border/50 bg-surface/20">
                {group.rows.map((row) => (
                  <TransactionRow
                    key={row.id}
                    row={row}
                    categories={categories}
                    highlighted={row.id === highlightId}
                    onSetCategory={setCategory}
                    onUpdate={updateRow}
                    onDelete={deleteRow}
                    onAccept={acceptRow}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function Chip({
  children,
  active,
  onClick,
  color = '#00FF88',
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-2 py-0.5 transition-colors"
      style={{
        borderColor: active ? `${color}66` : 'rgba(42,42,58,0.9)',
        color: active ? color : '#6B7280',
        backgroundColor: active ? `${color}15` : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

function SectionHeader({ title, count }: { title: string; count?: string }) {
  return (
    <div
      className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]"
      style={{ color: '#4A6858' }}
    >
      <span>--</span>
      <span>{title}</span>
      {count && (
        <span className="font-normal tracking-normal text-text-muted">({count})</span>
      )}
      <span className="flex-1 section-line" />
    </div>
  );
}
