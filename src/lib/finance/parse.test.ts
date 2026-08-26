import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLine, parseNotes, formatMinor, toMinorUnits } from './parse.ts';
import { categorize } from './categorize.ts';

/**
 * The fixture is two months of Scott's real capture notes with proper names
 * replaced by consistent PersonA..PersonK tokens and everything else left
 * byte-identical. Relationship words (mom, sister, aunt, father's grave) are
 * kept deliberately — they are not names, and they are exactly the context
 * words the precedence rule has to lose to.
 */
const NOTES = readFileSync(
  new URL('./__fixtures__/notes.sample.txt', import.meta.url),
  'utf8'
);
const results = parseNotes(NOTES);

const findLine = (needle: string) => {
  const hit = results.find((r) => r.raw.includes(needle));
  assert.ok(hit, `fixture is missing a line containing "${needle}"`);
  return hit;
};

describe('corpus', () => {
  test('every line parses without throwing, and the counts are pinned', () => {
    assert.equal(results.length, 154);
    assert.equal(results.filter((r) => r.ok).length, 131);
    assert.equal(results.filter((r) => !r.ok).length, 23);
    assert.equal(
      results.reduce((n, r) => n + r.transactions.length, 0),
      153
    );
  });

  test('no amount is absurd — nothing above 10M so\'m slipped through', () => {
    for (const r of results)
      for (const t of r.transactions)
        assert.ok(
          t.amountMinor <= 10_000_000 * 100,
          `${formatMinor(t.amountMinor)} from "${r.raw}" is out of range`
        );
  });
});

describe('the 1000x bugs — a scale suffix must not eat the next word', () => {
  // These four parsed as 87,549k / 35,057k / 74,984k / 10,200m before the fix.
  // Nothing about them looks wrong in a diff, which is why they are pinned.
  const cases: [string, number][] = [
    ['87,549 korzinka grocery', 87_549],
    ['35,057 korzinka', 35_057],
    ['74,984 korzinka', 74_984],
    ['10,200 metro + bus', 10_200],
  ];

  for (const [needle, expected] of cases)
    test(`"${needle}" -> ${expected.toLocaleString('en-US')}`, () => {
      const r = findLine(needle);
      assert.equal(r.transactions[0].amountMinor, expected * 100);
    });

  test('a real suffix still applies when a non-letter follows it', () => {
    assert.equal(parseLine('8k banana').transactions[0].amountMinor, 8_000 * 100);
    assert.equal(parseLine('75 k JK').transactions[0].amountMinor, 75_000 * 100);
    assert.equal(parseLine('8.5k bus+metro').transactions[0].amountMinor, 8_500 * 100);
    assert.equal(parseLine('-2m rent').transactions[0].amountMinor, 2_000_000 * 100);
  });
});

describe('amount grammar', () => {
  test('comma groups thousands, dot is tiyin', () => {
    assert.deepEqual(toMinorUnits('10,120'), { minor: 1_012_000, commaDecimal: false });
    assert.deepEqual(toMinorUnits('10,120.29'), { minor: 1_012_029, commaDecimal: false });
    assert.deepEqual(toMinorUnits('10', 'k'), { minor: 1_000_000, commaDecimal: false });
  });

  test('every distinct shape in the corpus, by example', () => {
    const expect: [string, number][] = [
      ['8k banana', 8_000],
      ['87,549 korzinka', 87_549],
      ['3043 banana', 3_043],
      ['4,850,000 transferred', 4_850_000],
      ['41,948.5 grocery', 41_948.5],
      ['8.5k bus+metro', 8_500],
      ['75 k JK', 75_000],
    ];
    for (const [line, major] of expect)
      assert.equal(
        parseLine(line).transactions[0].amountMinor,
        Math.round(major * 100),
        line
      );
  });

  test('scaling stays exact — no float dust', () => {
    assert.equal(parseLine('8.5k x').transactions[0].amountMinor, 850_000);
    assert.equal(parseLine('41,948.5 x').transactions[0].amountMinor, 4_194_850);
  });

  test('a comma used as a decimal is flagged, never silently normalised', () => {
    const r = findLine('+4406,44');
    assert.equal(r.transactions[0].amountMinor, 440_644);
    assert.ok(r.flags.some((f) => f.code === 'AMBIGUOUS_DECIMAL_COMMA'));
    assert.equal(r.ok, false);
    // and its sibling parses under the normal rule
    assert.equal(findLine('+3,505.2').transactions[0].amountMinor, 350_520);
  });
});

