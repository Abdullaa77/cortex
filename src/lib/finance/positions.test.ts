import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionsAt,
  householdTotal,
  convertUsdToUzs,
  openingFromCheckpoints,
  daysBetween,
  type FxRate,
} from './positions.ts';
import type { BalanceCheckpoint, MovementRow } from './checkpoints.ts';
import {
  ACCOUNTS,
  CHECKPOINTS,
  MOVEMENTS,
  FX_RATE,
  MAIN_ID,
  MOM_UZS_ID,
  MOM_USD_ID,
  SISTER_ID,
  RETIRED_ID,
  OPENING,
  OPENING_COUNTED_AT,
} from './__fixtures__/corpus.ts';
import { atLocalNoon } from './cutover.ts';
import { splitAtCutover } from './cutover.ts';

const at = (day: string) => positionsAt(ACCOUNTS, CHECKPOINTS, MOVEMENTS, day);
const find = (day: string, id: string) => at(day).find((p) => p.account.id === id)!;

describe('positions on a day', () => {
  test('only active accounts hold anything — a retired one is not a position', () => {
    // It stays resolvable so history can point at it. It does not go on
    // claiming to contain money.
    assert.equal(at('2026-08-31').some((p) => p.account.id === RETIRED_ID), false);
  });

  test('in display order, so the page never reorders itself', () => {
    assert.deepEqual(at('2026-08-31').map((p) => p.account.id), [
      MAIN_ID,
      MOM_UZS_ID,
      MOM_USD_ID,
      SISTER_ID,
    ]);
  });

  test("Main's position is the ledger's closing balance", () => {
    assert.equal(find('2026-08-31', MAIN_ID).balance.minor, 187_803_111);
  });

  test('an account with no rows since its count still holds what was counted', () => {
    assert.equal(find('2026-08-31', MOM_UZS_ID).balance.minor, 1_200_000 * 100);
  });

  test('a count of zero is a real position, not an uncounted one', () => {
    const sister = find('2026-08-31', SISTER_ID);
    assert.equal(sister.balance.minor, 0);
    assert.equal(sister.uncounted, false);
  });

  test('before anything was counted, every account reads unknown', () => {
    for (const p of at('2026-06-01')) {
      assert.equal(p.balance.minor, null);
      assert.equal(p.uncounted, true);
      assert.equal(p.daysSinceCount, null);
    }
  });

  test('how stale each figure is, so an old count can look old', () => {
    assert.equal(find('2026-08-31', MOM_UZS_ID).daysSinceCount, 62);
    assert.equal(daysBetween(OPENING_COUNTED_AT, '2026-08-31'), 62);
  });
});

describe('the cutover needs no special case in the position math', () => {
  test('pre-cutover rows are excluded because the count superseded them', () => {
    // Stage 1's helper marks them reference; nothing here consults it. The
    // opening count is dated before them, so... they are IN. Move the count
    // forward to the cutover and they drop out by the ordinary rule.
    const cutover = '2026-08-01';
    const { reference } = splitAtCutover(MOVEMENTS, cutover);
    assert.ok(reference.length > 0);

    const counted: BalanceCheckpoint[] = [
      {
        id: 'cp-cut',
        account_id: MAIN_ID,
        counted_at: cutover,
        counted_minor: 500_000 * 100,
        note: 'Cutover count.',
        adjustment_transaction_id: null,
      },
    ];
    // Every July row, and every August row dated the 1st, is already inside
    // the 500,000 he counted. Nothing before the count votes twice.
    const p = positionsAt(ACCOUNTS, counted, MOVEMENTS, cutover);
    assert.equal(p.find((x) => x.account.id === MAIN_ID)!.balance.minor, 500_000 * 100);
  });

  test('and the reference rows are still there to be read', () => {
    // Excluded from the arithmetic, not removed from the ledger.
    const { reference } = splitAtCutover(MOVEMENTS, '2026-08-01');
    assert.equal(reference.length, 65);
  });
});

