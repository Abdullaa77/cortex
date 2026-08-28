import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BENEFICIARIES,
  BENEFICIARY_LABEL,
  HOUSEHOLD,
  UNRECORDED,
  backfillBeneficiary,
  beneficiaryBreakdown,
  beneficiaryKeyOf,
  beneficiaryOf,
  clearsBeneficiary,
  floorSplit,
  isBeneficiary,
  takesBeneficiary,
  type BeneficiaryKey,
  type BeneficiaryRow,
} from './beneficiary.ts';
import { ACCOUNT_OWNERS } from './accounts.ts';
import { CORE_SLUGS, categoryBreakdown, monthTotals } from './summarize.ts';
import { isPreCutover, atLocalNoon } from './cutover.ts';
import { CATEGORY_BY_SLUG } from './categorize.ts';
import {
  BENEFICIARY_CORPUS,
  CAPTURE_ROWS,
  CORPUS_ROWS,
  CUTOVER_DATE,
  UNDEFINED_BENEFICIARY_ROWS,
} from './__fixtures__/corpus.ts';

const AUGUST = '2026-08';
const JULY = '2026-07';

const joined = (slug: string) => {
  const c = CATEGORY_BY_SLUG.get(slug)!;
  return { slug: c.slug, name: c.name, icon: c.icon, color: c.color, kind: c.kind };
};

let seq = 0;
function row(over: Partial<BeneficiaryRow> & { slug?: string } = {}): BeneficiaryRow {
  const { slug = 'groceries', ...rest } = over;
  return {
    id: `r-${seq++}`,
    reimburses_transaction_id: null,
    amount_minor: 100_00,
    direction: 'expense',
    occurred_at: atLocalNoon('2026-08-20'),
    date_precision: 'day',
    needs_review: false,
    beneficiary: null,
    finance_categories: joined(slug),
    ...rest,
  };
}

describe('the people are named once', () => {
  test('a beneficiary is an account owner, or the household', () => {
    assert.deepEqual([...BENEFICIARIES], [HOUSEHOLD, ...ACCOUNT_OWNERS]);
  });

  test('every value the column accepts has a label, and so does the absence', () => {
    const keys: BeneficiaryKey[] = [...BENEFICIARIES, UNRECORDED];
    for (const key of keys)
      assert.ok(BENEFICIARY_LABEL[key], `${key} has no label`);
  });

  test('the absence is labelled as an absence, not as a household', () => {
    assert.equal(BENEFICIARY_LABEL[UNRECORDED], 'not recorded');
  });

  test('nothing else is a beneficiary', () => {
    assert.equal(isBeneficiary('everyone'), false);
    assert.equal(isBeneficiary(null), false);
    assert.equal(isBeneficiary(undefined), false);
    assert.equal(isBeneficiary(''), false);
  });
});

describe('who has a beneficiary at all', () => {
  test('spending does', () => {
    assert.equal(takesBeneficiary(row()), true);
    // Including the uncategorised bucket — it counts as spend everywhere else,
    // and giving it no beneficiaries would make the groups stop adding up.
    assert.equal(takesBeneficiary(row({ finance_categories: null })), true);
  });

  test('income does not — money arriving has not been consumed by anyone', () => {
    assert.equal(takesBeneficiary(row({ slug: 'income', direction: 'income' })), false);
    // Direction alone is enough. "4,625,000 salary" is filed under Income and
    // carries direction 'expense' because the line had no leading plus; both
    // routes have to reach the same answer.
    assert.equal(takesBeneficiary(row({ slug: 'income' })), false);
    assert.equal(takesBeneficiary(row({ direction: 'income' })), false);
  });

  test('transfers do not — money moving between our own drawers is not consumed', () => {
    assert.equal(takesBeneficiary(row({ slug: 'transfer' })), false);
    assert.equal(takesBeneficiary(row({ slug: 'transfer', direction: 'income' })), false);
  });

  test('the unaccounted adjustment does not — a gap has no known consumer', () => {
    assert.equal(
      takesBeneficiary(row({ finance_categories: { ...joined('groceries'), slug: 'unaccounted' } })),
      false
    );
  });

  test('a value written to one of those does not survive the read path', () => {
    // Not hypothetical: the fixture sets these on purpose, so the assertion is
    // about the code refusing them rather than about nobody having tried.
    for (const r of UNDEFINED_BENEFICIARY_ROWS) {
      assert.notEqual(r.beneficiary, null, 'the fixture must actually set one');
      assert.equal(beneficiaryOf(r), null, `${r.id} kept a beneficiary it cannot have`);
      assert.equal(beneficiaryKeyOf(r), UNRECORDED);
    }
  });
});

