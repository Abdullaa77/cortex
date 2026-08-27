import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  uniqueSlug,
  validateDraft,
  buildInsert,
  buildUpdate,
  planRetire,
  usageByCategory,
  reclassifyCount,
  activeCategories,
  MAX_NAME_LENGTH,
  type CategoryRecord,
  type CategoryDraft,
} from './categories.ts';
import { CORE_SLUGS } from './summarize.ts';
import { CATEGORIES } from './categorize.ts';

function category(over: Partial<CategoryRecord> & { id: string }): CategoryRecord {
  return {
    slug: 'thing',
    name: 'Thing',
    icon: '◉',
    color: '#00FF88',
    kind: 'expense',
    sort_order: 0,
    is_archived: false,
    ...over,
  };
}

const draft = (over: Partial<CategoryDraft> = {}): CategoryDraft => ({
  name: 'Coffee',
  icon: '☕',
  color: '#F59E0B',
  kind: 'expense',
  ...over,
});

/** The seeded set, as it exists in the database after migration 005. */
const seeded: CategoryRecord[] = CATEGORIES.map((c, i) => ({
  id: `id-${c.slug}`,
  slug: c.slug,
  name: c.name,
  icon: c.icon,
  color: c.color,
  kind: c.kind,
  sort_order: i,
  is_archived: false,
}));

describe('slugify', () => {
  test('the shapes the seed already uses', () => {
    assert.equal(slugify('Eating out'), 'eating-out');
    assert.equal(slugify('Phone + net'), 'phone-net');
    assert.equal(slugify('Gifts + events'), 'gifts-events');
    assert.equal(slugify('Transfer / debt'), 'transfer-debt');
  });

  test('accents fold, so Café and Cafe are one category', () => {
    assert.equal(slugify('Café'), 'cafe');
    assert.equal(slugify('Café'), slugify('Cafe'));
  });

  test('punctuation and edges never leak into the slug', () => {
    assert.equal(slugify('  Spaced  Out  '), 'spaced-out');
    assert.equal(slugify('--Dashes--'), 'dashes');
    assert.equal(slugify('!!!'), '');
  });

  test('non-latin names produce nothing, and the caller substitutes', () => {
    assert.equal(slugify('Оплата'), '');
    assert.equal(uniqueSlug('Оплата', []), 'category');
  });
});

describe('uniqueSlug', () => {
  test('an unused name keeps its plain slug', () => {
    assert.equal(uniqueSlug('Coffee', seeded.map((c) => c.slug)), 'coffee');
  });

  test('a collision is suffixed rather than refused', () => {
    const taken = seeded.map((c) => c.slug);
    assert.equal(uniqueSlug('Travel', taken), 'travel-2');
    assert.equal(uniqueSlug('Travel', [...taken, 'travel-2']), 'travel-3');
  });

  test("'uncategorised' is reserved — the app means something by it", () => {
    assert.equal(uniqueSlug('Uncategorised', []), 'uncategorised-2');
  });

  test('an empty slug still yields something usable', () => {
    assert.equal(uniqueSlug('!!!', []), 'category');
    assert.equal(uniqueSlug('!!!', ['category']), 'category-2');
  });
});

describe('a rename never moves the slug', () => {
  /**
   * The defect this guards is silent: rename "Eating out", its slug is
   * regenerated, and it drops out of CORE_SLUGS. The everyday floor then reads
   * lower every month and nothing errors.
   */
  test('renaming produces no slug in the patch', () => {
    const eatingOut = seeded.find((c) => c.slug === 'eating-out')!;
    const patch = buildUpdate(eatingOut, {
      name: 'Restaurants',
      icon: eatingOut.icon,
      color: eatingOut.color,
      kind: eatingOut.kind,
    });

    // Exactly one field: the name. Nothing else about the category moved.
    assert.deepEqual(patch, { name: 'Restaurants' });
    assert.equal('slug' in patch, false);
    assert.equal(eatingOut.slug, 'eating-out');
  });

  test('the everyday floor survives renaming all three of its categories', () => {
    const renamed = seeded.map((c) =>
      (CORE_SLUGS as readonly string[]).includes(c.slug)
        ? { ...c, name: `${c.name} (renamed)` }
        : c
    );
    for (const slug of CORE_SLUGS)
      assert.ok(
        renamed.some((c) => c.slug === slug),
        `${slug} must still exist after a rename`
      );
  });

  test('an edit that changed nothing writes nothing', () => {
    const c = seeded[0];
    assert.deepEqual(
      buildUpdate(c, { name: c.name, icon: c.icon, color: c.color, kind: c.kind }),
      {}
    );
  });

  test('whitespace alone is not a change', () => {
    const c = seeded[0];
    assert.deepEqual(
      buildUpdate(c, { name: `  ${c.name}  `, icon: ` ${c.icon} `, color: c.color, kind: c.kind }),
      {}
    );
  });
});