describe('sign rule — mechanical, never inferred from wording', () => {
  test("leading + is income, anything else is an expense", () => {
    assert.equal(parseLine('+150k got debt PersonA').transactions[0].direction, 'income');
    assert.equal(parseLine('-150k debt PersonA').transactions[0].direction, 'expense');
    assert.equal(parseLine('8k banana').transactions[0].direction, 'expense');
    assert.equal(parseLine('+ 2,420,000 balance of salary').transactions[0].direction, 'income');
  });

  test('the two lines where sign and semantics disagree are flagged, not fixed', () => {
    const salary = findLine('4,625,000 salary (July)');
    assert.equal(salary.transactions[0].direction, 'expense');
    assert.ok(salary.flags.some((f) => f.code === 'UNSIGNED_INCOME_SUSPECT'));
    assert.equal(salary.ok, false);

    const shaxriyor = findLine('sent to PersonF, he sent back');
    assert.ok(shaxriyor.flags.some((f) => f.code === 'UNSIGNED_INCOME_SUSPECT'));

    const contradictions = results.filter((r) =>
      r.flags.some(
        (f) =>
          f.code === 'UNSIGNED_INCOME_SUSPECT' || f.code === 'SIGN_CONTRADICTS_WORDING'
      )
    );
    assert.equal(contradictions.length, 2);
  });
});

describe('interior +', () => {
  test('splits only when a number follows it', () => {
    const split = findLine('13,713(potato and 2 bread) + 38,500(taxi) ehson');
    assert.equal(split.transactions.length, 2);
    assert.equal(split.transactions[0].amountMinor, 13_713 * 100);
    assert.equal(split.transactions[1].amountMinor, 38_500 * 100);
    assert.ok(split.flags.some((f) => f.code === 'INTERIOR_PLUS_SPLIT'));
  });

  test('joins two purposes into one transaction otherwise', () => {
    for (const needle of [
      '75 k JK + comunnal',
      '11,900 bus+ metro',
      '149,600 (osh+ somsa',
      '10,200 metro + bus',
      '10,200 bus + metro',
      '8.5k bus+metro',
      '10,200 bus+metro',
    ]) {
      const r = findLine(needle);
      assert.equal(r.transactions.length, 1, needle);
      assert.ok(r.flags.some((f) => f.code === 'INTERIOR_PLUS_JOINED'), needle);
    }
  });

  test('exactly one line in the corpus splits', () => {
    assert.equal(
      results.filter((r) => r.flags.some((f) => f.code === 'INTERIOR_PLUS_SPLIT')).length,
      1
    );
  });
});

describe('comments carry prose, not extra transactions', () => {
  test('only the leading number is the amount', () => {
    const r = findLine('42k(with 105 sum CF)');
    assert.equal(r.transactions.length, 1);
    assert.equal(r.transactions[0].amountMinor, 42_000 * 100);
    assert.deepEqual(r.extraNumbers, ['105', '45', '5', '40']);
  });

  test('a $ figure is a reference, never a currency', () => {
    for (const needle of ['transferred to mom for 400$', 'Anthropic API $10']) {
      const r = findLine(needle);
      assert.ok(r.flags.some((f) => f.code === 'USD_REFERENCE'), needle);
    }
    assert.equal(
      results.filter((r) => r.flags.some((f) => f.code === 'USD_REFERENCE')).length,
      3
    );
  });

  test('a bare amount under 1000 with no suffix is flagged, not assumed', () => {
    const r = findLine('+35 got cash from PersonD');
    assert.equal(r.transactions[0].amountMinor, 35 * 100);
    assert.ok(r.flags.some((f) => f.code === 'BARE_SMALL_AMOUNT'));
    // but a bare amount >= 1000 is ordinary
    assert.equal(findLine('3043 banana').ok, true);
  });
});

