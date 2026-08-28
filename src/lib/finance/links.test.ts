import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImport } from './import.ts';
import { CATEGORY_BY_SLUG } from './categorize.ts';
import { formatMinor } from './parse.ts';
import { monthTotals, categoryBreakdown, type TransactionRow } from './summarize.ts';
import { reconcile, netChangeMinor } from './reconcile.ts';
import { drilldownRows, sumMinor, type TransactionRecord } from './transactions.ts';
import {
  reimbursementsByTarget,
  effectiveMinor,
  reimbursedMinor,
  isReimbursement,
  canLink,
  linkCandidates,
} from './links.ts';

/**
 * The case this exists for, with Scott's real numbers:
 *
 *   -166,100  lunch
 *   +113,000  two people paid him back
 *
 * The lunch cost 53,100.
 */
const JULY = new Date(2026, 6, 12, 13, 0, 0).toISOString();
const JULY_LATER = new Date(2026, 6, 12, 13, 30, 0).toISOString();
const AUGUST = new Date(2026, 7, 3, 13, 0, 0).toISOString();

const eatingOut = CATEGORY_BY_SLUG.get('eating-out')!;
const transfer = CATEGORY_BY_SLUG.get('transfer')!;

const joined = (c: typeof eatingOut) => ({
  slug: c.slug,
  name: c.name,
  icon: c.icon,
  color: c.color,
  kind: c.kind,
});

function record(over: Partial<TransactionRecord> & { id: string }): TransactionRecord {
  return {
    amount_minor: 0,
    currency: 'UZS',
    direction: 'expense',
    comment: '',
    raw_input: '',
    category_id: null,
    category_source: 'inferred',
    needs_review: false,
    parse_flags: [],
    occurred_at: JULY,
    date_precision: 'day',
    reimburses_transaction_id: null,
    transfer_pair_id: null,
    // Unassigned by default: linking is decided by amount, direction and time,
    // never by which account the money touched.
    from_account_id: null,
    to_account_id: null,
    finance_categories: joined(eatingOut),
    ...over,
  };
}

const lunch = record({
  id: 'lunch',
  amount_minor: 166_100_00,
  direction: 'expense',
  comment: 'lunch',
});

const paidBack = record({
  id: 'paid-back',
  amount_minor: 113_000_00,
  direction: 'income',
  comment: 'two people paid me back',
  occurred_at: JULY_LATER,
  finance_categories: joined(transfer),
  reimburses_transaction_id: 'lunch',
});

const unlinked = { ...paidBack, reimburses_transaction_id: null };

describe('the lunch case', () => {
  const linked = [lunch, paidBack];
  const reimbursed = reimbursementsByTarget(linked);

  test('the lunch counts its net, not what left the wallet', () => {
    assert.equal(formatMinor(effectiveMinor(lunch, reimbursed)), '53,100');
    assert.equal(formatMinor(reimbursedMinor(lunch, reimbursed)), '113,000');
  });

  test('the repayment counts nothing — it is already inside the net', () => {
    assert.equal(effectiveMinor(paidBack, reimbursed), 0);
    assert.equal(isReimbursement(paidBack, reimbursed), true);
    assert.equal(isReimbursement(lunch, reimbursed), false);
  });

  test('neither amount is rewritten — the link is the truth, not an edit', () => {
    assert.equal(lunch.amount_minor, 166_100_00);
    assert.equal(paidBack.amount_minor, 113_000_00);
  });

  test('the category total is the net', () => {
    const slice = categoryBreakdown(linked, '2026-07').find((s) => s.slug === 'eating-out');
    assert.equal(formatMinor(slice!.minor), '53,100');
  });

  test('unlinking restores both figures untouched', () => {
    const apart = [lunch, unlinked];
    const none = reimbursementsByTarget(apart);
    assert.equal(effectiveMinor(lunch, none), 166_100_00);
    assert.equal(effectiveMinor(unlinked, none), 113_000_00);

    const slice = categoryBreakdown(apart, '2026-07').find((s) => s.slug === 'eating-out');
    assert.equal(formatMinor(slice!.minor), '166,100');
  });
});