describe('validateDraft', () => {
  test('accepts a reasonable new category', () => {
    assert.deepEqual(validateDraft(draft(), seeded), { ok: true, errors: [] });
  });

  test('a blank name is refused', () => {
    const { ok, errors } = validateDraft(draft({ name: '   ' }), seeded);
    assert.equal(ok, false);
    assert.match(errors.join(' '), /name/i);
  });

  test('an over-long name is refused', () => {
    const { ok } = validateDraft(draft({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }), seeded);
    assert.equal(ok, false);
  });

  test('a duplicate name is refused, whatever its case', () => {
    const { ok, errors } = validateDraft(draft({ name: 'groceries' }), seeded);
    assert.equal(ok, false);
    assert.match(errors.join(' '), /already exists/);
  });

  test('an archived duplicate says to restore it instead', () => {
    const archived = [...seeded, category({ id: 'old', name: 'Coffee', slug: 'coffee', is_archived: true })];
    const { ok, errors } = validateDraft(draft({ name: 'Coffee' }), archived);
    assert.equal(ok, false);
    assert.match(errors.join(' '), /archived. Restore it instead/);
  });

  test('editing a category does not collide with itself', () => {
    const c = seeded[0];
    const { ok } = validateDraft(
      { name: c.name, icon: c.icon, color: c.color, kind: c.kind },
      seeded,
      c.id
    );
    assert.equal(ok, true);
  });

  test('a missing icon or a bad colour is refused', () => {
    assert.equal(validateDraft(draft({ icon: '' }), seeded).ok, false);
    assert.equal(validateDraft(draft({ color: 'green' }), seeded).ok, false);
    assert.equal(validateDraft(draft({ color: '#GGGGGG' }), seeded).ok, false);
    assert.equal(validateDraft(draft({ color: '#0f0' }), seeded).ok, false);
    assert.equal(validateDraft(draft({ color: '#00ff88' }), seeded).ok, true);
  });
});

describe('buildInsert', () => {
  test('generates the slug once and sorts to the end', () => {
    const row = buildInsert(draft(), seeded);
    assert.equal(row.slug, 'coffee');
    assert.equal(row.name, 'Coffee');
    assert.equal(row.kind, 'expense');
    assert.equal(row.is_archived, false);
    assert.equal(row.sort_order, seeded.length);
  });

  test('trims what it stores', () => {
    const row = buildInsert(draft({ name: '  Coffee  ', icon: ' ☕ ' }), seeded);
    assert.equal(row.name, 'Coffee');
    assert.equal(row.icon, '☕');
  });

  test('the first category in an empty account sorts to zero', () => {
    assert.equal(buildInsert(draft(), []).sort_order, 0);
  });
});

describe('retiring a category', () => {
  const groceries = seeded.find((c) => c.slug === 'groceries')!;

  test('a category with transactions is archived, never deleted', () => {
    const plan = planRetire(groceries, 42);
    assert.equal(plan.action, 'archive');
    assert.match(plan.explanation, /42 transactions keep/);
    assert.match(plan.explanation, /not deleted/);
  });

  test('one transaction reads as one, not "1 transactions"', () => {
    assert.match(planRetire(groceries, 1).explanation, /1 transaction keeps/);
  });

  test('an unused category is deleted, and says so', () => {
    const plan = planRetire(groceries, 0);
    assert.equal(plan.action, 'delete');
    assert.match(plan.explanation, /Nothing uses/);
  });
});

describe('usage counting', () => {
  test('counts by category id and ignores uncategorised rows', () => {
    const usage = usageByCategory([
      { category_id: 'a' },
      { category_id: 'a' },
      { category_id: 'b' },
      { category_id: null },
    ]);
    assert.equal(usage.get('a'), 2);
    assert.equal(usage.get('b'), 1);
    assert.equal(usage.get('missing'), undefined);
    assert.equal(usage.size, 2);
  });

  test('changing the kind reports how much history it restates', () => {
    const c = seeded.find((s) => s.slug === 'groceries')!;
    assert.equal(reclassifyCount(c, draft({ kind: 'expense' }), 42), 0);
    assert.equal(reclassifyCount(c, draft({ kind: 'transfer' }), 42), 42);
  });
});

describe('activeCategories', () => {
  test('hides archived and sorts by sort_order', () => {
    const mixed = [
      category({ id: 'c', name: 'C', sort_order: 2 }),
      category({ id: 'a', name: 'A', sort_order: 0 }),
      category({ id: 'gone', name: 'Gone', sort_order: 1, is_archived: true }),
    ];
    assert.deepEqual(activeCategories(mixed).map((c) => c.id), ['a', 'c']);
  });

  test('the seeded set comes back in seed order', () => {
    assert.deepEqual(
      activeCategories(seeded).map((c) => c.slug),
      CATEGORIES.map((c) => c.slug)
    );
  });
});
