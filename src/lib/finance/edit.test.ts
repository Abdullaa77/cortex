import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRowPatch,
  toDraft,
  toDraftDateTime,
  fromDraftDateTime,
  type EditableRow,
} from './edit.ts';

/**
 * An imported row, exactly as the 153 of them sit in the database: midnight on
 * the 1st, carrying a month and not a day.
 */
const imported: EditableRow = {
  amount_minor: 10_120_29,
  direction: 'expense',
  comment: 'two bananas',
  occurred_at: new Date(2026, 7, 1, 0, 0, 0).toISOString(),
  date_precision: 'month',
};

/** A row typed into the app, which knows its day. */
const typed: EditableRow = {
  amount_minor: 45_000_00,
  direction: 'expense',
  comment: 'taxi',
  occurred_at: new Date(2026, 7, 14, 13, 5, 0).toISOString(),
  date_precision: 'day',
};

describe('draft round-trip', () => {
  test('a row opens as itself, and unchanged fields make no patch', () => {
    for (const row of [imported, typed]) {
      const { patch, errors, precisionUpgraded } = buildRowPatch(row, toDraft(row));
      assert.deepEqual(patch, {}, 'opening and saving must not write anything');
      assert.deepEqual(errors, []);
      assert.equal(precisionUpgraded, false);
    }
  });

  test('the datetime survives the round-trip in local time', () => {
    const { date, time } = toDraftDateTime(typed.occurred_at);
    assert.equal(date, '2026-08-14');
    assert.equal(time, '13:05');
    assert.equal(fromDraftDateTime(date, time), typed.occurred_at);
  });

  test('an empty time means midnight', () => {
    assert.equal(
      fromDraftDateTime('2026-08-01', ''),
      new Date(2026, 7, 1, 0, 0, 0).toISOString()
    );
  });
});

describe('date_precision — the guarantee that must not go quiet', () => {
  test("editing an imported row's date flips it to 'day'", () => {
    const draft = { ...toDraft(imported), date: '2026-08-14' };
    const { patch, precisionUpgraded } = buildRowPatch(imported, draft);

    assert.equal(patch.date_precision, 'day');
    assert.equal(precisionUpgraded, true);
    assert.equal(patch.occurred_at, new Date(2026, 7, 14, 0, 0, 0).toISOString());
  });

  test('editing only the time of an imported row flips it too', () => {
    // Picking 09:30 on the 1st is still asserting a real instant.
    const draft = { ...toDraft(imported), time: '09:30' };
    const { patch, precisionUpgraded } = buildRowPatch(imported, draft);

    assert.equal(patch.date_precision, 'day');
    assert.equal(precisionUpgraded, true);
  });

  test('editing the comment or amount leaves the precision alone', () => {
    const commentOnly = buildRowPatch(imported, {
      ...toDraft(imported),
      comment: 'three bananas',
    });
    assert.equal(commentOnly.patch.date_precision, undefined);
    assert.equal(commentOnly.patch.occurred_at, undefined);
    assert.deepEqual(commentOnly.patch, { comment: 'three bananas' });
    assert.equal(commentOnly.precisionUpgraded, false);

    const amountOnly = buildRowPatch(imported, { ...toDraft(imported), amount: '999' });
    assert.equal(amountOnly.patch.date_precision, undefined);
    assert.equal(amountOnly.patch.occurred_at, undefined);
    assert.deepEqual(amountOnly.patch, { amount_minor: 99_900 });
  });

  test('a row that already knows its day is never re-flagged', () => {
    const { patch, precisionUpgraded } = buildRowPatch(typed, {
      ...toDraft(typed),
      date: '2026-08-20',
    });
    assert.equal(patch.occurred_at, new Date(2026, 7, 20, 13, 5, 0).toISOString());
    assert.equal(patch.date_precision, undefined, 'no needless write');
    assert.equal(precisionUpgraded, false);
  });

  test('a blank date is "leave it alone", not "clear it"', () => {
    const { patch, precisionUpgraded } = buildRowPatch(imported, {
      ...toDraft(imported),
      date: '',
      time: '',
    });
    assert.equal(patch.occurred_at, undefined);
    assert.equal(patch.date_precision, undefined);
    assert.equal(precisionUpgraded, false);
  });
});

describe('field edits', () => {
  test('amount is read in major units and stored in minor', () => {
    const { patch } = buildRowPatch(typed, { ...toDraft(typed), amount: '10120.29' });
    assert.equal(patch.amount_minor, 10_120_29);
  });

  test('typed separators are tolerated', () => {
    const { patch, errors } = buildRowPatch(typed, {
      ...toDraft(typed),
      amount: '1,250,000',
    });
    assert.deepEqual(errors, []);
    assert.equal(patch.amount_minor, 1_250_000_00);
  });

  test('direction can be turned around', () => {
    const { patch } = buildRowPatch(typed, { ...toDraft(typed), direction: 'income' });
    assert.deepEqual(patch, { direction: 'income' });
  });

  test('the comment is trimmed, and whitespace alone is not a change', () => {
    const { patch } = buildRowPatch(typed, { ...toDraft(typed), comment: '  taxi  ' });
    assert.deepEqual(patch, {});
  });

  test('several fields at once come back as one patch', () => {
    const { patch, precisionUpgraded } = buildRowPatch(imported, {
      amount: '25000',
      direction: 'income',
      comment: 'refund',
      date: '2026-08-09',
      time: '18:45',
    });
    assert.deepEqual(patch, {
      amount_minor: 25_000_00,
      direction: 'income',
      comment: 'refund',
      occurred_at: new Date(2026, 7, 9, 18, 45, 0).toISOString(),
      date_precision: 'day',
    });
    assert.equal(precisionUpgraded, true);
  });
});

describe('rejected edits write nothing at all', () => {
  for (const amount of ['', '0', '-5', 'abc', 'NaN'])
    test(`"${amount}" is refused`, () => {
      const { patch, errors, precisionUpgraded } = buildRowPatch(imported, {
        ...toDraft(imported),
        amount,
        date: '2026-08-14',
      });
      assert.ok(errors.length > 0, 'must say why');
      // The valid half of a rejected edit must not slip through on its own.
      assert.deepEqual(patch, {});
      assert.equal(precisionUpgraded, false);
    });

  test('an unreadable date is refused rather than guessed', () => {
    const { patch, errors } = buildRowPatch(imported, {
      ...toDraft(imported),
      date: 'not-a-date',
    });
    assert.ok(errors.length > 0);
    assert.deepEqual(patch, {});
  });
});