describe('linking never moves the closing balance', () => {
  /**
   * The property everything else rests on. Netting takes 113,000 out of
   * spending and the same 113,000 out of money-in, so the month's net change
   * is identical either way. If this ever fails, linking has started inventing
   * or destroying money and no total on the page can be trusted.
   */
  test('the month net is the same linked and unlinked', () => {
    const [before] = monthTotals([lunch, unlinked]);
    const [after] = monthTotals([lunch, paidBack]);

    assert.equal(netChangeMinor(before), netChangeMinor(after));
    assert.equal(formatMinor(Math.abs(netChangeMinor(after))), '53,100');
  });

  test('spend and moved-in each drop by exactly the repayment', () => {
    const [before] = monthTotals([lunch, unlinked]);
    const [after] = monthTotals([lunch, paidBack]);

    assert.equal(before.spendMinor - after.spendMinor, 113_000_00);
    assert.equal(before.transferInMinor - after.transferInMinor, 113_000_00);
    assert.equal(after.transferInMinor, 0);
  });

  test('closing balances are untouched', () => {
    const opening = { amountMinor: 5_000_000 * 100, asOf: '2026-07-01' };
    const before = reconcile(monthTotals([lunch, unlinked]), opening);
    const after = reconcile(monthTotals([lunch, paidBack]), opening);

    assert.equal(before.closingMinor, after.closingMinor);
    assert.deepEqual(
      before.months.map((m) => m.closingMinor),
      after.months.map((m) => m.closingMinor)
    );
  });

  test('the entry count is unchanged — both rows stay visible', () => {
    const [before] = monthTotals([lunch, unlinked]);
    const [after] = monthTotals([lunch, paidBack]);
    assert.equal(before.txnCount, after.txnCount);
    assert.equal(after.txnCount, 2);
  });
});

describe('the drill-down still adds up', () => {
  const linked = [lunch, paidBack];

  test('it lists both rows and totals the net', () => {
    const behind = drilldownRows(linked, '2026-07', 'eating-out');
    assert.equal(behind.length, 2, 'the repayment must be visible beside the expense');
    assert.ok(behind.some((r) => r.id === 'lunch'));
    assert.ok(behind.some((r) => r.id === 'paid-back'));

    const slice = categoryBreakdown(linked, '2026-07').find((s) => s.slug === 'eating-out');
    assert.equal(sumMinor(behind), slice!.minor);
    assert.equal(formatMinor(sumMinor(behind)), '53,100');
  });

  test('a fully repaid expense leaves the breakdown rather than showing zero', () => {
    const full = { ...paidBack, amount_minor: lunch.amount_minor };
    const slices = categoryBreakdown([lunch, full], '2026-07');
    assert.equal(slices.find((s) => s.slug === 'eating-out'), undefined);
  });
});

describe('canLink refuses what it cannot stand behind', () => {
  const rows = [lunch, unlinked];

  test('accepts the real pair', () => {
    assert.equal(canLink(unlinked, lunch, rows).ok, true);
  });

  test('a row cannot repay itself', () => {
    assert.match(canLink(lunch, lunch, rows).reason, /itself/);
  });

  test('an expense cannot repay an expense', () => {
    const other = record({ id: 'other', amount_minor: 500_00, direction: 'expense' });
    assert.match(canLink(other, lunch, [...rows, other]).reason, /money coming in/i);
  });

  test('a repayment cannot be attached to income', () => {
    const wage = record({ id: 'wage', amount_minor: 900_000_00, direction: 'income' });
    assert.match(canLink(unlinked, wage, [...rows, wage]).reason, /expense/i);
  });

  test('a repayment cannot be attached to another repayment', () => {
    // paidBack is income, so the direction check catches it first — which is
    // the right refusal for the right reason.
    const second = record({ id: 'second', amount_minor: 10_00, direction: 'income' });
    assert.equal(canLink(second, paidBack, [lunch, paidBack, second]).ok, false);
    assert.match(
      canLink(second, paidBack, [lunch, paidBack, second]).reason,
      /expense/i
    );
  });

  test('an expense carrying a stray link is not a valid target either', () => {
    // Unreachable through the UI — only income rows can be linked — so this
    // guards hand-written or migrated data rather than a path a user takes.
    const odd = record({
      id: 'odd',
      amount_minor: 200_000_00,
      direction: 'expense',
      reimburses_transaction_id: 'lunch',
    });
    assert.match(
      canLink(unlinked, odd, [lunch, unlinked, odd]).reason,
      /itself a repayment/
    );
  });

  test('more than the expense is refused', () => {
    const toobig = { ...unlinked, id: 'toobig', amount_minor: 200_000_00 };
    assert.match(canLink(toobig, lunch, [lunch, toobig]).reason, /more than the expense/);
  });

  test('exactly the expense is allowed — a full refund is real', () => {
    const exact = { ...unlinked, id: 'exact', amount_minor: lunch.amount_minor };
    assert.equal(canLink(exact, lunch, [lunch, exact]).ok, true);
  });

  test('a second repayment is measured against what is already attached', () => {
    // 113,000 is already on the lunch. 53,100 more exactly finishes it.
    const rest = record({
      id: 'rest',
      amount_minor: 53_100_00,
      direction: 'income',
      occurred_at: JULY_LATER,
    });
    const withBoth = [lunch, paidBack, rest];
    assert.equal(canLink(rest, lunch, withBoth).ok, true);

    const oneTooMany = { ...rest, amount_minor: 53_101_00 };
    assert.match(
      canLink(oneTooMany, lunch, [lunch, paidBack, oneTooMany]).reason,
      /more than the expense/
    );
  });

  test('re-linking a row already attached does not count it against itself', () => {
    const otherLunch = record({
      id: 'other-lunch',
      amount_minor: 120_000_00,
      direction: 'expense',
    });
    // paidBack is on `lunch`; moving it to otherLunch must not see itself.
    assert.equal(canLink(paidBack, otherLunch, [lunch, paidBack, otherLunch]).ok, true);
  });

  test('across months is refused, and says why', () => {
    const later = { ...unlinked, id: 'later', occurred_at: AUGUST };
    const check = canLink(later, lunch, [lunch, later]);
    assert.equal(check.ok, false);
    assert.match(check.reason, /same month/);
    assert.match(check.reason, /closing balances/);
  });
});