describe('category precedence — type beats context, unconditionally', () => {
  test('a taxi to a mosque is transport, not charity', () => {
    assert.equal(categorize('taxi to Masjid for Juma').slug, 'transport');
    assert.equal(categorize('taxi to Masjid for Juma').via, 'type');
  });

  test('context still classifies when no type word is present', () => {
    const g = categorize("to father's grave");
    assert.equal(g.slug, 'ehsan');
    assert.equal(g.via, 'context');
  });

  test('a beneficiary never becomes a category', () => {
    assert.equal(categorize("for me and mom's phone plan").slug, 'phone-internet');
    assert.equal(categorize('pol pola herbal tea from pharmacy for mom').slug, 'health');
    assert.equal(categorize('Gano tea for mom').slug, 'health');
    assert.equal(categorize('to sister p#').slug, 'phone-internet');
  });

  test('"to office" stays ambiguous, which is correct', () => {
    assert.equal(categorize('to office').slug, null);
    assert.equal(categorize('to office').via, 'none');
  });

  test('purpose beats commodity', () => {
    assert.equal(categorize('banana and yogurt for ehsan').slug, 'ehsan');
    assert.equal(categorize('korzinka(g yogurt n banana)').slug, 'groceries');
  });

  test('a hand correction always wins', () => {
    const learned = new Map([['to office', 'transport']]);
    const g = categorize('to office', learned);
    assert.equal(g.slug, 'transport');
    assert.equal(g.via, 'learned');
  });

  test('the corpus leaves exactly these eight undecidable, and no others', () => {
    // Pinned as an exact set rather than a threshold: adding vocabulary should
    // shrink this list visibly, and nothing should ever fall into it silently.
    // Every one of these is genuinely undecidable from the text alone —
    // "cash" is the unnamed return leg of a transfer, the two "to office"
    // lines could be a fare or a handover, and "opa gave" is only income
    // because of its sign, which the comment cannot see.
    const uncategorised = results
      .flatMap((r) => r.transactions)
      .filter((t) => categorize(t.comment).slug === null)
      .map((t) => t.comment);

    assert.deepEqual(uncategorised.sort(), [
      '',
      'PersonH opa gave',
      'cash',
      'cash curtain thing',
      'cash for WC',
      'cash gave to PersonI aka',
      'to office',
      'to office',
    ]);
  });

  test('everything else in the corpus lands somewhere', () => {
    const all = results.flatMap((r) => r.transactions);
    const placed = all.filter((t) => categorize(t.comment).slug !== null);
    assert.equal(all.length, 153);
    assert.equal(placed.length, 145);
  });
});

describe('non-lines', () => {
  test('section headers and blanks produce no transaction', () => {
    for (const header of ['JULY', 'AUGUST:']) {
      const r = findLine(header);
      assert.equal(r.transactions.length, 0);
      assert.ok(r.flags.some((f) => f.code === 'NO_AMOUNT'));
    }
  });

  test('an amount with no description is flagged', () => {
    const r = findLine('+3,505.2');
    assert.equal(r.transactions[0].comment, '');
    assert.ok(r.flags.some((f) => f.code === 'EMPTY_COMMENT'));
  });
});

describe('formatMinor', () => {
  test('round-trips the shapes the report prints', () => {
    assert.equal(formatMinor(8_000 * 100), '8,000');
    assert.equal(formatMinor(4_194_850), '41,948.50');
    assert.equal(formatMinor(440_644), '4,406.44');
  });
});
