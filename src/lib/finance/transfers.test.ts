import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsOtherSide,
  planResolution,
  planPairDeletion,
  impliedRateMinor,
  openTransferCount,
  type PairableRow,
} from './transfers.ts';
import {
  PAIRABLE_ROWS,
  ACCOUNTS,
  MAIN_ID,
  MOM_USD_ID,
  MOM_UZS_ID,
  SISTER_ID,
  RETIRED_ID,
} from './__fixtures__/corpus.ts';
import { classifyRow } from './summarize.ts';

const account = (id: string) => ACCOUNTS.find((a) => a.id === id)!;
const openFor = (fragment: string) =>
  needsOtherSide(PAIRABLE_ROWS).find((o) => o.row.raw_input.includes(fragment))!;

describe('the queue', () => {
  test('holds every transfer with one end still unknown', () => {
    // Seventeen of the 153 imported rows are transfers, and Stage 1 left the
    // far side of all of them NULL rather than guessing.
    assert.equal(openTransferCount(PAIRABLE_ROWS), 17);
  });

  test('and nothing else — an expense is not missing an account', () => {
    // The money left the household. There is no account on the other side of
    // a bag of groceries, and putting one there would be an invented fact.
    for (const open of needsOtherSide(PAIRABLE_ROWS)) {
      const cls = classifyRow(open.row);
      assert.ok(cls === 'transfer-in' || cls === 'transfer-out', open.row.raw_input);
    }
    const spendRows = PAIRABLE_ROWS.filter((r) => classifyRow(r) === 'spend');
    assert.ok(spendRows.length > 100);
    const ids = new Set(needsOtherSide(PAIRABLE_ROWS).map((o) => o.row.id));
    for (const r of spendRows) assert.equal(ids.has(r.id), false);
  });

  test('money that left is missing its destination', () => {
    const open = openFor('transferred to mom for 400$');
    assert.equal(open.missing, 'destination');
    assert.equal(open.knownAccountId, MAIN_ID);
    assert.equal(open.row.amount_minor, 4_850_000 * 100);
  });

  test('money that arrived is missing its source', () => {
    // The +151,000 came from his sister. Which end is unknown depends on which
    // way the money went, and saying "from Main" for money that arrived would
    // be a wrong fact rather than a missing one.
    const open = openFor('PersonC sister sent back');
    assert.equal(open.missing, 'source');
    assert.equal(open.knownAccountId, MAIN_ID);
  });

  test('newest first', () => {
    const queue = needsOtherSide(PAIRABLE_ROWS);
    for (let i = 1; i < queue.length; i++)
      assert.ok(queue[i - 1].row.occurred_at >= queue[i].row.occurred_at);
  });

  test('an already-answered transfer is not in it', () => {
    const answered: PairableRow[] = PAIRABLE_ROWS.map((r) =>
      r.raw_input.includes('PersonC sister sent back')
        ? { ...r, from_account_id: SISTER_ID }
        : r
    );
    assert.equal(openTransferCount(answered), 16);
  });

  test('a paired transfer is answered even with one pointer still NULL', () => {
    // Its counterpart names where the value went. That is the answer.
    const paired: PairableRow[] = PAIRABLE_ROWS.map((r) =>
      r.raw_input.includes('transferred to mom for 400$')
        ? { ...r, transfer_pair_id: 'other-row' }
        : r
    );
    assert.equal(openTransferCount(paired), 16);
  });

  test('nothing is inferred — the queue only ever shrinks by being answered', () => {
    // The same rows, re-read, produce the same queue. No pass over the data
    // quietly fills anything in.
    assert.deepEqual(
      needsOtherSide(PAIRABLE_ROWS).map((o) => o.row.id),
      needsOtherSide(PAIRABLE_ROWS).map((o) => o.row.id)
    );
  });
});

describe('resolving, same currency: one movement', () => {
  const open = openFor('PersonC sister sent back');

  test('picking the source sets the missing side and nothing else', () => {
    const plan = planResolution(open, account(SISTER_ID));
    assert.equal(plan.kind, 'set-side');
    assert.deepEqual(plan.kind === 'set-side' && plan.patch, {
      from_account_id: SISTER_ID,
    });
  });

  test('picking a destination for outgoing money sets the other side', () => {
    const out = openFor('-250k sent to PersonE');
    const plan = planResolution(out, account(MOM_UZS_ID));
    assert.deepEqual(plan.kind === 'set-side' && plan.patch, {
      to_account_id: MOM_UZS_ID,
    });
  });
});

