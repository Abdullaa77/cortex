/**
 * Creating, renaming and retiring categories.
 *
 * The one rule that matters: a slug is assigned once and never changes.
 *
 * Slugs are the join between a category and everything that refers to it by
 * name rather than by id — `CORE_SLUGS` decides what counts as the everyday
 * floor, the learned keyword rules resolve through them, drill-down links
 * carry them in the URL, and `categorySlugOf` falls back to 'uncategorised'.
 * Renaming "Eating out" to "Restaurants" is a display change; regenerating its
 * slug would silently drop it out of the everyday floor and break every link
 * anyone had saved. So the name is free to change and the slug is not.
 *
 * Pure, and tested, because "the rename broke the floor" is the kind of defect
 * that shows up as a wrong number three weeks later rather than as an error.
 */

import type { CategoryKind } from './categorize.ts';

export type { CategoryKind } from './categorize.ts';

export const MAX_NAME_LENGTH = 40;

/**
 * Category slugs the app itself refers to. These may never be taken or freed.
 *
 * 'uncategorised' is the fallback `categorySlugOf` returns for a row with no
 * category. 'unaccounted' is where every balance checkpoint files the gap
 * between what was counted and what the ledger derived — deleting it would
 * leave the next count with nowhere to put its adjustment, and the choice at
 * that moment would be between losing the finding and burying it in a real
 * category. Both are worse than a category that cannot be removed.
 */
export const RESERVED_SLUGS = ['uncategorised', 'unaccounted'] as const;

export interface CategoryRecord {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  sort_order: number;
  is_archived: boolean;
}

export interface CategoryDraft {
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
}

/**
 * "Eating out" -> "eating-out".
 *
 * Only ever called when creating. A rename does not come through here.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks, so "Café" and "Cafe" do not become two categories.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * A slug not already taken.
 *
 * Two categories can legitimately want the same name — "Travel" for work and
 * "Travel" for family — and the unique constraint is per user, so the second
 * gets a suffix rather than an error the user cannot act on.
 */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const base = slugify(name) || 'category';
  const used = new Set([...taken, ...RESERVED_SLUGS]);
  if (!used.has(base)) return base;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // Unreachable in practice; better than an infinite loop if it is not.
  return `${base}-${used.size + 1}`;
}

export interface ValidationResult {
  ok: boolean;
  /** Empty when ok. */
  errors: string[];
}

/**
 * Is this draft usable?
 *
 * `existing` is every category the user has, archived included — an archived
 * "Travel" still holds the slug, and its name colliding with a new one would
 * make the two indistinguishable in the picker if it were ever restored.
 */
export function validateDraft(
  draft: CategoryDraft,
  existing: CategoryRecord[],
  /** The category being edited, so it does not collide with itself. */
  editingId: string | null = null
): ValidationResult {
  const errors: string[] = [];
  const name = draft.name.trim();

  if (name.length === 0) errors.push('Give it a name.');
  if (name.length > MAX_NAME_LENGTH)
    errors.push(`Keep the name under ${MAX_NAME_LENGTH} characters.`);

  const clash = existing.find(
    (c) => c.id !== editingId && c.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (name.length > 0 && clash)
    errors.push(
      clash.is_archived
        ? `"${clash.name}" already exists, archived. Restore it instead.`
        : `"${clash.name}" already exists.`
    );

  if (!draft.icon.trim()) errors.push('Pick an icon.');
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.color)) errors.push('Pick a colour.');

  return { ok: errors.length === 0, errors };
}

/** The row to insert for a new category. Slug is generated here, once. */
export function buildInsert(
  draft: CategoryDraft,
  existing: CategoryRecord[]
): Omit<CategoryRecord, 'id'> {
  return {
    slug: uniqueSlug(draft.name, existing.map((c) => c.slug)),
    name: draft.name.trim(),
    icon: draft.icon.trim(),
    color: draft.color,
    kind: draft.kind,
    // After everything that exists, so a new category does not jump the list.
    sort_order: existing.reduce((n, c) => Math.max(n, c.sort_order), -1) + 1,
    is_archived: false,
  };
}

export interface CategoryPatch {
  name?: string;
  icon?: string;
  color?: string;
  kind?: CategoryKind;
}

/**
 * The fields an edit changes. Never the slug.
 *
 * Only what actually differs, so a save that touched nothing writes nothing.
 */
export function buildUpdate(
  current: CategoryRecord,
  draft: CategoryDraft
): CategoryPatch {
  const patch: CategoryPatch = {};
  const name = draft.name.trim();
  const icon = draft.icon.trim();

  if (name !== current.name) patch.name = name;
  if (icon !== current.icon) patch.icon = icon;
  if (draft.color !== current.color) patch.color = draft.color;
  if (draft.kind !== current.kind) patch.kind = draft.kind;

  return patch;
}

/** 'keep' means the app itself depends on this one — see RESERVED_SLUGS. */
export type RetireAction = 'delete' | 'archive' | 'keep';

export interface RetirePlan {
  action: RetireAction;
  /** How many transactions currently point at it. */
  usageCount: number;
  /** One line, stating what will happen. */
  explanation: string;
}

/**
 * Delete or archive?
 *
 * A category with transactions is never deleted. `transactions.category_id` is
 * ON DELETE SET NULL, so deleting one silently drops the rows it held into
 * uncategorised — the totals stay right and the breakdown quietly loses a bar,
 * which is the worst kind of wrong. Clutter in a picker is cheap; unexplained
 * uncategorised rows are not.
 *
 * A category nothing points at carries no history, so deleting it is the
 * honest option and keeps the list short.
 */
export function planRetire(
  category: CategoryRecord,
  usageCount: number
): RetirePlan {
  // A reserved category is one the code names by slug. Retiring it does not
  // remove a choice from a picker, it removes something the app depends on
  // finding — the next count would have nowhere to file its adjustment.
  if ((RESERVED_SLUGS as readonly string[]).includes(category.slug))
    return {
      action: 'keep',
      usageCount,
      explanation: `${category.name} is used by the app itself and cannot be removed.`,
    };

  if (usageCount === 0)
    return {
      action: 'delete',
      usageCount,
      explanation: `Nothing uses ${category.name}. It will be deleted.`,
    };

  return {
    action: 'archive',
    usageCount,
    explanation: `${usageCount} ${
      usageCount === 1 ? 'transaction keeps' : 'transactions keep'
    } ${category.name}. It will be hidden from the picker, not deleted.`,
  };
}

/** How many transactions point at each category id. */
export function usageByCategory(
  rows: { category_id: string | null }[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  return counts;
}

/**
 * How many transactions an edit would reclassify.
 *
 * Changing a category's kind moves every row it holds between spending,
 * income and moved money — months of history restated by one dropdown. The
 * edit is allowed, because a category created with the wrong kind is otherwise
 * permanently wrong, but the count is shown first.
 */
export function reclassifyCount(
  current: CategoryRecord,
  draft: CategoryDraft,
  usageCount: number
): number {
  return draft.kind === current.kind ? 0 : usageCount;
}

/** Pickers show live categories; the manager shows everything. */
export function activeCategories(categories: CategoryRecord[]): CategoryRecord[] {
  return categories
    .filter((c) => !c.is_archived)
    .sort((a, b) => a.sort_order - b.sort_order);
}