describe('positions stay native; the total states its rate', () => {
  const positions = at('2026-08-31');

  test('som with som, dollars with dollars', () => {
    const total = householdTotal(positions, FX_RATE);
    const uzs = total.byCurrency.find((c) => c.currency === 'UZS')!;
    const usd = total.byCurrency.find((c) => c.currency === 'USD')!;
    assert.equal(uzs.minor, 187_803_111 + 1_200_000 * 100 + 0);
    assert.equal(usd.minor, 400 * 100);
    assert.equal(uzs.countedAccounts, 3);
    assert.equal(usd.countedAccounts, 1);
  });

  test('the dollars are converted once, at the rate that was typed in', () => {
    // $400 at 12,650 so'm.
    assert.equal(convertUsdToUzs(400 * 100, FX_RATE), 5_060_000 * 100);
    const total = householdTotal(positions, FX_RATE);
    assert.equal(total.convertedUzsMinor, 5_060_000 * 100);
    assert.equal(total.totalUzsMinor, 187_803_111 + 120_000_000 + 506_000_000);
  });

  test('the rate comes back with the total, so the total can state it', () => {
    const total = householdTotal(positions, FX_RATE);
    assert.equal(total.rate?.uzsPerUsdMinor, 1_265_000);
    assert.equal(total.rate?.setAt, '2026-08-01');
  });

  test('with dollars and no rate there is NO total — not a som-only one', () => {
    // A smaller number wearing the label of the whole is worse than no number.
    const total = householdTotal(positions, null);
    assert.equal(total.totalUzsMinor, null);
    assert.equal(total.needsRate, true);
    assert.equal(total.convertedUzsMinor, 0);
    // The native figures are still all there.
    assert.equal(total.byCurrency.find((c) => c.currency === 'USD')!.minor, 40_000);
  });

  test('with no dollars at all, a missing rate stops nothing', () => {
    const somOnly = positions.filter((p) => p.account.currency === 'UZS');
    const total = householdTotal(somOnly, null);
    assert.equal(total.needsRate, false);
    assert.equal(total.totalUzsMinor, 187_803_111 + 120_000_000);
  });

  test('a changed rate moves only the total, never a position', () => {
    const cheap = householdTotal(positions, FX_RATE);
    const dear = householdTotal(positions, { uzsPerUsdMinor: 1_300_000, setAt: '2026-08-29' });
    assert.notEqual(cheap.totalUzsMinor, dear.totalUzsMinor);
    assert.deepEqual(
      cheap.byCurrency.map((c) => [c.currency, c.minor]),
      dear.byCurrency.map((c) => [c.currency, c.minor])
    );
  });
});

describe('uncounted is never zero', () => {
  const partial = CHECKPOINTS.filter((c) => c.account_id !== MOM_UZS_ID);
  const positions = positionsAt(ACCOUNTS, partial, MOVEMENTS, '2026-08-31');

  test('an uncounted account contributes nothing to any total', () => {
    const total = householdTotal(positions, FX_RATE);
    const uzs = total.byCurrency.find((c) => c.currency === 'UZS')!;
    assert.equal(uzs.minor, 187_803_111);
    assert.equal(uzs.uncountedAccounts, 1);
    assert.equal(uzs.countedAccounts, 2);
  });

  test('and it is handed back by name, so the page can say so', () => {
    const total = householdTotal(positions, FX_RATE);
    assert.deepEqual(total.uncounted.map((p) => p.account.id), [MOM_UZS_ID]);
  });

  test('the total does not silently shrink into looking complete', () => {
    const complete = householdTotal(at('2026-08-31'), FX_RATE);
    const incomplete = householdTotal(positions, FX_RATE);
    assert.notEqual(complete.totalUzsMinor, incomplete.totalUzsMinor);
    assert.equal(complete.uncounted.length, 0);
    assert.equal(incomplete.uncounted.length, 1);
  });
});

describe('whose money it is', () => {
  test('grouped by owner, native per currency', () => {
    const total = householdTotal(at('2026-08-31'), FX_RATE);
    const mom = total.byOwner.find((o) => o.owner === 'mom')!;
    assert.deepEqual(
      mom.byCurrency.map((c) => [c.currency, c.minor]),
      [
        ['UZS', 120_000_000],
        ['USD', 40_000],
      ]
    );
  });

  test('an owner with no accounts does not appear as an empty row', () => {
    const mine = at('2026-08-31').filter((p) => p.account.owner === 'me');
    assert.deepEqual(householdTotal(mine, FX_RATE).byOwner.map((o) => o.owner), ['me']);
  });
});

