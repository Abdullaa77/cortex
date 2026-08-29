import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  movementShape,
  activeAccounts,
  accountById,
  MAIN_ACCOUNT_NAME,
  sidesForClass,
  validateAccountDraft,
  nextDefaultAfterRetiring,
  nextSortOrder,
  type AccountRecord,
} from './accounts.ts';
import { CORPUS_RECORDS, MAIN_ID } from './__fixtures__/corpus.ts';
import { classifyRow } from './summarize.ts';

const account = (over: Partial<AccountRecord> & { id: string; name: string }): AccountRecord => ({
  owner: 'me',
  currency: 'UZS',
  kind: 'cash',
  is_active: true,
  sort_order: 0,
  ...over,
});

describe('what the two pointers say happened', () => {
  test('from only — it left the household', () => {
    assert.equal(movementShape({ from_account_id: 'a', to_account_id: null }), 'left-household');
  });

  test('to only — it entered the household', () => {
    assert.equal(movementShape({ from_account_id: null, to_account_id: 'a' }), 'entered-household');
  });

  test('both — it moved between accounts', () => {
    assert.equal(movementShape({ from_account_id: 'a', to_account_id: 'b' }), 'between-accounts');
  });

  test('neither — unassigned, which is what capture still writes in Stage 1', () => {
    assert.equal(movementShape({ from_account_id: null, to_account_id: null }), 'unassigned');
  });
});

describe('the Stage 1 backfill, as the corpus holds it', () => {
  test('every imported row touches exactly one side of Main', () => {
    for (const row of CORPUS_RECORDS) {
      const shape = movementShape(row);
      assert.notEqual(shape, 'unassigned', `${row.raw_input} was left unmapped`);
      assert.notEqual(shape, 'between-accounts', `${row.raw_input} invented a second account`);
    }
  });

  test('the side is decided by what the row COUNTS AS, never by its direction', () => {
    // Migration 008 read `direction` here, and on the real corpus that is
    // wrong exactly once: "4,625,000 salary (July)" carries direction
    // 'expense', because the line has no leading plus, and is filed under
    // Income, because it says salary. `classifyRow` has always resolved that
    // in the ledger's favour — which is why every /finance figure is right —
    // and the pointers now resolve it the same way. Migration 009 repairs the
    // rows already written.
    for (const row of CORPUS_RECORDS) {
      const arrived = ['income', 'transfer-in'].includes(classifyRow(row));
      assert.equal(row.from_account_id, arrived ? null : MAIN_ID, row.raw_input);
      assert.equal(row.to_account_id, arrived ? MAIN_ID : null, row.raw_input);
    }
  });

  test('the salary arrives, and reading direction would have said it left', () => {
    const salary = CORPUS_RECORDS.find((r) => r.raw_input.includes('salary (July)'))!;
    assert.equal(salary.amount_minor, 4_625_000 * 100);
    assert.equal(salary.direction, 'expense', 'the parser saw no leading plus');
    assert.equal(classifyRow(salary), 'income', 'the category says otherwise');
    assert.equal(movementShape(salary), 'entered-household');
    assert.equal(salary.to_account_id, MAIN_ID);
    assert.equal(salary.from_account_id, null);
  });

  test('the confirmed 4,850,000 points out of Main and nowhere else', () => {
    // The dollar account it actually went to does not exist yet. Guessing it
    // here would write fiction into the ledger; Stage 2 maps it for real.
    const row = CORPUS_RECORDS.find((r) => r.raw_input.includes('transferred to mom for 400$'));
    assert.ok(row, 'the 4,850,000 transfer should be in the corpus');
    assert.equal(row.amount_minor, 4_850_000 * 100);
    assert.equal(classifyRow(row), 'transfer-out');
    assert.equal(row.from_account_id, MAIN_ID);
    assert.equal(row.to_account_id, null, 'the destination must stay unknown, not be guessed');
  });

  test('an incoming transfer arrives at Main — its unknown side is the source', () => {
    // Writing from = Main for money that came *in* would say it left when it
    // arrived. That is not a missing fact, it is a wrong one.
    const incoming = CORPUS_RECORDS.filter((r) => classifyRow(r) === 'transfer-in');
    assert.ok(incoming.length > 0, 'the corpus has incoming transfers');
    for (const row of incoming) {
      assert.equal(row.from_account_id, null, row.raw_input);
      assert.equal(row.to_account_id, MAIN_ID, row.raw_input);
    }
  });

  test('the account columns do not decide whether something was spending', () => {
    // Spending and a repaid debt both leave Main. classifyRow is what tells
    // them apart, and it must keep doing so on its own.
    const leaving = CORPUS_RECORDS.filter((r) => movementShape(r) === 'left-household');
    const classes = new Set(leaving.map(classifyRow));
    assert.ok(classes.has('spend'), 'purchases leave Main');
    assert.ok(classes.has('transfer-out'), 'so do transfers, and they are not spending');
  });
});

