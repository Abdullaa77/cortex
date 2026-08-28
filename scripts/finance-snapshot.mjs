#!/usr/bin/env node
/**
 * Snapshot every number /finance and /finance/transactions can show, derived
 * from the real corpus.
 *
 *   node scripts/finance-snapshot.mjs > src/lib/finance/__fixtures__/summary.golden.json
 *
 * This exists for one stage-1 reason: the accounts schema must change nothing
 * a user can see. Generated before the schema lands and asserted after, it is
 * the difference between "the totals look right" and "the totals are the same
 * bytes". Regenerate it only when a figure is *meant* to move, and say why in
 * the commit.
 */
import {
  CORPUS_ROWS,
  CORPUS_RECORDS,
  IMPORTED,
  OPENING,
  ACCOUNTS,
  CHECKPOINTS,
  MOVEMENTS,
  PAIRABLE_ROWS,
  FX_RATE,
} from '../src/lib/finance/__fixtures__/corpus.ts';
import { summarize, monthTotals, categoryBreakdown } from '../src/lib/finance/summarize.ts';
import { reconcile } from '../src/lib/finance/reconcile.ts';
import { buildWaterfall } from '../src/lib/finance/waterfall.ts';
import {
  positionsAt,
  householdTotal,
  openingFromCheckpoints,
} from '../src/lib/finance/positions.ts';
import { checkpointLedger, gapPattern } from '../src/lib/finance/checkpoints.ts';
import { needsOtherSide } from '../src/lib/finance/transfers.ts';
import {
  groupByMonth,
  listStats,
  availableMonths,
  availableCategories,
  filterTransactions,
  drilldownRows,
  formatOccurred,
  NO_FILTERS,
} from '../src/lib/finance/transactions.ts';

const summary = summarize(CORPUS_ROWS);
const months = monthTotals(CORPUS_ROWS);
const withOpening = reconcile(months, OPENING);
const withoutOpening = reconcile(months, null);

/** Rows are identified by content, not by index — indices are an artefact. */
const rowKey = (r) => `${r.occurred_at}|${r.amount_minor}|${r.raw_input}`;

const snapshot = {
  // What the import itself claims, before any aggregation.
  import: {
    linesRead: IMPORTED.linesRead,
    rowCount: IMPORTED.rows.length,
    needsReview: IMPORTED.needsReview,
    skipped: IMPORTED.skipped,
    byMonth: Object.fromEntries(
      [...IMPORTED.byMonth].sort(([a], [b]) => a.localeCompare(b))
    ),
    spendByCategory: Object.fromEntries(
      [...IMPORTED.spendByCategory]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, m]) => [
          k,
          Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b))),
        ])
    ),
  },

  // Every figure on /finance.
  summary,
  categoryBreakdown: Object.fromEntries(
    months.map((m) => [m.key, categoryBreakdown(CORPUS_ROWS, m.key)])
  ),
  reconciliation: { withOpening, withoutOpening },
  waterfall: Object.fromEntries(
    withOpening.months.map((ledger) => [
      ledger.key,
      {
        withOpening: buildWaterfall(ledger, categoryBreakdown(CORPUS_ROWS, ledger.key)),
        withoutOpening: buildWaterfall(
          withoutOpening.months.find((l) => l.key === ledger.key),
          categoryBreakdown(CORPUS_ROWS, ledger.key)
        ),
      },
    ])
  ),

  // Every figure on /finance/transactions.
  transactions: {
    stats: listStats(CORPUS_RECORDS, filterTransactions(CORPUS_RECORDS, NO_FILTERS)),
    availableMonths: availableMonths(CORPUS_RECORDS),
    availableCategories: availableCategories(CORPUS_RECORDS),
    groups: groupByMonth(CORPUS_RECORDS).map((g) => ({
      key: g.key,
      label: g.label,
      spendMinor: g.spendMinor,
      rowCount: g.rows.length,
      rows: g.rows.map(rowKey),
    })),
    // The drill-down has to reproduce the figure that was clicked, for every
    // category in every month. That is the join between the two pages.
    drilldown: Object.fromEntries(
      months.flatMap((m) =>
        categoryBreakdown(CORPUS_ROWS, m.key).map((slice) => {
          const rows = drilldownRows(CORPUS_RECORDS, m.key, slice.slug);
          return [
            `${m.key}/${slice.slug}`,
            { sliceMinor: slice.minor, rowCount: rows.length, rows: rows.map(rowKey) },
          ];
        })
      )
    ),
    occurredDisplay: CORPUS_RECORDS.map((r) => formatOccurred(r)),
  },

  // ============================================
  // Stage 2 — the positions, and what the counts say about them
  // ============================================
  // Added beneath the Stage 1 sections rather than woven into them. The six
  // keys above must stay byte-identical forever; this one is free to grow.
  // acceptance.test.ts asserts both properties separately, and the digest it
  // checks the Stage 1 subtree against is a literal in the test source, so
  // re-running this script cannot make a moved figure pass.
  positions: {
    // Read at three days: before anything was counted, after the first month,
    // and at the end of the run. The first must be null everywhere — uncounted
    // is not zero, and a snapshot that let it become zero would be a snapshot
    // of the wrong model.
    onDays: Object.fromEntries(
      ['2026-06-01', '2026-07-31', '2026-08-31'].map((day) => {
        const at = positionsAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, day);
        return [
          day,
          {
            accounts: at.map((p) => ({
              name: p.account.name,
              currency: p.account.currency,
              owner: p.account.owner,
              minor: p.balance.minor,
              uncounted: p.uncounted,
              movedMinor: p.balance.movedMinor,
              movementCount: p.balance.movementCount,
              daysSinceCount: p.daysSinceCount,
            })),
            household: (() => {
              const h = householdTotal(at, FX_RATE);
              return {
                byCurrency: h.byCurrency,
                byOwner: h.byOwner,
                totalUzsMinor: h.totalUzsMinor,
                convertedUzsMinor: h.convertedUzsMinor,
                needsRate: h.needsRate,
                uncounted: h.uncounted.map((p) => p.account.name),
                rate: h.rate,
              };
            })(),
            householdWithoutRate: (() => {
              const h = householdTotal(at, null);
              return { totalUzsMinor: h.totalUzsMinor, needsRate: h.needsRate };
            })(),
          },
        ];
      })
    ),

    // The opening balance, now derived from the counts rather than a table.
    openingFromCheckpoints: {
      withRate: openingFromCheckpoints(ACCOUNTS, CHECKPOINTS, FX_RATE),
      withoutRate: openingFromCheckpoints(ACCOUNTS, CHECKPOINTS, null),
      stage1Figure: OPENING,
    },

    // Every count on every account, with the gap it found and its direction.
    checkpointLedgers: Object.fromEntries(
      ACCOUNTS.map((a) => {
        const ledger = checkpointLedger(a.id, CHECKPOINTS, MOVEMENTS);
        return [
          a.name,
          {
            counts: ledger.map((r) => ({
              countedAt: r.countedAt,
              countedMinor: r.countedMinor,
              derivedMinor: r.derivedMinor,
              gapMinor: r.gapMinor,
              kind: r.kind,
            })),
            pattern: gapPattern(ledger),
          },
        ];
      })
    ),

    // The half-mapped transfers, identified by content rather than by index.
    needsOtherSide: needsOtherSide(PAIRABLE_ROWS).map((o) => ({
      key: rowKey(o.row),
      missing: o.missing,
      currency: o.row.currency,
      amountMinor: o.row.amount_minor,
    })),
  },
};

process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
