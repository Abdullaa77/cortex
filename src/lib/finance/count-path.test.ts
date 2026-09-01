import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planCount,
  reconcileCount,
  cutoverLineFor,
  UNACCOUNTED_SLUG,
  type BalanceCheckpoint,
  type MovementRow,
} from './checkpoints.ts';
import { rollforward } from './reconcile.ts';
import { monthTotals } from './summarize.ts';
import { atLocalNoon } from './cutover.ts';

/**
 * THE PATH THE BUTTON TAKES, not the function underneath it.
 *
 * checkpoints.test.ts already proves `reconcileCount` suppresses a cutover
 * count, and it already contains a test named "without the cutover date that
 * same count books millions of fiction". Both passed. On 1 September 2026 the
 * fiction was booked anyway — thirteen adjustments totalling 3,488,123.87
 * so'm, filed as `unaccounted` spend, turning a month whose real spending was
 * 14,548 into a month that read 3,502,671.87 and an everyday floor that read
 * "0% of the month".
 *
 * Nothing in the pure function was wrong. `finance_settings.cutover_date` was
 * NULL, so `cutoverDate` arrived falsy and the guard — `if (cutoverDate && ...)`
 * — was inert. Migration 009 creates the settings row with `default_account_id`
 * and leaves `cutover_date` unset, and the ONLY code that ever writes it is
 * step 0 of /finance/cutover. Counting from the `count` button on PositionsCard
 * never goes near it.
 *
 * The suite could not see this, and could not have, because every assertion in
 * it passed the date in by hand. The one input that actually varied in
 * production was the one input no test supplied. So these tests do two things
 * the old ones did not:
 *
 *   - Run the WRITE PATH's own decision (`planCount`, which `recordCount` is
 *     now nothing but I/O around) rather than a function it happens to call.
 *   - Pin the WIRING as text, so the date cannot be dropped from an entry
 *     point again without a test going red. See failure-states.test.ts for the
 *     same idiom and the same reason.
 */

const som = (n: number) => Math.round(n * 100);

/** The real figures, from the incident. */
const MAIN = 'acct-main';
const CUTOVER = '2026-09-01';
const MIGRATED_OPENING = som(6_125_000); // what 009 carried across, re-dated to 30 June
const AUG_CLOSING = som(6_463_295.3); // what the reconstructed notes derive at 31 Aug
const GROCERIES = som(14_548); // the only real September row
const COUNTED = som(2_960_623.43); // what Scott actually counted, 13 drawers
const FICTION = som(3_488_123.87); // what got written instead

/**
 * Main's basis is a MIGRATED OPENING BALANCE, not a count. That is the whole
 * hazard: the account has a basis, so `kind: 'opening'` never fires, and the
 * basis is derived from two months of notes reconstructed after the fact.
 */
const OPENING_CHECKPOINT: BalanceCheckpoint = {
  id: 'cp-opening',
  account_id: MAIN,
  counted_at: '2026-06-30',
  counted_minor: MIGRATED_OPENING,
  note: "Migrated from the account's opening balance.",
  adjustment_transaction_id: null,
};

const REFERENCE_ROW: MovementRow = {
  id: 'row-reference',
  amount_minor: Math.abs(AUG_CLOSING - MIGRATED_OPENING),
  occurred_at: new Date(2026, 7, 15, 12).toISOString(),
  from_account_id: AUG_CLOSING < MIGRATED_OPENING ? MAIN : null,
  to_account_id: AUG_CLOSING < MIGRATED_OPENING ? null : MAIN,
};

const GROCERIES_ROW: MovementRow = {
  id: 'row-groceries',
  amount_minor: GROCERIES,
  occurred_at: new Date(2026, 8, 1, 18).toISOString(),
  from_account_id: MAIN,
  to_account_id: null,
};

const MOVEMENTS = [REFERENCE_ROW, GROCERIES_ROW];

const plan = (cutoverDate: string | null, checkpoints = [OPENING_CHECKPOINT]) =>
  planCount({
    accountId: MAIN,
    countedAt: CUTOVER,
    countedMinor: COUNTED,
    checkpoints,
    movements: MOVEMENTS,
    cutoverDate,
  });

