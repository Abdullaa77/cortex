import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideLine, decideMessage, resolveLine, matchOwed, parseBareAmount, scaleRaw, type BotContext } from './intent.ts';
import { decode, encode, type CallbackOp } from './callbacks.ts';
import { parseUpdate } from './update.ts';
import { renderTxn, renderGap, renderDayClose, renderCategoryMenu, type Reply } from './render.ts';
import { CATEGORIES } from '../finance/categorize.ts';

const OWNER = 4242;
const ID = '123e4567-e89b-42d3-a456-426614174000';
const ctx = (over: Partial<BotContext> = {}): BotContext => ({
  learned: new Map(),
  owed: [{ id: 'o1', person: 'Muxlisa opa', openMinor: 93_082_389 }],
  pendingBalance: null,
  ...over,
});
const cats = CATEGORIES.filter((c) => c.kind === 'expense');

function saved(line: string, c = ctx()) {
  const d = decideLine(line, c);
  assert.equal(d.type, 'save', `${line} should save at once`);
  return d.type === 'save' ? d.drafts : [];
}

describe("Scott's real lines", () => {
  const cases: [string, string, string | null, number][] = [
    ['-70,200 VIA PAYMENT phone plan', 'expense', 'phone-internet', 7_020_000],
    ['-10k taxi', 'expense', 'transport', 1_000_000],
    ['-8k banana', 'expense', 'groceries', 800_000],
    ['-310k train ticket', 'expense', 'travel', 31_000_000],
    ['-200k gift to Muxlisa opa sister', 'expense', 'gifts-events', 20_000_000],
    ['-40k bread', 'expense', 'groceries', 4_000_000],
    ['+100k doc service', 'income', 'income', 10_000_000],
    ['+80k transfer from mom', 'income', 'income', 8_000_000],
    ['+6M salary', 'income', 'income', 600_000_000],
    ['+310k muxlisa opa paying back', 'income', 'income', 31_000_000],
  ];
  for (const [line, dir, slug, minor] of cases)
    test(`${line} saves at once to Cash`, () => {
      const [d] = saved(line);
      assert.equal(d.direction, dir);
      assert.equal(d.categorySlug, slug);
      assert.equal(d.amountMinor, minor);
      assert.equal(d.account, 'cash');
    });

  for (const line of ['-43k gm club', '-15k sandwich', '-400k math course payment', '-200k cosmetics for mom'])
    test(`${line} saves with no category (asked once after)`, () => {
      assert.equal(saved(line)[0].categorySlug, null);
    });

  test('a learned keyword wins and is not asked again', () => {
    const learned = new Map([['gm club', 'entertainment']]);
    assert.equal(saved('-43k gm club', ctx({ learned }))[0].categorySlug, 'entertainment');
  });

  test('*250 card to cash exchange asks "250 or 250,000?" and guesses nothing', () => {
    const d = decideLine('*250 card to cash exchange', ctx());
    assert.equal(d.type, 'ask');
    if (d.type !== 'ask') return;
    assert.equal(d.kind, 'amount');
    const r = d.render(ID);
    assert.match(r.text, /250 or 250,000\?/);
  });

  test('answering 250,000 re-reads the line as a move and asks from/to', () => {
    const d = resolveLine('*250 card to cash exchange', 'scale', ctx());
    assert.equal(d.type, 'ask');
    if (d.type !== 'ask') return;
    assert.equal(d.kind, 'move');
    assert.equal(d.move?.amountMinor, 25_000_000);
  });

  test('answering "250" keeps 250 and asks from/to', () => {
    const d = resolveLine('*250 card to cash exchange', 'asis', ctx());
    assert.equal(d.type === 'ask' && d.move?.amountMinor, 25_000);
  });

  test('*250k asks from/to straight away', () => {
    const d = decideLine('*250k card to cash', ctx());
    assert.equal(d.type === 'ask' && d.kind, 'move');
  });

  test('*1,5k (unclear decimal comma) is refused, never sent to from/to with a guessed amount', () => {
    const d = decideLine('*1,5k humo to cash', ctx());
    assert.equal(d.type, 'say');
    assert.match(d.type === 'say' ? d.reply.text : '', /again/);
  });
});

