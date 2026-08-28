import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthTotals,
  categoryBreakdown,
  summarizeMonths,
  allMonthKeys,
  classifyRow,
  categorySlugOf,
} from './summarize.ts';
import { drilldownRows, sumMinor, type TransactionRecord } from './transactions.ts';
import { CORPUS_RECORDS as rows } from './__fixtures__/corpus.ts';

/**
 * The drill-down's only job is to add up.
 *
 * A user clicks 1,432,000 beside "Groceries" and gets a list. If that list
 * sums to anything else, every other number on the page becomes a guess too —
 * there is no partial credit for a finance screen. So this checks the identity
 * across every category in every month of the real corpus, rather than one
 * hand-picked example.
 */
const keys = allMonthKeys(rows);

describe('drill-down sums to the number that was clicked', () => {
  test('every category in every month, against the real corpus', () => {
    let checked = 0;

    for (const key of keys)
      for (const slice of categoryBreakdown(rows, key)) {
        const behind = drilldownRows(rows, key, slice.slug);
        assert.equal(
          sumMinor(behind),
          slice.minor,
          `${key} / ${slice.slug}: modal total drifted from the figure shown`
        );
        assert.ok(behind.length > 0, `${key} / ${slice.slug}: figure shown with no rows`);
        checked++;
      }

    // Guards the guard: an empty loop would pass silently.
    assert.ok(checked >= 20, `expected many category-months, checked ${checked}`);
  });

  test('the comparison table figures are the same arithmetic', () => {
    const summary = summarizeMonths(rows, keys.slice(-2));
    const [earlierKey, laterKey] = keys.slice(-2);

    for (const c of [...summary.inBoth, ...summary.oneMonthOnly]) {
      assert.equal(sumMinor(drilldownRows(rows, earlierKey, c.slug)), c.earlierMinor);
      assert.equal(sumMinor(drilldownRows(rows, laterKey, c.slug)), c.laterMinor);
    }
  });

  test("a month's category slices add up to that month's spend", () => {
    for (const month of monthTotals(rows)) {
      const slices = categoryBreakdown(rows, month.key);
      assert.equal(
        slices.reduce((n, s) => n + s.minor, 0),
        month.spendMinor,
        `${month.key}: bars do not add up to the header total`
      );
      // Shares are a proportion of that same total.
      const shareSum = slices.reduce((n, s) => n + s.share, 0);
      assert.ok(Math.abs(shareSum - 1) < 1e-9, `${month.key}: shares sum to ${shareSum}`);
    }
  });

  test('nothing spent is left out of the breakdown', () => {
    const inBreakdown = keys.flatMap((k) =>
      categoryBreakdown(rows, k).flatMap((s) => drilldownRows(rows, k, s.slug))
    );
    const everySpendRow = rows.filter((r) => classifyRow(r) === 'spend');
    assert.equal(inBreakdown.length, everySpendRow.length);
    assert.equal(sumMinor(inBreakdown), sumMinor(everySpendRow));
  });
});

describe('drill-down selection rules', () => {
  test('transfers and income never appear behind a spend figure', () => {
    for (const key of keys)
      for (const slice of categoryBreakdown(rows, key))
        for (const row of drilldownRows(rows, key, slice.slug))
          assert.equal(classifyRow(row), 'spend');
  });

  test('rows come back newest first, matching the list', () => {
    for (const key of keys)
      for (const slice of categoryBreakdown(rows, key)) {
        const behind = drilldownRows(rows, key, slice.slug);
        for (let i = 1; i < behind.length; i++)
          assert.ok(behind[i - 1].occurred_at >= behind[i].occurred_at);
      }
  });

  test('an uncategorised row is reachable, not orphaned', () => {
    const orphan: TransactionRecord = {
      ...rows[0],
      id: 'orphan',
      amount_minor: 777_00,
      direction: 'expense',
      finance_categories: null,
    };
    const withOrphan = [...rows, orphan];
    const key = allMonthKeys([orphan])[0];

    const slice = categoryBreakdown(withOrphan, key).find(
      (s) => s.slug === 'uncategorised'
    );
    assert.ok(slice, 'an uncategorised row must still get a bar');

    const behind = drilldownRows(withOrphan, key, 'uncategorised');
    assert.equal(sumMinor(behind), slice!.minor);
    assert.ok(behind.some((r) => r.id === 'orphan'));
    assert.equal(categorySlugOf(orphan), 'uncategorised');
  });

  test('a month with no rows drills down to nothing, not to everything', () => {
    assert.deepEqual(drilldownRows(rows, '2026-01', 'groceries'), []);
    assert.deepEqual(categoryBreakdown(rows, '2026-01'), []);
  });
});