describe('linkCandidates only offers what canLink accepts', () => {
  const wage = record({ id: 'wage', amount_minor: 900_000_00, direction: 'income' });
  const small = record({ id: 'small', amount_minor: 5_000_00, direction: 'expense' });
  const august = record({ id: 'august', amount_minor: 900_000_00, occurred_at: AUGUST });
  const all = [lunch, unlinked, wage, small, august];

  test('expenses in the same month, big enough, newest first', () => {
    const offered = linkCandidates(unlinked, all);
    assert.deepEqual(offered.map((r) => r.id), ['lunch']);
  });

  test('every offer would actually be accepted', () => {
    for (const candidate of linkCandidates(unlinked, all))
      assert.equal(canLink(unlinked, candidate, all).ok, true);
  });

  test('nothing is offered when nothing fits', () => {
    assert.deepEqual(linkCandidates(wage, all), []);
  });
});

describe('dangling and multiple links', () => {
  test('a pointer to a row that is not here is ignored, not subtracted', () => {
    const orphan = { ...paidBack, reimburses_transaction_id: 'deleted-row' };
    const reimbursed = reimbursementsByTarget([orphan]);
    assert.equal(isReimbursement(orphan, reimbursed), false);
    // It stands on its own rather than vanishing.
    assert.equal(effectiveMinor(orphan, reimbursed), 113_000_00);
  });

  test('two people paying separately both count against the one lunch', () => {
    const a = record({ id: 'a', amount_minor: 60_000_00, direction: 'income', reimburses_transaction_id: 'lunch' });
    const b = record({ id: 'b', amount_minor: 53_000_00, direction: 'income', reimburses_transaction_id: 'lunch' });
    const reimbursed = reimbursementsByTarget([lunch, a, b]);

    assert.equal(reimbursedMinor(lunch, reimbursed), 113_000_00);
    assert.equal(formatMinor(effectiveMinor(lunch, reimbursed)), '53,100');
    assert.equal(effectiveMinor(a, reimbursed), 0);
    assert.equal(effectiveMinor(b, reimbursed), 0);
  });

  test('over-repayment in stored data clamps at zero rather than reading as income', () => {
    const toobig = { ...paidBack, amount_minor: 500_000_00 };
    const reimbursed = reimbursementsByTarget([lunch, toobig]);
    assert.equal(effectiveMinor(lunch, reimbursed), 0);
  });
});

describe('the real corpus is untouched by all of this', () => {
  const NOTES = readFileSync(
    new URL('./__fixtures__/notes.sample.txt', import.meta.url),
    'utf8'
  );
  const imported = buildImport(NOTES, 2026);
  const rows: TransactionRow[] = imported.rows.map((r, i) => {
    const cat = r.categorySlug ? CATEGORY_BY_SLUG.get(r.categorySlug) : undefined;
    return {
      id: `row-${i}`,
      reimburses_transaction_id: null,
      amount_minor: r.amountMinor,
      direction: r.direction,
      occurred_at: r.occurredAt,
      date_precision: r.datePrecision,
      needs_review: r.needsReview,
      finance_categories: cat ? joined(cat) : null,
    };
  });

  test('with no links, every total is exactly what it was before', () => {
    const [july, august] = monthTotals(rows);
    assert.equal(formatMinor(july.spendMinor), '3,451,961.38');
    assert.equal(formatMinor(august.spendMinor), '5,996,954.15');
    assert.equal(formatMinor(july.incomeMinor), '2,427,911.64');
    assert.equal(formatMinor(Math.abs(netChangeMinor(july))), '6,256,049.74');
  });
});
