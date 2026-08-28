'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { useFinanceSummary } from '@/hooks/useFinanceSummary';
import MonthTabs from '@/components/finance/MonthTabs';
import MonthTotalsHeader from '@/components/finance/MonthTotalsHeader';
import MonthCategoryList from '@/components/finance/MonthCategoryList';
import CategoryRow from '@/components/finance/CategoryRow';
import WaterfallChart from '@/components/finance/WaterfallChart';
import ReconcileBlock from '@/components/finance/ReconcileBlock';
import PositionsCard from '@/components/finance/PositionsCard';
import CountDialog from '@/components/finance/CountDialog';
import TransferQueue from '@/components/finance/TransferQueue';
import RateDialog from '@/components/finance/RateDialog';
import CategoryDrilldown, {
  type DrilldownTarget,
} from '@/components/finance/CategoryDrilldown';
import CategoryManager from '@/components/finance/CategoryManager';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import { formatMinor } from '@/lib/finance/format';
import { buildWaterfall } from '@/lib/finance/waterfall';
import { ledgerFor } from '@/lib/finance/reconcile';
import { planResolution } from '@/lib/finance/transfers';
import { AlertCircle, ArrowRight, Tags, SlidersHorizontal } from 'lucide-react';

export default function FinancePage() {
  const {
    rows,
    categories,
    allCategories,
    refetch,
    tabs,
    allMonths,
    reconciliation,
    accounts,
    movements,
    positions,
    household,
    historyFor,
    openTransfers,
    unaccountedCategoryId,
    flags,
    compareOn,
    breakdownOn,
    loading,
    error,
    setCategory,
    updateRow,
    deleteRow,
    acceptRow,
    linkReimbursement,
    unlinkReimbursement,
    pairTransfer,
  } = useFinanceSummary();

  // A single month is the resting state. Comparison is a question you go and
  // ask — it is what found the everyday floor, so it stays one tap away.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [drilldown, setDrilldown] = useState<DrilldownTarget | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [countingId, setCountingId] = useState<string | null>(null);
  const [settingRate, setSettingRate] = useState(false);

  // Derived rather than synced through an effect. The newest month with rows
  // is the default, and a selection that no longer exists — the last row in a
  // month was deleted, or the tabs arrived after the first render — falls back
  // to it instead of leaving the page pointed at nothing.
  const activeKey =
    selectedKey && tabs.some((t) => t.key === selectedKey)
      ? selectedKey
      : tabs.at(-1)?.key ?? null;

  const activeIndex = tabs.findIndex((t) => t.key === activeKey);
  const previousTab = activeIndex > 0 ? tabs[activeIndex - 1] : null;

  const compareKeys = useMemo(
    () =>
      comparing && previousTab && activeKey ? [previousTab.key, activeKey] : [],
    [comparing, previousTab, activeKey]
  );

  const comparison = useMemo(
    () => (compareKeys.length === 2 ? compareOn(compareKeys) : null),
    [compareKeys, compareOn]
  );

  const slices = useMemo(
    () => (activeKey ? breakdownOn(activeKey) : []),
    [activeKey, breakdownOn]
  );

  const ledger = activeKey ? ledgerFor(reconciliation, activeKey) : null;
  const chart = useMemo(
    () => (ledger ? buildWaterfall(ledger, slices) : null),
    [ledger, slices]
  );

  const openDrilldown = (slug: string, key: string) => {
    const monthTab = tabs.find((t) => t.key === key);
    const slice = (key === activeKey ? slices : breakdownOn(key)).find(
      (s) => s.slug === slug
    );
    if (!slice || !monthTab) return;
    setDrilldown({
      monthKey: key,
      monthLabel: monthTab.label,
      slug: slice.slug,
      name: slice.name,
      color: slice.color,
      minor: slice.minor,
    });
  };

  if (loading) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState />
        </div>
      </AppShell>
    );
  }

  if (error || tabs.length === 0 || !activeKey || !ledger) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
          <SectionHeader title="WHERE THE MONEY IS" />
          <PositionsCard
            positions={positions}
            household={household}
            onCount={setCountingId}
            onSetRate={() => setSettingRate(true)}
          />

          <SectionHeader title="WHERE IT WENT" />
          <EmptyState
            title={error ? 'Could not load transactions.' : 'Nothing captured yet.'}
            description={
              error ??
              'Once transactions land, this shows where the money went, month by month.'
            }
          />

          <CountDialog
            account={accounts.accounts.find((a) => a.id === countingId) ?? null}
            checkpoints={accounts.checkpoints}
            movements={movements}
            history={historyFor(countingId ?? '')}
            onClose={() => setCountingId(null)}
            onSave={({ countedAt, countedMinor, note }) =>
              accounts.recordCount({
                accountId: countingId!,
                countedAt,
                countedMinor,
                note,
                movements,
                unaccountedCategoryId,
              })
            }
            onDeleteCheckpoint={accounts.deleteCheckpoint}
          />

          <RateDialog
            open={settingRate}
            settings={accounts.settings}
            onClose={() => setSettingRate(false)}
            onSave={accounts.saveSettings}
          />
        </div>
      </AppShell>
    );
  }

  const activeLabel = tabs[activeIndex].label;
  const shownLedgers =
    comparing && previousTab
      ? [ledgerFor(reconciliation, previousTab.key), ledger].filter(
          (l): l is NonNullable<typeof l> => l !== null
        )
      : [ledger];

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 pb-8 lg:px-10 lg:py-6 page-enter">
        <SectionHeader title="WHERE THE MONEY IS" />

        <PositionsCard
          positions={positions}
          household={household}
          onCount={setCountingId}
          onSetRate={() => setSettingRate(true)}
        />

        <SectionHeader title="WHERE IT WENT" />

        <MonthTabs
          tabs={tabs}
          activeKey={activeKey}
          comparing={comparing}
          compareAgainstLabel={previousTab?.label ?? null}
          onSelect={setSelectedKey}
          onToggleCompare={() => setComparing((c) => !c)}
        />

        <div className="mt-3">
          <MonthTotalsHeader
            months={
              comparison
                ? comparison.months
                : allMonths.filter((m) => m.key === activeKey)
            }
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Link
            href={`/finance/transactions?month=${activeKey}`}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-accent
              transition-colors hover:text-accent-dim"
          >
            All transactions <ArrowRight size={12} />
          </Link>
          <button
            type="button"
            onClick={() => setManagingCategories(true)}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-text-muted
              transition-colors hover:text-accent"
          >
            <Tags size={12} /> Categories
          </button>
          <Link
            href="/finance/cutover"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-text-muted
              transition-colors hover:text-accent"
          >
            <SlidersHorizontal size={12} /> Accounts &amp; cutover
          </Link>
        </div>


        {chart && (
          <>
            <SectionHeader title={`${activeLabel} — WHERE IT WENT`} />
            <WaterfallChart
              chart={chart}
              onDrilldown={(slug) => openDrilldown(slug, activeKey)}
            />
          </>
        )}

        {comparison && previousTab ? (
          <ComparisonBlocks
            comparison={comparison}
            earlierLabel={previousTab.label}
            laterLabel={activeLabel}
            onSelect={openDrilldown}
            earlierKey={previousTab.key}
            laterKey={activeKey}
          />
        ) : (
          slices.length > 0 && (
            <>
              <SectionHeader
                title="BY CATEGORY"
                count={`${slices.length} categories`}
              />
              <MonthCategoryList
                slices={slices}
                onSelect={(slug) => openDrilldown(slug, activeKey)}
              />
            </>
          )
        )}

        <SectionHeader title="RECONCILE" />
        <ReconcileBlock ledgers={shownLedgers} />

        {openTransfers.length > 0 && (
          <>
            <SectionHeader
              title="NEEDS THE OTHER SIDE"
              count={`${openTransfers.length} transfers`}
            />
            <p className="-mt-1 mb-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
              Money that moved rather than left, with one end still unnamed. Nothing
              here is guessed — you know where these went, and the app does not.
            </p>
            <TransferQueue
              open={openTransfers}
              accounts={accounts.activeAccounts}
              onResolve={async (open, account, counterpartMinor) => {
                const plan = planResolution(open, account, counterpartMinor);
                if (plan.kind === 'refused') return plan.reason;
                if (plan.kind === 'set-side') {
                  await updateRow(open.row.id, plan.patch);
                  return null;
                }
                return pairTransfer(open.row.id, plan.counterpart);
              }}
            />
          </>
        )}

        <SectionHeader title="DATA" />
        <div className="flex flex-col gap-2 font-mono text-[11px] text-text-muted">
          <span>
            {flags.totalRows} transactions ·{' '}
            <span className="text-accent">{formatMinor(ledger.spendMinor)}</span> spent in{' '}
            {activeLabel.toLowerCase()}
          </span>

          {flags.needsReviewCount > 0 && (
            <span className="flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-[#F59E0B]" />
              <span>
                <Link
                  href="/finance/transactions?flagged=1"
                  className="text-[#F59E0B] underline decoration-dotted underline-offset-2"
                >
                  {flags.needsReviewCount} flagged for review
                </Link>{' '}
                — included in every total above. The flag means the capture was
                ambiguous, not that the number is wrong.
              </span>
            </span>
          )}

          {flags.foreignRowCount > 0 && (
            <span className="flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-[#F59E0B]" />
              <span>
                {flags.foreignRowCount} rows are not in so&apos;m and are left out of
                every figure above. They are counted in their own account&apos;s
                position instead, natively — converting them here would put a
                hand-entered rate underneath months of history.
              </span>
            </span>
          )}

          {flags.monthPrecisionCount > 0 && (
            <span className="flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-text-muted/60" />
              <span>
                {flags.monthPrecisionCount} rows carry a month, not a day — they came
                from notes with no per-line date. Monthly totals are exact; there is no
                daily breakdown to draw.
              </span>
            </span>
          )}
        </div>
      </div>

      <CategoryDrilldown
        target={drilldown}
        rows={rows}
        categories={categories}
        onClose={() => setDrilldown(null)}
        onSetCategory={setCategory}
        onUpdate={updateRow}
        onDelete={deleteRow}
        onAccept={acceptRow}
        onLink={linkReimbursement}
        onUnlink={unlinkReimbursement}
        onManageCategories={() => setManagingCategories(true)}
      />

      <CountDialog
        account={accounts.accounts.find((a) => a.id === countingId) ?? null}
        checkpoints={accounts.checkpoints}
        movements={movements}
        history={historyFor(countingId ?? '')}
        onClose={() => setCountingId(null)}
        onSave={({ countedAt, countedMinor, note }) =>
          accounts.recordCount({
            accountId: countingId!,
            countedAt,
            countedMinor,
            note,
            movements,
            unaccountedCategoryId,
          }).then((err) => {
            if (!err) refetch();
            return err;
          })
        }
        onDeleteCheckpoint={accounts.deleteCheckpoint}
      />

      <RateDialog
        open={settingRate}
        settings={accounts.settings}
        onClose={() => setSettingRate(false)}
        onSave={accounts.saveSettings}
      />

      <CategoryManager
        open={managingCategories}
        onClose={() => setManagingCategories(false)}
        categories={allCategories}
        rows={rows}
        onChanged={refetch}
      />
    </AppShell>
  );
}