describe('flagged lines are asked before saving', () => {
  test('unsigned income wording asks', () => {
    const d = decideLine('4,625,000 salary July', ctx());
    assert.equal(d.type === 'ask' && d.kind, 'confirm');
  });
  test('bare small amount asks "10 or 10,000?"', () => {
    const d = decideLine('-10 taxi', ctx());
    assert.equal(d.type === 'ask' && d.kind, 'amount');
  });
  test('a $ in the leading position is refused, not saved', () => {
    assert.equal(decideLine('-$5 coffee', ctx()).type, 'say');
  });
  test('confirm → Income saves it as income despite the minus', () => {
    const d = resolveLine('-4,625,000 salary July', 'income', ctx());
    assert.equal(d.type === 'save' && d.drafts[0].direction, 'income');
  });
  test('cancel saves nothing', () => {
    assert.equal(resolveLine('-4,625,000 salary July', 'cancel', ctx()).type, 'say');
  });
  test('no amount → a helpful line, nothing saved', () => {
    assert.equal(decideLine('hello there', ctx()).type, 'say');
  });
  test('a pasted block is decided line by line', () => {
    const ds = decideMessage('-10k taxi\n\n-8k banana', ctx());
    assert.equal(ds.length, 2);
    assert.ok(ds.every((d) => d.type === 'save'));
  });
  test('/start answers with help', () => {
    assert.equal(decideMessage('/start', ctx())[0].type, 'say');
  });
});

describe('balance answers', () => {
  test('a bare number while a question is open is the count', () => {
    const d = decideLine('148,000', ctx({ pendingBalance: 'cash' }));
    assert.deepEqual(d, { type: 'balance', account: 'cash', countedMinor: 14_800_000 });
  });
  test('a normal expense line still saves while a question is open', () => {
    assert.equal(decideLine('-10k taxi', ctx({ pendingBalance: 'cash' })).type, 'save');
  });
  test('without an open question a bare number is not a count', () => {
    assert.notEqual(decideLine('148000', ctx()).type, 'balance');
  });
  test('parseBareAmount refuses a decimal comma', () => {
    assert.equal(parseBareAmount('4406,44'), null);
    assert.equal(parseBareAmount('160k'), 16_000_000);
  });
  test('gap sentence points the right way', () => {
    assert.equal(renderGap('cash', 14_800_000, -1_200_000).text, "Cash is 12,000 short — what's missing?");
    assert.match(renderGap('cash', 1, 500).text, /more than logged/);
    assert.match(renderGap('humo', 100, 0).text, /matches/);
    assert.match(renderGap('humo', 100, null).text, /starts/);
  });
});

describe('owed list', () => {
  test('an income line naming a listed person matches', () => {
    assert.equal(matchOwed('muxlisa opa paying back', ctx().owed)?.id, 'o1');
  });
  test('no match for strangers or a settled debt', () => {
    assert.equal(matchOwed('doc service', ctx().owed), null);
    assert.equal(matchOwed('muxlisa opa', [{ id: 'x', person: 'Muxlisa opa', openMinor: 0 }]), null);
  });
});