describe('listing accounts', () => {
  const accounts = [
    account({ id: '3', name: 'Dollar envelope', currency: 'USD', sort_order: 2 }),
    account({ id: '1', name: MAIN_ACCOUNT_NAME, sort_order: 0 }),
    account({ id: '9', name: 'Old wallet', sort_order: 1, is_active: false }),
    account({ id: '2', name: 'Mom — cash', owner: 'mom', sort_order: 1 }),
  ];

  test('active only, in display order', () => {
    assert.deepEqual(activeAccounts(accounts).map((a) => a.name), [
      'Main',
      'Mom — cash',
      'Dollar envelope',
    ]);
  });

  test('a retired account is still findable — history points at it', () => {
    assert.equal(accountById(accounts, '9')?.name, 'Old wallet');
  });

  test('a null id resolves to nothing rather than throwing', () => {
    assert.equal(accountById(accounts, null), null);
    assert.equal(accountById(accounts, 'nope'), null);
  });

  test('ties in sort_order fall back to name, so the order is never arbitrary', () => {
    const tied = [
      account({ id: 'b', name: 'Zed', sort_order: 5 }),
      account({ id: 'a', name: 'Alpha', sort_order: 5 }),
    ];
    assert.deepEqual(activeAccounts(tied).map((a) => a.name), ['Alpha', 'Zed']);
  });
});


describe('sidesForClass — the rule, in one place', () => {
  test('money that arrived goes on the to side', () => {
    for (const cls of ['income', 'transfer-in'] as const)
      assert.deepEqual(sidesForClass(cls, 'a'), {
        from_account_id: null,
        to_account_id: 'a',
      });
  });

  test('money that left goes on the from side', () => {
    for (const cls of ['spend', 'transfer-out'] as const)
      assert.deepEqual(sidesForClass(cls, 'a'), {
        from_account_id: 'a',
        to_account_id: null,
      });
  });

  test('it agrees with movementShape for every class', () => {
    assert.equal(movementShape(sidesForClass('income', 'a')), 'entered-household');
    assert.equal(movementShape(sidesForClass('spend', 'a')), 'left-household');
  });
});

describe('naming an account', () => {
  const existing = [
    account({ id: '1', name: 'Main' }),
    account({ id: '2', name: "Mom — cash", owner: 'mom' }),
  ];
  const draft = (over: Partial<AccountRecord> = {}) => ({
    name: 'Dollar envelope',
    owner: 'me' as const,
    currency: 'USD' as const,
    kind: 'cash' as const,
    ...over,
  });

  test('a reasonable one is accepted', () => {
    assert.deepEqual(validateAccountDraft(draft(), existing), { ok: true, errors: [] });
  });

  test('a blank name is refused — you count it by its name', () => {
    assert.equal(validateAccountDraft(draft({ name: '   ' }), existing).ok, false);
  });

  test('a duplicate is refused, case and whitespace aside', () => {
    // Two accounts called the same thing are indistinguishable at the point of
    // use, and the database carries UNIQUE (user_id, name) to match. Catching
    // it here turns a constraint violation halfway through the cutover into a
    // sentence beside the field.
    for (const name of ['Main', 'main', '  MAIN  ']) {
      const { ok, errors } = validateAccountDraft(draft({ name }), existing);
      assert.equal(ok, false, name);
      assert.match(errors.join(' '), /already an account/i);
    }
  });

  test('two currencies of the same idea are two accounts, not a clash', () => {
    // Mom's som cash and mom's dollar cash live in one drawer and are counted
    // separately, so they are two accounts with two names.
    assert.equal(
      validateAccountDraft(draft({ name: "Mom — dollars", owner: 'mom' }), existing).ok,
      true
    );
  });

  test('a new account lands at the end rather than on top', () => {
    assert.equal(nextSortOrder(existing), 1);
    assert.equal(nextSortOrder([]), 0);
  });
});