describe('the incident, reproduced through the code that caused it', () => {
  test('THE INCIDENT: reconciling with no line books the fiction, to the tiyin', () => {
    // The pure comparison, asked the question the write path used to ask it.
    // This is not correct behaviour — it is the production failure, kept so the
    // cost of an unset line is written down as a number rather than a worry.
    const r = reconcileCount(MAIN, [OPENING_CHECKPOINT], MOVEMENTS, CUTOVER, COUNTED, null);

    assert.equal(r.kind, 'money-missing');
    assert.equal(r.gapMinor, -FICTION);
    assert.equal(r.derivedMinor, AUG_CLOSING - GROCERIES, 'measured at 1 Sept, after groceries');
    assert.equal(r.basis?.id, 'cp-opening', 'held to a MIGRATED OPENING, not to a count');
  });

  test('and the write path no longer asks that question at all', () => {
    // Same account, same rows, same missing setting. The line gets drawn
    // instead of the fiction.
    const p = plan(null);

    assert.equal(p.establishesLine, CUTOVER);
    assert.equal(p.result.kind, 'cutover');
    assert.equal(p.draft, null, 'the 3,488,123.87 is not written');
  });
});

describe('a count with no line set draws it, at its own day', () => {
  test('the day is the count, never the earliest checkpoint', () => {
    // Main's earliest checkpoint is the 30 June migrated opening. Drawing the
    // line there would put two months of reconstruction on the truth side.
    assert.equal(cutoverLineFor(CUTOVER, null).cutoverDate, CUTOVER);
    assert.equal(cutoverLineFor(CUTOVER, null).establishes, true);
  });

  test('an empty string is unset, not the year zero', () => {
    assert.equal(plan('').establishesLine, CUTOVER);
    assert.equal(plan('').result.kind, 'cutover');
  });

  test('a line already set is never redrawn', () => {
    assert.equal(cutoverLineFor(CUTOVER, '2026-08-15').cutoverDate, '2026-08-15');
    assert.equal(plan('2026-08-15').establishesLine, null);
  });

  test('thirteen drawers on one evening name the same day, in any order', () => {
    // The first count saved draws the line; the other twelve then see it set.
    // But if two race and both arrive with no date, they must not disagree —
    // the day is a property of the count, not of who got there first.
    for (const first of [true, false])
      assert.equal(plan(first ? null : CUTOVER).result.kind, 'cutover');
  });

  test('the migrated opening is present and is exactly what makes this dangerous', () => {
    // Guards the fixture, not the code: if this checkpoint stopped being found,
    // the suppression above would pass for the wrong reason — `kind: 'opening'`
    // suppresses too, and would hide a broken line behind a green tick.
    const held = reconcileCount(MAIN, [OPENING_CHECKPOINT], MOVEMENTS, CUTOVER, COUNTED, null);
    assert.equal(held.basis?.id, 'cp-opening');
    assert.notEqual(held.kind, 'opening', 'this account HAS a basis; that is the hazard');
  });
});

describe('the write path, with a line already set', () => {
  test('the same count on the same rows writes nothing', () => {
    const p = plan(CUTOVER);

    assert.equal(p.result.kind, 'cutover');
    assert.equal(p.result.derivedMinor, null, 'a cutover count derives nothing');
    assert.equal(p.result.gapMinor, null);
    assert.equal(p.result.basis, null, 'the migrated opening is not a basis to be held to');
    assert.equal(p.draft, null, 'nothing is written beyond the count itself');
    assert.equal(p.establishesLine, null, 'and nothing is re-declared');
  });

  test('a count after the line still reconciles — the half that must not regress', () => {
    const cutoverCount: BalanceCheckpoint = {
      id: 'cp-cutover',
      account_id: MAIN,
      counted_at: CUTOVER,
      counted_minor: COUNTED,
      note: 'Cutover count.',
      adjustment_transaction_id: null,
    };
    const spentSince: MovementRow = {
      id: 'row-later',
      amount_minor: som(50_000),
      occurred_at: new Date(2026, 8, 5, 12).toISOString(),
      from_account_id: MAIN,
      to_account_id: null,
    };

    const p = planCount({
      accountId: MAIN,
      countedAt: '2026-09-08',
      countedMinor: COUNTED - som(70_000),
      checkpoints: [OPENING_CHECKPOINT, cutoverCount],
      movements: [...MOVEMENTS, spentSince],
      cutoverDate: CUTOVER,
    });

    assert.equal(p.result.kind, 'money-missing');
    assert.equal(p.result.basis?.counted_at, CUTOVER, 'measured from the cutover count');
    assert.equal(p.result.gapMinor, -som(20_000), 'only the unlogged 20,000');
    assert.equal(p.draft?.amount_minor, som(20_000));
    assert.equal(p.establishesLine, null);
  });

  test('a later count with the line MISSING draws it there and suppresses — safe, not silent', () => {
    // The failure mode of the new rule, stated. If the date were somehow lost,
    // a later count would draw the line at its own day and suppress a real gap
    // rather than invent one. Information is withheld, not fabricated, and
    // CountDialog says so before the save. See the wiring tests below.
    const cutoverCount: BalanceCheckpoint = {
      id: 'cp-cutover',
      account_id: MAIN,
      counted_at: CUTOVER,
      counted_minor: COUNTED,
      note: null,
      adjustment_transaction_id: null,
    };
    const p = planCount({
      accountId: MAIN,
      countedAt: '2026-09-08',
      countedMinor: COUNTED - som(70_000),
      checkpoints: [OPENING_CHECKPOINT, cutoverCount],
      movements: MOVEMENTS,
      cutoverDate: null,
    });

    assert.equal(p.establishesLine, '2026-09-08');
    assert.equal(p.draft, null, 'nothing invented');
  });
});