function ComparisonBlocks({
  comparison,
  earlierLabel,
  laterLabel,
  earlierKey,
  laterKey,
  onSelect,
}: {
  comparison: ReturnType<ReturnType<typeof useFinanceSummary>['compareOn']>;
  earlierLabel: string;
  laterLabel: string;
  earlierKey: string;
  laterKey: string;
  onSelect: (slug: string, key: string) => void;
}) {
  const { inBoth, oneMonthOnly } = comparison;

  // One scale across both blocks so a bar means the same thing everywhere.
  const scaleMinor = Math.max(
    1,
    ...[...inBoth, ...oneMonthOnly].flatMap((c) => [c.earlierMinor, c.laterMinor])
  );

  return (
    <>
      {inBoth.length > 0 && (
        <>
          <SectionHeader title="IN BOTH MONTHS" count={`${inBoth.length} categories`} />
          <p className="-mt-1 mb-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
            Spending that showed up in {earlierLabel.toLowerCase()} and{' '}
            {laterLabel.toLowerCase()}. Two months is enough to see a direction, not
            enough to call something a habit.
          </p>
          <div className="rounded-lg border border-border/50 bg-surface/20 px-3">
            {inBoth.map((c) => (
              <CategoryRow
                key={c.slug}
                category={c}
                scaleMinor={scaleMinor}
                earlierLabel={earlierLabel}
                laterLabel={laterLabel}
                onSelect={(monthKey) => onSelect(c.slug, monthKey)}
                earlierKey={earlierKey}
                laterKey={laterKey}
              />
            ))}
          </div>
        </>
      )}

      {oneMonthOnly.length > 0 && (
        <>
          <SectionHeader
            title="ONE MONTH ONLY"
            count={`${oneMonthOnly.length} categories`}
          />
          <p className="-mt-1 mb-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
            Appeared in one month and not the other. Some of this is genuinely one-off;
            some is a gap in what got captured.
          </p>
          <div className="rounded-lg border border-border/50 bg-surface/20 px-3">
            {oneMonthOnly.map((c) => (
              <CategoryRow
                key={c.slug}
                category={c}
                scaleMinor={scaleMinor}
                earlierLabel={earlierLabel}
                laterLabel={laterLabel}
                onSelect={(monthKey) => onSelect(c.slug, monthKey)}
                earlierKey={earlierKey}
                laterKey={laterKey}
              />
            ))}
          </div>
        </>
      )}
    </>
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
