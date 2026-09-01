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
  OPENING_COUNTED_AT,
  ACCOUNTS,
  CHECKPOINTS,
  MOVEMENTS,
  PAIRABLE_ROWS,
  FX_RATE,
  BENEFICIARY_CORPUS,
  CUTOVER_DATE,
} from '../src/lib/finance/__fixtures__/corpus.ts';
import { summarize, monthTotals, categoryBreakdown } from '../src/lib/finance/summarize.ts';
import { reconcile } from '../src/lib/finance/reconcile.ts';
import { buildWaterfall } from '../src/lib/finance/waterfall.ts';
import {
  positionsAt,
  householdTotal,
  householdAt,
} from '../src/lib/finance/positions.ts';
import { checkpointLedger, gapPattern } from '../src/lib/finance/checkpoints.ts';
import { needsOtherSide } from '../src/lib/finance/transfers.ts';
import {
  BENEFICIARIES,
  UNRECORDED,
  backfillBeneficiary,
  beneficiaryBreakdown,
  beneficiaryKeyOf,
  floorSplit,
} from '../src/lib/finance/beneficiary.ts';
import { isPreCutover } from '../src/lib/finance/cutover.ts';
import { allMonthKeys } from '../src/lib/finance/summarize.ts';
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
// Dated where the checkpoint actually sits, not where Stage 1's hand-entered
// figure claimed. A count is the last word for its own day, so a 1 July figure
// cannot open July; see the note beside OPENING_COUNTED_AT in the corpus.
const LEDGER_OPENING = { amountMinor: OPENING.amountMinor, asOf: OPENING_COUNTED_AT };
const withOpening = reconcile(months, LEDGER_OPENING);
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
    householdAt: {
      withRate: householdAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, FX_RATE, OPENING_COUNTED_AT),
      withoutRate: householdAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, null, OPENING_COUNTED_AT),
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

  // ============================================
  // Stage 3 — who consumed it
  // ============================================
  // Appended, never woven in. Beneficiary is a new axis over the same money and
  // must move nothing above it; the sections before this one are unchanged, and
  // acceptance.test.ts checks that separately from this one existing.
  //
  // Read over BENEFICIARY_CORPUS — the 153 imported rows plus the captures made
  // after the cutover — because the split only means anything where both kinds
  // of row are present. Every figure above is still derived from the 153 alone.
  beneficiary: {
    cutoverDate: CUTOVER_DATE,

    // What the backfill would write, row by row, counted. The claim being
    // recorded here is that the historical rows get NOTHING.
    backfill: (() => {
      const counts = { household: 0, null: 0 };
      const preCutoverHousehold = [];
      for (const row of BENEFICIARY_CORPUS) {
        const decided = backfillBeneficiary(
          row,
          CUTOVER_DATE,
          isPreCutover(row, CUTOVER_DATE)
        );
        counts[decided === null ? 'null' : decided]++;
        if (decided !== null && isPreCutover(row, CUTOVER_DATE))
          preCutoverHousehold.push(row.id);
      }
      return {
        rowCount: BENEFICIARY_CORPUS.length,
        importedRowCount: CORPUS_ROWS.length,
        counts,
        // Must be empty. A non-empty list here is the falsehood the stage
        // exists to refuse, spelled out by row id.
        preCutoverHousehold,
      };
    })(),

    // Every group, every month, including the empty ones and the unrecorded
    // one — with the month's own spend beside them, so the snapshot records
    // that they add up rather than only that they exist.
    byMonth: Object.fromEntries(
      allMonthKeys(BENEFICIARY_CORPUS).map((key) => {
        const groups = beneficiaryBreakdown(BENEFICIARY_CORPUS, key);
        const month = monthTotals(BENEFICIARY_CORPUS).find((m) => m.key === key);
        return [
          key,
          {
            groups: groups.map((g) => ({
              key: g.key,
              label: g.label,
              minor: g.minor,
              share: g.share,
              rowCount: g.rowCount,
              unrecorded: g.unrecorded,
            })),
            summedMinor: groups.reduce((n, g) => n + g.minor, 0),
            monthSpendMinor: month.spendMinor,
          },
        ];
      })
    ),

    // The everyday floor, split into what is shared and what is one person's.
    // The question the stage was built to answer.
    floor: Object.fromEntries(
      allMonthKeys(BENEFICIARY_CORPUS).map((key) => [key, floorSplit(BENEFICIARY_CORPUS, key)])
    ),

    // The group each value falls into, so a renaming or a re-keying shows up
    // as a moved figure rather than as nothing at all.
    keys: [...BENEFICIARIES, UNRECORDED],
    unrecordedKeyOfImportedRow: beneficiaryKeyOf(CORPUS_ROWS[0]),
  },
};

process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