describe('null is an absence, and reads as one', () => {
  test('a spend row with no beneficiary is unrecorded, not household', () => {
    const r = row({ beneficiary: null });
    assert.equal(beneficiaryOf(r), null);
    assert.notEqual(beneficiaryOf(r), HOUSEHOLD);
    assert.equal(beneficiaryKeyOf(r), UNRECORDED);
  });

  test('a row that never had the column is the same as one holding null', () => {
    const bare = row();
    delete (bare as { beneficiary?: unknown }).beneficiary;
    assert.equal(beneficiaryOf(bare), null);
  });

  test('a junk value is an absence too, never a silent pass-through', () => {
    assert.equal(beneficiaryOf(row({ beneficiary: 'everyone' as never })), null);
  });

  test('every one of the 153 imported rows is unrecorded', () => {
    for (const r of CORPUS_ROWS)
      assert.equal(beneficiaryOf(r as BeneficiaryRow), null, `${r.id} claimed a consumer`);
  });
});

describe('the groups add up to the whole', () => {
  for (const key of [JULY, AUGUST]) {
    test(`${key}: the beneficiary groups sum to that month's spend`, () => {
      const groups = beneficiaryBreakdown(BENEFICIARY_CORPUS, key);
      const summed = groups.reduce((n, g) => n + g.minor, 0);
      const month = monthTotals(BENEFICIARY_CORPUS).find((m) => m.key === key)!;
      assert.equal(summed, month.spendMinor);
    });

    test(`${key}: and to the category breakdown, which is the same money`, () => {
      const groups = beneficiaryBreakdown(BENEFICIARY_CORPUS, key);
      const byCategory = categoryBreakdown(BENEFICIARY_CORPUS, key).reduce(
        (n, s) => n + s.minor,
        0
      );
      assert.equal(
        groups.reduce((n, g) => n + g.minor, 0),
        byCategory,
        'a row is in one grouping and not the other'
      );
    });

    test(`${key}: the shares sum to one, or to zero in an empty month`, () => {
      const groups = beneficiaryBreakdown(BENEFICIARY_CORPUS, key);
      const total = groups.reduce((n, g) => n + g.minor, 0);
      const shares = groups.reduce((n, g) => n + g.share, 0);
      assert.ok(Math.abs(shares - (total > 0 ? 1 : 0)) < 1e-9);
    });
  }

  test('the unrecorded group is in the denominator, not outside it', () => {
    const groups = beneficiaryBreakdown(BENEFICIARY_CORPUS, AUGUST);
    const unrecorded = groups.find((g) => g.key === UNRECORDED)!;
    assert.ok(unrecorded.minor > 0, 'August must have unrecorded spend to test this');
    assert.ok(unrecorded.share > 0);
    // If it were dropped from the denominator, every other share would be
    // larger than the money justifies.
    const household = groups.find((g) => g.key === HOUSEHOLD)!;
    const total = groups.reduce((n, g) => n + g.minor, 0);
    assert.equal(household.share, household.minor / total);
  });

  test('every group is returned even when empty, in a fixed order', () => {
    const groups = beneficiaryBreakdown(BENEFICIARY_CORPUS, JULY);
    assert.deepEqual(
      groups.map((g) => g.key),
      [HOUSEHOLD, ...ACCOUNT_OWNERS, UNRECORDED]
    );
    // July is entirely imported rows, so nothing is attributed to anyone.
    for (const g of groups)
      if (g.key !== UNRECORDED) assert.equal(g.minor, 0, `${g.key} claimed July spend`);
  });

  test('the adjustment lands in the unrecorded group, keeping the sum whole', () => {
    const withAdjustment = beneficiaryBreakdown(BENEFICIARY_CORPUS, AUGUST);
    const without = beneficiaryBreakdown(
      BENEFICIARY_CORPUS.filter((r) => r.id !== 'capture-adjustment'),
      AUGUST
    );
    const gap =
      withAdjustment.find((g) => g.key === UNRECORDED)!.minor -
      without.find((g) => g.key === UNRECORDED)!.minor;
    assert.equal(gap, 250_000_00);
    // And it went nowhere near a person.
    for (const p of ACCOUNT_OWNERS)
      assert.equal(
        withAdjustment.find((g) => g.key === p)!.minor,
        without.find((g) => g.key === p)!.minor,
        `the adjustment moved ${p}`
      );
  });

  test('a repaid expense contributes its remainder here too', () => {
    const expense = row({ id: 'exp', amount_minor: 166_100_00, beneficiary: HOUSEHOLD });
    const back = row({
      id: 'back',
      amount_minor: 113_000_00,
      direction: 'income',
      slug: 'transfer',
      reimburses_transaction_id: 'exp',
    });
    const groups = beneficiaryBreakdown([expense, back], AUGUST);
    assert.equal(groups.find((g) => g.key === HOUSEHOLD)!.minor, 53_100_00);
    assert.equal(
      groups.reduce((n, g) => n + g.minor, 0),
      53_100_00,
      'the repayment must not appear as spending of its own'
    );
  });
});

