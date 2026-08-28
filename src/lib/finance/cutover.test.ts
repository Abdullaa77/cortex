import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isPreCutover, splitAtCutover, dayKey } from './cutover.ts';
import { CORPUS_ROWS } from './__fixtures__/corpus.ts';
import { monthKey } from './format.ts';

const row = (occurred_at: string) => ({ occurred_at });

describe('the cutover line', () => {
  test('no cutover set means nothing is reference — the default is all truth', () => {
    assert.equal(isPreCutover(row('2020-01-01T00:00:00.000Z'), null), false);
    const { reference, truth } = splitAtCutover(CORPUS_ROWS, null);
    assert.equal(reference.length, 0);
    assert.equal(truth.length, 153);
  });

  test('an empty string is treated as unset, not as the year zero', () => {
    // A form that has been opened and not filled in sends '', and that must
    // not silently reclassify the entire ledger as reference.
    assert.equal(isPreCutover(row('2026-07-01T00:00:00.000Z'), ''), false);
  });

  test('rows before the date are reference', () => {
    assert.equal(isPreCutover(row('2026-07-15T10:00:00.000Z'), '2026-08-01'), true);
  });

  test('rows after the date are truth', () => {
    assert.equal(isPreCutover(row('2026-08-15T10:00:00.000Z'), '2026-08-01'), false);
  });

  test('the cutover day itself is truth, not reference', () => {
    // The cutover is the day the count was taken and the clean ledger starts.
    // Excluding it would drop that day's rows out of the reconciliation that
    // the count is supposed to anchor.
    assert.equal(isPreCutover(row('2026-08-01T00:00:00.000Z'), '2026-08-01'), false);
    assert.equal(isPreCutover(row('2026-08-01T23:59:59.000Z'), '2026-08-01'), false);
  });

  test('a cutover before everything leaves the whole ledger as truth', () => {
    const { reference, truth } = splitAtCutover(CORPUS_ROWS, '2026-01-01');
    assert.equal(reference.length, 0);
    assert.equal(truth.length, 153);
  });

  test('a cutover after everything makes the whole ledger reference', () => {
    const { reference, truth } = splitAtCutover(CORPUS_ROWS, '2027-01-01');
    assert.equal(reference.length, 153);
    assert.equal(truth.length, 0);
  });
});

describe('against the real corpus', () => {
  test('a 1 August cutover puts July on the reference side and August on truth', () => {
    const { reference, truth } = splitAtCutover(CORPUS_ROWS, '2026-08-01');
    assert.ok(reference.length > 0 && truth.length > 0, 'both sides should be populated');
    assert.equal(reference.length + truth.length, 153);
    for (const r of reference) assert.equal(monthKey(r.occurred_at), '2026-07');
    for (const r of truth) assert.equal(monthKey(r.occurred_at), '2026-08');
  });

  test('the split is exhaustive and disjoint — no row is lost or counted twice', () => {
    for (const date of ['2026-07-01', '2026-07-15', '2026-08-01', '2026-08-20']) {
      const { reference, truth } = splitAtCutover(CORPUS_ROWS, date);
      assert.equal(reference.length + truth.length, CORPUS_ROWS.length, date);
      const ids = new Set([...reference, ...truth].map((r) => r.id));
      assert.equal(ids.size, CORPUS_ROWS.length, date);
    }
  });

  test('moving the line later only ever moves rows toward reference', () => {
    // The mark is derived, so changing the date reclassifies immediately and
    // monotonically. A stored boolean would not have this property once edited.
    let previous = -1;
    for (const date of ['2026-01-01', '2026-07-15', '2026-08-01', '2026-08-20', '2027-01-01']) {
      const { reference } = splitAtCutover(CORPUS_ROWS, date);
      assert.ok(reference.length >= previous, `${date} went backwards`);
      previous = reference.length;
    }
  });
});

describe('dayKey', () => {
  test('is the local calendar date, matching how monthKey buckets', () => {
    // If these disagreed, a row could read as a July date while sitting in
    // August's bucket.
    for (const r of CORPUS_ROWS) {
      assert.equal(dayKey(r.occurred_at).slice(0, 7), monthKey(r.occurred_at));
    }
  });
});