describe('renaming an account in place', () => {
  // Same function as the add row, with the row being edited excluded — so the
  // sentences a rename is refused with are the sentences the add row uses,
  // rather than a second wording of the same rule that can drift from it.
  const main = account({ id: '1', name: 'Main' });
  const mom = account({ id: '2', name: "Mom — cash", owner: 'mom' });
  const retired = account({ id: '3', name: 'Old wallet', is_active: false });
  const existing = [main, mom, retired];

  const rename = (id: string, name: string) =>
    validateAccountDraft({ ...account({ id, name }) }, existing, id);

  test('an account may keep its own name', () => {
    // Without self-exclusion this reports that an account called Main already
    // exists, naming the very row being edited.
    assert.equal(rename('1', 'Main').ok, true);
  });

  test('and may fix its own capitalisation', () => {
    assert.equal(rename('1', 'main').ok, true);
    assert.equal(rename('1', 'MAIN').ok, true);
  });

  test('renaming onto another account is refused, in the add row\'s words', () => {
    for (const name of ["Mom — cash", "mom — cash", "  MOM — CASH  "]) {
      const { ok, errors } = rename('1', name);
      assert.equal(ok, false, name);
      assert.equal(errors[0], `There is already an account called ${name.trim()}.`);
    }
  });

  test('renaming to empty is refused, in the add row\'s words', () => {
    for (const name of ['', '   ']) {
      const { ok, errors } = rename('1', name);
      assert.equal(ok, false, JSON.stringify(name));
      assert.equal(errors[0], 'Give it a name — you will be counting it by that name.');
    }
  });

  test('a retired account still holds its name', () => {
    // UNIQUE (user_id, name) does not care whether a row is active. Excluding
    // retired names here would turn a caught mistake into a constraint
    // violation from the server with nothing next to the field.
    assert.equal(rename('1', 'Old wallet').ok, false);
  });

  test('the refusal wording matches creating, exactly', () => {
    const onCreate = validateAccountDraft(
      { name: 'Main', owner: 'me', currency: 'UZS', kind: 'cash' },
      existing
    );
    const onRename = rename('2', 'Main');
    assert.deepEqual(onRename.errors, onCreate.errors);
  });
});

describe('where captures land when an account is retired', () => {
  const main = account({ id: '1', name: 'Main', sort_order: 0 });
  const mom = account({ id: '2', name: "Mom — cash", owner: 'mom', sort_order: 1 });
  const retired = account({ id: '3', name: 'Old wallet', is_active: false, sort_order: 2 });

  test('the next active account in display order takes over', () => {
    assert.equal(nextDefaultAfterRetiring([main, mom, retired], '1')?.id, '2');
  });

  test('a retired account is never made the successor', () => {
    // It would be the same bug one step later: capture pointing at a drawer
    // that positionsAt does not list, so the money counts as spent and moves
    // no position.
    assert.equal(nextDefaultAfterRetiring([main, retired], '1'), null);
  });

  test('the last active account has no successor, so retiring it must be refused', () => {
    assert.equal(nextDefaultAfterRetiring([main], '1'), null);
    assert.equal(nextDefaultAfterRetiring([main, retired], '1'), null);
  });

  test('display order decides, not creation order', () => {
    const later = account({ id: '4', name: 'Aaa', sort_order: 0 });
    assert.equal(nextDefaultAfterRetiring([main, mom, later], '1')?.id, '4');
  });
});
