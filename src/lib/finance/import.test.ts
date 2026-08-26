import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImport, toSql } from './import.ts';
import { formatMinor } from './parse.ts';

const NOTES = readFileSync(
  new URL('./__fixtures__/notes.sample.txt', import.meta.url),
  'utf8'
);
const summary = buildImport(NOTES, 2026);

const july = summary.byMonth.get('2026-07');
const august = summary.byMonth.get('2026-08');

describe('import', () => {
  test('every line becomes a row, nothing is dropped', () => {
    assert.equal(summary.linesRead, 154);
    assert.equal(summary.rows.length, 153);
    assert.deepEqual(summary.skipped, []); // the 2 headers are consumed, not skipped
  });

  test('rows land in the month their section header names', () => {
    assert.ok(july && august);
    for (const row of summary.rows)
      assert.match(row.occurredAt, /^2026-0[78]/, row.rawInput);
  });

  test("imported rows never claim a day they don't have", () => {
    // Every row lands on the 1st, so date_precision must say 'month' or a
    // daily view will read a month of spending as having happened on day one.
    for (const row of summary.rows) {
      assert.equal(row.datePrecision, 'month', row.rawInput);
      assert.match(row.occurredAt, /^2026-0[78]-01T/, row.rawInput);
    }
  });

  test('date_precision reaches the generated SQL', () => {
    const sql = toSql(summary, '00000000-0000-4000-8000-000000002026');
    assert.match(sql, /date_precision, import_batch_id\) VALUES \(/);
    assert.equal((sql.match(/'month', v_batch\);/g) ?? []).length, summary.rows.length);
  });

  test('August spend is the number the Phase 1 report published', () => {
    assert.equal(formatMinor(august!.spendMinor), '5,996,954.15');
  });

  test('July spend and the two-month totals', () => {
    assert.equal(formatMinor(july!.spendMinor), '3,451,961.38');
    assert.equal(
      formatMinor(july!.spendMinor + august!.spendMinor),
      '9,448,915.53'
    );
  });

  test('transfers are excluded from spend, in both months', () => {
    assert.equal(formatMinor(july!.transferMinor), '5,552,000');
    assert.equal(formatMinor(august!.transferMinor), '1,967,035');
    // the confirmed 4.85M is inside July's transfer total, not its spend
    assert.ok(july!.transferMinor > 4_850_000 * 100);
  });
});

describe("Scott's confirmed calls are recorded as decisions, not guesses", () => {
  const confirmed = summary.rows.filter((r) => r.categorySource === 'manual');

  test('both dollar lines are transfers, confirmed, and closed', () => {
    assert.equal(confirmed.length, 2);
    for (const row of confirmed) {
      assert.equal(row.categorySlug, 'transfer');
      assert.equal(row.needsReview, false, row.rawInput);
      assert.match(row.note ?? '', /Scott-confirmed/);
    }
  });

  test('the 4,850,000 line is one of them', () => {
    const mom = confirmed.find((r) => r.rawInput.includes('for 400$'));
    assert.ok(mom);
    assert.equal(mom.amountMinor, 4_850_000 * 100);
    assert.equal(mom.categorySlug, 'transfer');
  });

  test('the note survives into the generated SQL', () => {
    const sql = toSql(summary, '00000000-0000-4000-8000-000000002026');
    assert.match(sql, /-- Scott-confirmed 2026-08-27: money held, not spent/);
  });
});

describe('review flags', () => {
  test('an uncategorised row is always flagged, even with no parser flag', () => {
    // "+200k cash" — the unnamed return leg of the PersonE transfer. It parses
    // cleanly and matches no rule, so only the uncategorised check catches it.
    const cash = summary.rows.find((r) => r.rawInput === '+200k cash');
    assert.ok(cash);
    assert.deepEqual(cash.parseFlags, []);
    assert.equal(cash.categorySlug, null);
    assert.equal(cash.needsReview, true);
  });

  test('nothing uncategorised slips through unflagged', () => {
    for (const row of summary.rows)
      if (row.categorySlug === null)
        assert.equal(row.needsReview, true, row.rawInput);
  });

  test('the flagged count is pinned', () => {
    assert.equal(summary.needsReview, 27);
  });
});

describe('generated SQL', () => {
  const sql = toSql(summary, '00000000-0000-4000-8000-000000002026');

  test('is idempotent — it clears its own batch first', () => {
    assert.match(sql, /DELETE FROM transactions WHERE user_id = v_user AND import_batch_id = v_batch;/);
  });

  test('escapes quotes in comments', () => {
    // "mom's expenses(pijama, perfume)" and "PersonC sister's ticket" both
    // carry an apostrophe that would otherwise close the SQL string early.
    assert.match(sql, /mom''s expenses/);
    assert.match(sql, /sister''s ticket/);
    assert.ok(!sql.includes("'mom's"), 'an unescaped apostrophe reached the SQL');
  });

  test('resolves category and area by lookup, never by hardcoded id', () => {
    assert.match(sql, /SELECT id FROM finance_categories WHERE user_id = v_user AND slug =/);
    assert.match(sql, /SELECT id INTO v_area FROM areas WHERE user_id = v_user AND name = 'Finance'/);
  });

  test('emits one INSERT per row', () => {
    assert.equal(
      (sql.match(/INSERT INTO transactions/g) ?? []).length,
      summary.rows.length
    );
  });
});