describe('the floor, split by who it was for', () => {
  test('the parts add to the whole, exactly', () => {
    for (const key of [JULY, AUGUST]) {
      const s = floorSplit(BENEFICIARY_CORPUS, key);
      assert.equal(
        s.householdMinor + s.personalMinor + s.unrecordedMinor,
        s.coreMinor,
        `${key}: the floor split does not add up`
      );
    }
  });

  test('the floor it splits is the floor monthTotals reports', () => {
    for (const month of monthTotals(BENEFICIARY_CORPUS)) {
      assert.equal(
        floorSplit(BENEFICIARY_CORPUS, month.key).coreMinor,
        month.coreMinor,
        `${month.key}: a second everyday floor appeared`
      );
    }
  });

  test('the per-person figures sum to the personal total', () => {
    const s = floorSplit(BENEFICIARY_CORPUS, AUGUST);
    assert.equal(
      s.byPerson.reduce((n, p) => n + p.minor, 0),
      s.personalMinor
    );
  });

  test('August has all three parts — shared, personal, and unrecorded', () => {
    // A fixture where any part was zero would let a view that folded people
    // into the household, or dropped the unrecorded rows, pass everything.
    const s = floorSplit(BENEFICIARY_CORPUS, AUGUST);
    assert.ok(s.householdMinor > 0);
    assert.ok(s.personalMinor > 0);
    assert.ok(s.unrecordedMinor > 0);
  });

  test('July is entirely unrecorded — nothing about it was ever checked', () => {
    const s = floorSplit(BENEFICIARY_CORPUS, JULY);
    assert.equal(s.householdMinor, 0);
    assert.equal(s.personalMinor, 0);
    assert.equal(s.unrecordedMinor, s.coreMinor);
  });

  test('only the everyday categories are in it', () => {
    // The 320,000 coat is sister's and is not part of the floor. A split that
    // swept every personal expense in would make the one figure Scott steers
    // by jump whenever somebody bought a coat.
    const s = floorSplit(BENEFICIARY_CORPUS, AUGUST);
    const coat = CAPTURE_ROWS.find((r) => r.finance_categories?.slug === 'clothing')!;
    assert.ok(!(CORE_SLUGS as readonly string[]).includes('clothing'));
    assert.ok(s.coreMinor > 0);
    assert.equal(
      s.byPerson.find((p) => p.key === 'sister')!.minor,
      CAPTURE_ROWS.filter(
        (r) =>
          r.beneficiary === 'sister' &&
          (CORE_SLUGS as readonly string[]).includes(r.finance_categories!.slug)
      ).reduce((n, r) => n + r.amount_minor, 0)
    );
    assert.ok(coat.amount_minor > 0);
  });

  test('every person is listed, including the ones who cost nothing', () => {
    const s = floorSplit(BENEFICIARY_CORPUS, JULY);
    assert.deepEqual(
      s.byPerson.map((p) => p.key),
      [...ACCOUNT_OWNERS]
    );
  });
});

describe('a recategorisation says what it dropped', () => {
  test('turning spending into income reports the beneficiary it clears', () => {
    const r = row({ beneficiary: HOUSEHOLD });
    assert.equal(clearsBeneficiary(r, joined('income')), HOUSEHOLD);
  });

  test('so do transfers and the adjustment', () => {
    const r = row({ beneficiary: 'mom' });
    assert.equal(clearsBeneficiary(r, joined('transfer')), 'mom');
    assert.equal(
      clearsBeneficiary(r, { ...joined('groceries'), slug: 'unaccounted' }),
      'mom'
    );
  });

  test('moving between two spend categories drops nothing', () => {
    const r = row({ beneficiary: HOUSEHOLD });
    assert.equal(clearsBeneficiary(r, joined('transport')), null);
    // Including into the uncategorised bucket, which still counts as spend.
    assert.equal(clearsBeneficiary(r, null), null);
  });

  test('a row with nothing to lose reports nothing', () => {
    // Silence has to mean "nothing was dropped", or the notice fires on edits
    // that took nothing away and stops being read.
    assert.equal(clearsBeneficiary(row({ beneficiary: null }), joined('income')), null);
    assert.equal(
      clearsBeneficiary(row({ slug: 'income', beneficiary: HOUSEHOLD }), joined('groceries')),
      null
    );
  });
});

