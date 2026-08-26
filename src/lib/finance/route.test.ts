import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeCapture, planNotMoney, type Booking } from './route.ts';
import { parseLine } from './parse.ts';

describe('routing — the cases that matter', () => {
  const cases: [string, 'finance' | 'inbox'][] = [
    ['-10k two bananas', 'finance'],
    ['-$5 coffee', 'finance'],
    ['-45000 taxi', 'finance'],
    ['-5 min meditation', 'inbox'],
    ['-20 pushups', 'inbox'],
    ['- call plumber', 'inbox'],
    ['+200k salary', 'finance'],
  ];

  for (const [text, expected] of cases)
    test(`"${text}" -> ${expected}`, () => {
      assert.equal(routeCapture(text).target, expected);
    });
});

describe('why each one routed', () => {
  test('a k/m suffix is a deliberate amount', () => {
    assert.equal(routeCapture('-10k two bananas').reason, 'scaled');
    assert.equal(routeCapture('+200k salary').reason, 'scaled');
    assert.equal(routeCapture('-1.5m rent').reason, 'scaled');
  });

  test('a named currency is a deliberate amount', () => {
    assert.equal(routeCapture('-$5 coffee').reason, 'explicit-currency');
    assert.equal(routeCapture('-5 usd coffee').reason, 'explicit-currency');
  });

  test('a big bare number is the only heuristic', () => {
    assert.equal(routeCapture('-45000 taxi').reason, 'above-floor');
    assert.equal(routeCapture('-1000 water').reason, 'above-floor');
    assert.equal(routeCapture('-999 water').reason, 'below-floor');
  });

  test('no amount at all never routes to finance', () => {
    for (const text of ['- call plumber', 'call plumber', 'buy milk', '- ', 'ideas'])
      assert.equal(routeCapture(text).reason, 'no-amount', text);
  });

  test('inbox-routed captures carry no transactions', () => {
    for (const text of ['-5 min meditation', '-20 pushups', '- call plumber'])
      assert.deepEqual(routeCapture(text).transactions, [], text);
  });
});

describe('the detector is allowed to be wrong', () => {
  test('"-2000 words to write" misfires, by design', () => {
    // Over the floor and not money. Chasing this with a blocklist of unit
    // words is a losing game; the confirmation strip is the answer instead.
    const decision = routeCapture('-2000 words to write');
    assert.equal(decision.target, 'finance');
    assert.equal(decision.reason, 'above-floor');
  });

  test('the escape leaves no transaction and exactly one inbox item', () => {
    const decision = routeCapture('-2000 words to write');
    const booking: Booking = {
      transactionIds: ['row-1'],
      rawInput: '-2000 words to write',
      transactions: decision.transactions,
    };
    const plan = planNotMoney(booking);
    assert.deepEqual(plan.deleteIds, ['row-1']);
    assert.equal(plan.inboxText, '-2000 words to write');
  });

  test('the escape files the original text unchanged, never a rewrite', () => {
    const raw = '  -2000 words to write  ';
    const plan = planNotMoney({ transactionIds: ['a', 'b'], rawInput: raw, transactions: [] });
    assert.equal(plan.inboxText, raw);
    assert.equal(plan.deleteIds.length, 2, 'every booked row is removed');
  });
});

describe('what gets booked', () => {
  test('direction comes from the sign, unchanged from the parser', () => {
    assert.equal(routeCapture('-10k two bananas').transactions[0].direction, 'expense');
    assert.equal(routeCapture('+200k salary').transactions[0].direction, 'income');
    assert.equal(routeCapture('45000 taxi').transactions[0].direction, 'expense');
  });

  test('amounts are minor units, exponent 2', () => {
    assert.equal(routeCapture('-10k two bananas').transactions[0].amountMinor, 1_000_000);
    assert.equal(routeCapture('-45000 taxi').transactions[0].amountMinor, 4_500_000);
  });

  test('currency defaults to UZS and only a marker changes it', () => {
    const uzs = routeCapture('-10k two bananas').transactions[0];
    assert.equal(uzs.currency, 'UZS');
    assert.equal(uzs.explicitCurrency, false);

    const usd = routeCapture('-$5 coffee').transactions[0];
    assert.equal(usd.currency, 'USD');
    assert.equal(usd.explicitCurrency, true);
    assert.equal(usd.amountMinor, 500);
    assert.equal(usd.comment, 'coffee');
  });

  test('a line that splits books both halves', () => {
    const decision = routeCapture('13,713(potato) + 38,500(taxi)');
    assert.equal(decision.target, 'finance');
    assert.equal(decision.transactions.length, 2);
  });

  test('the router never re-reads the grammar itself', () => {
    // Whatever the parser produces is what gets booked, verbatim.
    for (const text of ['-10k two bananas', '-$5 coffee', '+200k salary'])
      assert.deepEqual(routeCapture(text).transactions, parseLine(text).transactions, text);
  });
});