describe('a recount supersedes its predecessor, adjustment and all', () => {
  const firstAdjustment: MovementRow = {
    id: 'row-adj',
    amount_minor: som(30_000),
    occurred_at: atLocalNoon('2026-09-08'),
    from_account_id: MAIN,
    to_account_id: null,
  };
  const cutoverCount: BalanceCheckpoint = {
    id: 'cp-cutover',
    account_id: MAIN,
    counted_at: CUTOVER,
    counted_minor: COUNTED,
    note: null,
    adjustment_transaction_id: null,
  };
  const firstCount: BalanceCheckpoint = {
    id: 'cp-first',
    account_id: MAIN,
    counted_at: '2026-09-08',
    counted_minor: COUNTED - som(30_000),
    note: null,
    adjustment_transaction_id: 'row-adj',
  };

  const recount = () =>
    planCount({
      accountId: MAIN,
      countedAt: '2026-09-08',
      countedMinor: COUNTED - som(45_000),
      checkpoints: [OPENING_CHECKPOINT, cutoverCount, firstCount],
      movements: [...MOVEMENTS, firstAdjustment],
      cutoverDate: CUTOVER,
    });

  test('the superseded adjustment is named so the caller can delete it', () => {
    assert.equal(recount().supersededAdjustmentId, 'row-adj');
  });

  test('and is excluded from the rows the new gap is measured against', () => {
    assert.ok(!recount().movements.some((m) => m.id === 'row-adj'));
    // The whole 45,000, not 15,000 on top of a row describing a count that no
    // longer exists. One count, one adjustment.
    assert.equal(recount().draft?.amount_minor, som(45_000));
  });
});

/**
 * The second symptom, from the same NULL.
 *
 * `rollforward` seeds the cutover month from the count — `cutoverDate ?
 * askHousehold(cutoverDate) : null`. With the date unset there is no seed, so
 * September opened from August's reconstructed closing instead of from the
 * drawer. One missing setting, two wrong figures; worth pinning together so
 * neither can be "fixed" alone.
 */
describe('the same unset date also un-seeds the month', () => {
  const accounts = [
    {
      id: MAIN,
      name: 'Main',
      owner: 'me',
      kind: 'cash',
      currency: 'UZS',
      is_active: true,
      sort_order: 0,
    },
  ] as never[];

  const txn = (m: MovementRow, slug: string) =>
    ({
      ...m,
      direction: m.from_account_id ? 'expense' : 'income',
      currency: 'UZS',
      category_slug: slug,
      category_name: slug,
      date_precision: 'day',
      needs_review: false,
      comment: null,
      raw_input: null,
      transfer_pair_id: null,
      reimburses_transaction_id: null,
      beneficiary: null,
    }) as never;

  const counted: BalanceCheckpoint = {
    id: 'cp-cutover',
    account_id: MAIN,
    counted_at: CUTOVER,
    counted_minor: COUNTED,
    note: 'Cutover count.',
    adjustment_transaction_id: null,
  };

  const september = (cutoverDate: string | null, rows: never[]) =>
    rollforward({
      rows,
      months: monthTotals(rows),
      accounts,
      checkpoints: [OPENING_CHECKPOINT, counted],
      movements: rows as unknown as MovementRow[],
      rate: null,
      cutoverDate,
    }).months.find((m) => m.key === '2026-09')!;

  const real = [txn(REFERENCE_ROW, 'other'), txn(GROCERIES_ROW, 'groceries')] as never[];
  const withFiction = [
    ...real,
    txn(
      {
        id: 'row-fiction',
        amount_minor: FICTION,
        occurred_at: atLocalNoon(CUTOVER),
        from_account_id: MAIN,
        to_account_id: null,
      },
      UNACCOUNTED_SLUG
    ),
  ] as never[];

  test('THE INCIDENT: what the panel actually showed', () => {
    const s = september(null, withFiction);
    assert.equal(s.openingMinor, AUG_CLOSING, 'opened from the reconstruction, not the drawer');
    assert.equal(s.spendMinor, FICTION + GROCERIES);
    assert.equal(s.closingMinor, COUNTED);
  });

  test('with the date set, September opens at the drawer', () => {
    assert.equal(september(CUTOVER, real).openingMinor, COUNTED);
  });

  test('the fiction is what made the month unreadable, and it is gone', () => {
    assert.ok(september(CUTOVER, real).spendMinor < GROCERIES + 1);
  });
});

