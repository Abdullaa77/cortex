import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Failure must not render as emptiness.
 *
 * Read as text, for the same reason rls.test.ts is: there is no browser in
 * this suite and there should not be one. The invariant is structural anyway —
 * it is about which branch is checked first, not about what the pixels do.
 *
 * The bug this pins down cost a day. `accounts` failed to load because the
 * table did not exist, the hook caught the error into `error`, the list stayed
 * `[]` because it had never been anything else, and PositionsCard read that
 * empty array as "no accounts yet" and invited Scott to set some up. Every
 * layer behaved correctly and the screen still made a claim the app could not
 * support. Nothing was wrong with the copy; the wrong variable reached it.
 *
 * The general rule, worth more than this one screen: an empty collection is
 * the answer "there are none". It must never also be how "the question could
 * not be asked" arrives at the UI.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const HOOK = read('../../hooks/useAccounts.ts');
const CARD = read('../../components/finance/PositionsCard.tsx');
const FINANCE = read('../../app/finance/page.tsx');
const CUTOVER = read('../../app/finance/cutover/page.tsx');

describe('a failed accounts load is not an empty household', () => {
  test('the card checks error before it checks length', () => {
    const errorAt = CARD.indexOf('if (error)');
    const emptyAt = CARD.indexOf('if (positions.length === 0)');
    assert.ok(errorAt > 0, 'PositionsCard has no failure branch at all');
    assert.ok(emptyAt > 0, 'PositionsCard lost its empty branch');
    assert.ok(
      errorAt < emptyAt,
      'the empty state is reached first, so a failed load still reads as "no accounts yet"'
    );
  });

  test('the two branches say different things', () => {
    assert.match(CARD, /Could not load accounts\./);
    assert.match(CARD, /No accounts yet\./);
  });

  test('/finance hands the card the error rather than dropping it', () => {
    // Both call sites: the page renders PositionsCard twice, and the one on
    // the degraded branch is precisely the one a broken database reaches.
    const passes = [...FINANCE.matchAll(/<PositionsCard\b[\s\S]*?\/>/g)];
    assert.equal(passes.length, 2, 'call sites moved — check both still forward the error');
    for (const [tag] of passes) assert.match(tag, /error=\{accounts\.error\}/);
  });

  test('the cutover refuses to start on a load it could not make', () => {
    // Worse than a wrong empty state: it would walk someone through creating
    // accounts that already exist.
    assert.match(CUTOVER, /if \(store\.error\)/);
    assert.match(CUTOVER, /Could not load the accounts\./);
  });
});

describe('the hook cannot report success for a query it never got', () => {
  test('all three reads are checked, settings included', () => {
    // `.maybeSingle()` reports no rows as data:null with error:null, so
    // checking this cannot false-positive on a user who simply has no settings
    // row — and not checking it is how a missing finance_settings table
    // became "no settings set yet".
    assert.match(HOOK, /if \(accRes\.error\) throw accRes\.error;/);
    assert.match(HOOK, /if \(cpRes\.error\) throw cpRes\.error;/);
    assert.match(HOOK, /if \(setRes\.error\) throw setRes\.error;/);
  });

  test('a failed fetch leaves no half-loaded state behind the error', () => {
    const cat = HOOK.slice(HOOK.indexOf('} catch (err) {'), HOOK.indexOf('} finally {'));
    assert.match(cat, /setAccounts\(\[\]\)/);
    assert.match(cat, /setCheckpoints\(\[\]\)/);
    assert.match(cat, /setError\(/);
  });
});