describe('the backfill writes household only where somebody was present', () => {
  const at = (day: string) => atLocalNoon(day);
  const decide = (r: BeneficiaryRow) =>
    backfillBeneficiary(r, CUTOVER_DATE, isPreCutover(r, CUTOVER_DATE));

  test('a live capture after the cutover gets the default', () => {
    assert.equal(decide(row({ occurred_at: at('2026-08-20') })), HOUSEHOLD);
  });

  test('the cutover day itself is on the truth side', () => {
    assert.equal(decide(row({ occurred_at: at(CUTOVER_DATE) })), HOUSEHOLD);
  });

  test('a row before the cutover stays unrecorded', () => {
    assert.equal(decide(row({ occurred_at: at('2026-08-14') })), null);
  });

  test('a reconstructed row stays unrecorded whatever its date', () => {
    // date_precision 'month' means no day was ever written down, and for the
    // same reason no consumer was.
    assert.equal(
      decide(row({ occurred_at: at('2026-08-20'), date_precision: 'month' })),
      null
    );
  });

  test('with no cutover set, nothing is backfilled at all', () => {
    // isPreCutover is false for everything when there is no line, so without
    // this guard the absence of a cutover would backfill the entire history.
    const r = row({ occurred_at: at('2026-08-20') });
    assert.equal(backfillBeneficiary(r, null, isPreCutover(r, null)), null);
  });

  test('rows with no beneficiary by definition are untouched', () => {
    for (const slug of ['income', 'transfer'])
      assert.equal(decide(row({ slug, occurred_at: at('2026-08-20') })), null);
    assert.equal(
      decide(
        row({
          occurred_at: at('2026-08-20'),
          finance_categories: { ...joined('groceries'), slug: 'unaccounted' },
        })
      ),
      null
    );
  });

  test('not one of the 153 imported rows would be backfilled', () => {
    // The property the whole stage turns on, run against the real corpus
    // rather than against an example.
    const backfilled = CORPUS_ROWS.filter(
      (r) => decide(r as BeneficiaryRow) !== null
    );
    assert.equal(backfilled.length, 0);
  });
});

describe('funding and consumption stay separate', () => {
  test('a beneficiary is not read off the account that paid', () => {
    // Mom's cash buying groceries the household eats: owner mom, beneficiary
    // household. Nothing here may reach for the account's owner, so a row with
    // a beneficiary set and no account at all still answers correctly.
    const r = row({ beneficiary: HOUSEHOLD });
    assert.equal(beneficiaryOf(r), HOUSEHOLD);
    assert.equal('from_account_id' in r, false);
  });

  test('and one person funding everything does not make them the consumer', () => {
    const groups = beneficiaryBreakdown(BENEFICIARY_CORPUS, AUGUST);
    const me = groups.find((g) => g.key === 'me')!;
    const household = groups.find((g) => g.key === HOUSEHOLD)!;
    // Every capture is funded from Scott's Main account in this fixture, and
    // most of them are the household's. If funding were being read as
    // consumption, 'me' would hold all of it.
    assert.ok(household.minor > me.minor);
  });
});

describe('nothing that existed before this moved', () => {
  test('the category totals are identical with and without beneficiaries', () => {
    // Same rows, one set carrying beneficiaries and one not. Beneficiary is a
    // new axis over the same money; if it leaked into a category total the two
    // would part.
    const stripped = BENEFICIARY_CORPUS.map((r) => ({ ...r, beneficiary: null }));
    for (const key of [JULY, AUGUST]) {
      assert.deepEqual(
        categoryBreakdown(BENEFICIARY_CORPUS, key).map((s) => [s.slug, s.minor]),
        categoryBreakdown(stripped, key).map((s) => [s.slug, s.minor])
      );
    }
  });

  test('and so are the month totals, the floor included', () => {
    const stripped = BENEFICIARY_CORPUS.map((r) => ({ ...r, beneficiary: null }));
    assert.deepEqual(monthTotals(BENEFICIARY_CORPUS), monthTotals(stripped));
  });
});