/**
 * WIRING, read as text.
 *
 * There is no browser in this suite and there should not be one. What these
 * pin is structural: that every place a count can be started hands the write
 * path the stored cutover date, and that the preview asks the same question
 * the write will answer. A count entry point that quietly stopped passing it
 * would reproduce the incident exactly, and every behavioural test above would
 * still pass.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const HOOK = read('../../hooks/useAccounts.ts');
const DIALOG = read('../../components/finance/CountDialog.tsx');
const FINANCE = read('../../app/finance/page.tsx');
const CUTOVER_PAGE = read('../../app/finance/cutover/page.tsx');

describe('every count entry point carries the line', () => {
  test('the write path decides through planCount, not by hand', () => {
    assert.match(HOOK, /planCount\(\{/, 'recordCount no longer goes through planCount');
    assert.doesNotMatch(
      HOOK,
      /reconcileCount\(/,
      'the hook reimplements the decision, so a test of planCount no longer covers it'
    );
  });

  test('and hands it the stored date', () => {
    const body = HOOK.slice(HOOK.indexOf('const recordCount'), HOOK.indexOf('Remove a count'));
    assert.match(body, /cutoverDate: settings\.cutoverDate/);
    assert.match(body, /settings\.cutoverDate,\s*saveSettings\s*\]/, 'the callback does not re-run when it changes');
  });

  test('a line the count draws is PERSISTED, and before anything else is written', () => {
    const body = HOOK.slice(HOOK.indexOf('const recordCount'), HOOK.indexOf('Remove a count'));
    assert.match(body, /plan\.establishesLine/, 'the decided line is never written down');
    assert.match(
      body,
      /saveSettings\(\{ cutoverDate: plan\.establishesLine \}\)/,
      'the line is decided and then dropped, so the next count would draw another'
    );
    assert.ok(
      body.indexOf('plan.establishesLine') < body.indexOf(".from('transactions')"),
      'the ledger is written before the line, so a failed settings write leaves rows behind'
    );
    assert.match(body, /if \(lineErr\) return/, 'a failed line write does not stop the count');
  });

  test('the preview runs the same plan the write path runs', () => {
    assert.match(DIALOG, /planCount\(\{/, 'the preview no longer shares the write path');
    assert.doesNotMatch(DIALOG, /reconcileCount\(/, 'the preview reimplements the decision');
    const call = DIALOG.slice(DIALOG.indexOf('planCount({'));
    assert.match(call.slice(0, 300), /cutoverDate,/, 'the preview plans without the line');
  });

  test('and SAYS SO on screen before the line is drawn', () => {
    // The whole point. Implicit is fine; silent is what cost 3.5M.
    assert.match(DIALOG, /establishesLine/, 'the dialog cannot tell that it is drawing the line');
    assert.match(DIALOG, /No cutover is set yet/, 'nothing on screen announces it');
    const preview = DIALOG.slice(DIALOG.indexOf('function GapPreview'));
    assert.ok(
      preview.indexOf('if (establishesLine)') < preview.indexOf("result.kind === 'opening'"),
      'the ordinary branches are reached first, so drawing the line stays unannounced'
    );
  });

  test('both CountDialog call sites on /finance pass it', () => {
    const passes = FINANCE.split('<CountDialog').slice(1);
    assert.equal(passes.length, 2, '/finance no longer renders CountDialog twice');
    for (const [i, block] of passes.entries())
      assert.match(
        block.slice(0, 600),
        /cutoverDate=\{accounts\.settings\.cutoverDate\}/,
        `CountDialog #${i + 1} does not pass the cutover date`
      );
  });

  test('the wizard counts on the date it just saved', () => {
    assert.match(CUTOVER_PAGE, /saveSettings\(\{ cutoverDate: date \}\)/);
    const step2 = CUTOVER_PAGE.slice(CUTOVER_PAGE.indexOf('<CountThem'));
    assert.match(step2.slice(0, 600), /countedAt: date/, 'the wizard counts on some other day');
  });
});