describe('the opening balance comes from the counts now', () => {
  test('it is the sum of every first checkpoint, as of the earliest', () => {
    const opening = openingFromCheckpoints(ACCOUNTS, CHECKPOINTS, FX_RATE)!;
    // 8,000,000 + 1,200,000 + $400 at 12,650 + 0
    assert.equal(opening.amountMinor, 800_000_000 + 120_000_000 + 506_000_000 + 0);
    assert.equal(opening.asOf, OPENING_COUNTED_AT);
    assert.equal(opening.skippedAccounts, 0);
  });

  test("Main's own first count is still exactly the Stage 1 figure", () => {
    const mainOnly = CHECKPOINTS.filter((c) => c.account_id === MAIN_ID);
    const opening = openingFromCheckpoints(ACCOUNTS, mainOnly, FX_RATE)!;
    assert.equal(opening.amountMinor, OPENING.amountMinor);
    assert.equal(opening.asOf, OPENING_COUNTED_AT);
  });

  test('a later count never becomes the opening', () => {
    const later: BalanceCheckpoint = {
      id: 'cp-main-1',
      account_id: MAIN_ID,
      counted_at: '2026-08-15',
      counted_minor: 1,
      note: null,
      adjustment_transaction_id: null,
    };
    const opening = openingFromCheckpoints(ACCOUNTS, [later, ...CHECKPOINTS], FX_RATE)!;
    assert.equal(opening.amountMinor, 800_000_000 + 120_000_000 + 506_000_000);
  });

  test('without a rate the dollar account is LEFT OUT, never added raw', () => {
    // $400 added as 400 so'm would be a rounding error; added as 40,000 tiyin
    // it is still off by a factor of twelve thousand. Skipping is the only
    // answer that is not quietly wrong, and the count of skips is reported.
    const opening = openingFromCheckpoints(ACCOUNTS, CHECKPOINTS, null)!;
    assert.equal(opening.amountMinor, 800_000_000 + 120_000_000);
    assert.equal(opening.skippedAccounts, 1);
  });

  test('no checkpoints at all means no opening — not an opening of zero', () => {
    assert.equal(openingFromCheckpoints(ACCOUNTS, [], FX_RATE), null);
  });
});

describe('conversion arithmetic', () => {
  test('a rate of 12,650 turns $1 into 12,650 so\'m', () => {
    assert.equal(convertUsdToUzs(100, FX_RATE), 12_650 * 100);
  });

  test('zero dollars is zero so\'m, not a rounding artefact', () => {
    assert.equal(convertUsdToUzs(0, FX_RATE), 0);
  });

  test('it rounds to whole tiyin rather than carrying a fraction', () => {
    const rate: FxRate = { uzsPerUsdMinor: 1_265_037, setAt: '2026-08-01' };
    const out = convertUsdToUzs(333, rate);
    assert.equal(Number.isInteger(out), true);
    assert.equal(out, Math.round((333 * 1_265_037) / 100));
  });
});

describe('daysBetween', () => {
  test('counts whole days across a month boundary', () => {
    assert.equal(daysBetween('2026-07-31', '2026-08-01'), 1);
    assert.equal(daysBetween('2026-06-30', '2026-08-31'), 62);
  });

  test('the same day is zero', () => {
    assert.equal(daysBetween('2026-08-01', '2026-08-01'), 0);
  });
});

describe('a movement into an account nobody counted', () => {
  const rows: MovementRow[] = [
    { id: 'x', amount_minor: 5_000, occurred_at: atLocalNoon('2026-08-10'), from_account_id: MAIN_ID, to_account_id: MOM_UZS_ID },
  ];

  test('leaves it uncounted rather than making 5,000 look like the whole of it', () => {
    const partial = CHECKPOINTS.filter((c) => c.account_id !== MOM_UZS_ID);
    const p = positionsAt(ACCOUNTS, partial, rows, '2026-08-31');
    const mom = p.find((x) => x.account.id === MOM_UZS_ID)!;
    assert.equal(mom.balance.minor, null);
    assert.equal(mom.uncounted, true);
  });
});