describe('render + callbacks', () => {
  test('saved reply shows category, amount, account and the three button groups', () => {
    const r = renderTxn({ id: ID, direction: 'expense', amountMinor: 2_500_000, categorySlug: 'transport', account: 'cash' }, cats);
    assert.equal(r.text, '✓ Transport −25,000 · Cash');
    const labels = r.buttons.flat().map((b) => b.text);
    assert.deepEqual(labels.slice(0, 2), ['Undo', 'Change category']);
    assert.deepEqual(labels.slice(2), ['● Cash', 'Humo', 'Uzum', 'OFB', '7113']);
  });
  test('uncategorised reply offers category buttons and still Undo', () => {
    const r = renderTxn({ id: ID, direction: 'expense', amountMinor: 40_000_000, categorySlug: null, account: 'cash' }, cats);
    assert.match(r.text, /what is it for\?/);
    assert.ok(r.buttons.flat().some((b) => b.text === 'Undo'));
    assert.ok(r.buttons.flat().some((b) => b.text === 'Transport'));
  });
  test('every button fits Telegram\'s 64 bytes and decodes', () => {
    const replies: Reply[] = [
      renderTxn({ id: ID, direction: 'expense', amountMinor: 1, categorySlug: null, account: 'cash' }, cats),
      renderTxn({ id: ID, direction: 'income', amountMinor: 1, categorySlug: 'income', account: 'humo' }, cats),
      renderCategoryMenu(ID, cats),
      renderDayClose({ dateLabel: 'Wed 25 Nov', totalMinor: 1, top: [], sunday: false }),
    ];
    for (const b of replies.flatMap((r) => r.buttons.flat())) {
      assert.ok(Buffer.byteLength(b.data) <= 64, b.data);
      assert.notEqual(decode(b.data), null, b.data);
    }
  });
  test('encode/decode round-trips every op', () => {
    const ops: CallbackOp[] = [
      { op: 'undo', txn: ID }, { op: 'menu', txn: ID },
      { op: 'category', txn: ID, slug: 'gifts-events' },
      { op: 'account', txn: ID, account: 'c7113' },
      { op: 'pending', pending: ID, choice: 'scale' },
      { op: 'moveFrom', pending: ID, account: 'humo' },
      { op: 'moveTo', pending: ID, account: 'cash' },
      { op: 'snooze' },
    ];
    for (const op of ops) assert.deepEqual(decode(encode(op)), op);
  });
  test('decode refuses junk, unknown accounts and SQL-ish text', () => {
    for (const bad of ['', 'u:1', `a:${ID}:bitcoin`, `k:${ID}:x;drop`, `u:${ID}:extra`, 'x'.repeat(80)])
      assert.equal(decode(bad), null, bad);
  });
  test('day-close lists spend, top categories, the cash question and a snooze', () => {
    const r = renderDayClose({ dateLabel: 'Sun 29 Nov', totalMinor: 12_000_000, top: [{ name: 'Transport', minor: 5_000_000 }], sunday: true });
    assert.match(r.text, /spent 120,000/);
    assert.match(r.text, /Transport 50,000/);
    assert.match(r.text, /Cash now\?/);
    assert.match(r.text, /Sunday/);
    assert.equal(r.buttons[0][0].text, 'Remind me in 1 h');
  });
  test('scaleRaw keeps sign and star', () => {
    assert.equal(scaleRaw('*250 x'), '*250k x');
    assert.equal(scaleRaw('-10 taxi'), '-10k taxi');
  });
});

describe('who is allowed to talk', () => {
  const msg = (from: unknown) => ({ message: { message_id: 1, chat: { id: 7 }, from, text: '-10k taxi' } });
  test('the owner is heard', () => {
    assert.deepEqual(parseUpdate(msg({ id: OWNER }), OWNER), { kind: 'message', chatId: 7, messageId: 1, text: '-10k taxi' });
  });
  test('a stranger, a bot and garbage are ignored', () => {
    assert.equal(parseUpdate(msg({ id: 1 }), OWNER).kind, 'ignore');
    assert.equal(parseUpdate(msg({ id: OWNER, is_bot: true }), OWNER).kind, 'ignore');
    for (const junk of [null, 'x', 5, [], {}, { message: 1 }, { callback_query: { from: { id: OWNER } } }])
      assert.equal(parseUpdate(junk, OWNER).kind, 'ignore');
  });
  test('an owner callback is read, a stranger\'s is not', () => {
    const cb = (id: number) => ({ callback_query: { id: 'q', from: { id }, data: 'z', message: { message_id: 3, chat: { id: 7 } } } });
    assert.equal(parseUpdate(cb(OWNER), OWNER).kind, 'callback');
    assert.equal(parseUpdate(cb(9), OWNER).kind, 'ignore');
  });
});