describe('resolving, cross currency: two movements', () => {
  const open = openFor('transferred to mom for 400$');

  test('it refuses until the arriving amount is stated', () => {
    // 4,850,000 so'm did not turn into $400 in a drawer. Nobody but Scott
    // knows what rate he got, and the app must not pick one.
    const plan = planResolution(open, account(MOM_USD_ID));
    assert.equal(plan.kind, 'refused');
    assert.match(plan.kind === 'refused' ? plan.reason : '', /how much USD arrived/i);
  });

  test('given the amount, it writes the counterpart in the destination currency', () => {
    const plan = planResolution(open, account(MOM_USD_ID), 400 * 100);
    assert.equal(plan.kind, 'pair');
    if (plan.kind !== 'pair') return;
    assert.equal(plan.counterpart.amount_minor, 40_000);
    assert.equal(plan.counterpart.currency, 'USD');
    assert.equal(plan.counterpart.to_account_id, MOM_USD_ID);
    assert.equal(plan.counterpart.from_account_id, null);
    assert.equal(plan.counterpart.category_slug, 'transfer');
  });

  test('the counterpart is mirrored, not copied', () => {
    // Writing the same direction twice would report the household as having
    // lost the money in both places.
    const plan = planResolution(open, account(MOM_USD_ID), 40_000);
    assert.equal(plan.kind === 'pair' && plan.counterpart.direction, 'income');
    assert.equal(open.row.direction, 'expense');
  });

  test('the som row is never given a dollar account', () => {
    // A som amount pointed at a dollar position would subtract four hundred
    // thousand DOLLARS from that drawer, and read plausibly on a page.
    const plan = planResolution(open, account(MOM_USD_ID), 40_000);
    assert.equal(plan.kind, 'pair');
    assert.equal(plan.kind === 'pair' && 'patch' in plan, false);
  });

  test('an arriving row pairs the other way round', () => {
    const incoming = openFor('PersonC sister sent back');
    const plan = planResolution(incoming, account(MOM_USD_ID), 1_200);
    assert.equal(plan.kind, 'pair');
    if (plan.kind !== 'pair') return;
    assert.equal(plan.counterpart.direction, 'expense');
    assert.equal(plan.counterpart.from_account_id, MOM_USD_ID);
    assert.equal(plan.counterpart.to_account_id, null);
  });

  test('a nonsense counterpart amount is refused', () => {
    for (const bad of [0, -1, 12.5]) {
      const plan = planResolution(open, account(MOM_USD_ID), bad);
      assert.equal(plan.kind, 'refused', `${bad} was accepted`);
    }
  });
});

describe('what resolution refuses outright', () => {
  const open = openFor('transferred to mom for 400$');

  test('the account it already came from', () => {
    const plan = planResolution(open, account(MAIN_ID));
    assert.equal(plan.kind, 'refused');
    assert.match(plan.kind === 'refused' ? plan.reason : '', /itself/i);
  });

  test('a retired account', () => {
    const plan = planResolution(open, account(RETIRED_ID));
    assert.equal(plan.kind, 'refused');
    assert.match(plan.kind === 'refused' ? plan.reason : '', /retired/i);
  });
});

describe('the rate a pair implies', () => {
  test('4,850,000 so\'m for $400 is 12,125 a dollar', () => {
    // Shown beside the pair so a bad exchange stays visible as a bad exchange
    // rather than disappearing into a balance. Never used to convert anything.
    assert.equal(impliedRateMinor(4_850_000 * 100, 400 * 100), 12_125 * 100);
  });

  test('nothing arriving implies no rate rather than infinity', () => {
    assert.equal(impliedRateMinor(485_000_000, 0), null);
  });
});


/**
 * Deleting one leg of a pair.
 *
 * The requirement is precise: it must degrade safely, and it must not orphan
 * QUIETLY. Those are two separate claims and they are tested separately —
 * safety is about what survives, quietness is about whether anyone finds out.
 */
describe('half-deleting a cross-currency pair', () => {
  const som = openFor('transferred to mom for 400$').row;
  const dollars: PairableRow = {
    id: 'usd-leg',
    amount_minor: 400 * 100,
    currency: 'USD',
    direction: 'income',
    occurred_at: som.occurred_at,
    comment: som.comment,
    raw_input: som.raw_input,
    from_account_id: null,
    to_account_id: MOM_USD_ID,
    transfer_pair_id: som.id,
    finance_categories: som.finance_categories,
  };

  /** The corpus with those two rows paired to each other. */
  const paired: PairableRow[] = [
    ...PAIRABLE_ROWS.map((r) => (r.id === som.id ? { ...r, transfer_pair_id: dollars.id } : r)),
    dollars,
  ];

  /** The same set after the dollar leg is deleted, with SET NULL applied. */
  const afterDelete: PairableRow[] = paired
    .filter((r) => r.id !== dollars.id)
    .map((r) => (r.transfer_pair_id === dollars.id ? { ...r, transfer_pair_id: null } : r));

  test('pairing answers both rows, so neither is in the queue', () => {
    const ids = new Set(needsOtherSide(paired).map((o) => o.row.id));
    assert.equal(ids.has(som.id), false);
    assert.equal(ids.has(dollars.id), false);
    assert.equal(openTransferCount(paired), 16);
  });

  test('the survivor is intact — it records money that really did move', () => {
    // Not a cascade. Deleting the record that money ARRIVED because someone
    // deleted the record that money LEFT would remove a row nobody pointed at
    // and restate whatever month it was in.
    const survivor = afterDelete.find((r) => r.id === som.id)!;
    assert.equal(survivor.amount_minor, 4_850_000 * 100);
    assert.equal(survivor.from_account_id, MAIN_ID);
  });

  test('and it goes back to the queue, unanswered — this is the not-quiet part', () => {
    const open = needsOtherSide(afterDelete).find((o) => o.row.id === som.id);
    assert.ok(open, 'the surviving leg must be asked about again');
    assert.equal(open.missing, 'destination');
    assert.equal(openTransferCount(afterDelete), 17);
  });

  test('the warning names what stops being recorded, before the click', () => {
    const plan = planPairDeletion(dollars, paired);
    assert.equal(plan.counterpart?.id, som.id);
    // 4,850,000 for $400.
    assert.equal(plan.observedRateMinor, 12_125 * 100);
    assert.match(plan.warning, /other row stays/i);
    assert.match(plan.warning, /needs the other side/i);
    assert.match(plan.warning, /12,125/);
  });

  test('it warns from either end', () => {
    const fromSom = planPairDeletion(paired.find((r) => r.id === som.id)!, paired);
    assert.equal(fromSom.counterpart?.id, dollars.id);
    assert.equal(fromSom.observedRateMinor, 12_125 * 100);
  });

  test('an unpaired row costs nothing and says nothing', () => {
    // A warning on every delete is a warning nobody reads.
    assert.deepEqual(planPairDeletion(som, PAIRABLE_ROWS), {
      counterpart: null,
      observedRateMinor: null,
      warning: '',
    });
  });

  test('a pointer whose counterpart is not loaded still says something honest', () => {
    const stale = { ...dollars, transfer_pair_id: 'row-that-is-not-here' };
    const plan = planPairDeletion(stale, [stale]);
    assert.equal(plan.counterpart, null);
    assert.equal(plan.observedRateMinor, null);
    assert.match(plan.warning, /not loaded here/i);
  });

  test('a same-currency pair warns without inventing a rate', () => {
    // Two som rows imply nothing about dollars, and a number here would be
    // arithmetic dressed up as a fact.
    const somCounterpart: PairableRow = { ...dollars, id: 'som-leg', currency: 'UZS' };
    const plan = planPairDeletion(somCounterpart, [
      ...paired.filter((r) => r.id !== dollars.id),
      somCounterpart,
    ]);
    assert.equal(plan.observedRateMinor, null);
    assert.match(plan.warning, /other row stays/i);
    assert.equal(/so'm to the dollar/.test(plan.warning), false);
  });
});
