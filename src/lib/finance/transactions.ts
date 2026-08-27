/**
 * Filtering, grouping and date presentation for the transactions list.
 *
 * Pure, same as the rest of src/lib/finance — the React path can't be checked
 * without a session, so the logic stays outside it.
 */

import { monthKey, monthLabel } from './format.ts';
import type { JoinedCategory } from './summarize.ts';

export interface TransactionRecord {
  id: string;
  amount_minor: number;
  currency: 'UZS' | 'USD';
  direction: 'expense' | 'income';
  comment: string;
  raw_input: string;
  category_id: string | null;
  category_source: 'inferred' | 'confirmed' | 'manual';
  needs_review: boolean;
  parse_flags: string[];
  occurred_at: string;
  date_precision: 'day' | 'month';
  finance_categories: JoinedCategory | null;
}

export interface TransactionFilters {
  month: string | null;
  categorySlug: string | null;
  flaggedOnly: boolean;
  uncategorisedOnly: boolean;
}

export const NO_FILTERS: TransactionFilters = {
  month: null,
  categorySlug: null,
  flaggedOnly: false,
  uncategorisedOnly: false,
};

export interface MonthGroup {
  key: string;
  label: string;
  rows: TransactionRecord[];
  /** Spending only — transfers and income are excluded, as everywhere else. */
  spendMinor: number;
}

/** True when this row counts as money spent, rather than moved or earned. */
export function isSpendRow(row: TransactionRecord): boolean {
  const kind = row.finance_categories?.kind ?? 'expense';
  if (kind === 'transfer' || kind === 'income') return false;
  return row.direction === 'expense';
}

export function filterTransactions(
  rows: TransactionRecord[],
  filters: TransactionFilters
): TransactionRecord[] {
  return rows.filter((row) => {
    if (filters.month && monthKey(row.occurred_at) !== filters.month) return false;
    if (filters.categorySlug && row.finance_categories?.slug !== filters.categorySlug)
      return false;
    if (filters.flaggedOnly && !row.needs_review) return false;
    if (filters.uncategorisedOnly && row.finance_categories !== null) return false;
    return true;
  });
}

/** Newest month first; rows inside a month stay newest first too. */
export function groupByMonth(rows: TransactionRecord[]): MonthGroup[] {
  const groups = new Map<string, TransactionRecord[]>();
  for (const row of rows) {
    const key = monthKey(row.occurred_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, groupRows]) => ({
      key,
      label: `${monthLabel(key)} ${key.slice(0, 4)}`,
      rows: [...groupRows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      spendMinor: groupRows.filter(isSpendRow).reduce((n, r) => n + r.amount_minor, 0),
    }));
}

/** Every month present, newest first — drives the month filter. */
export function availableMonths(rows: TransactionRecord[]): { key: string; label: string }[] {
  return [...new Set(rows.map((r) => monthKey(r.occurred_at)))]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ key, label: `${monthLabel(key)} ${key.slice(0, 4)}` }));
}

/** Every category present, for the category filter. */
export function availableCategories(
  rows: TransactionRecord[]
): { slug: string; name: string; color: string }[] {
  const seen = new Map<string, { slug: string; name: string; color: string }>();
  for (const row of rows)
    if (row.finance_categories)
      seen.set(row.finance_categories.slug, {
        slug: row.finance_categories.slug,
        name: row.finance_categories.name,
        color: row.finance_categories.color,
      });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface OccurredDisplay {
  text: string;
  /** True when only the month is real. The day must not be shown. */
  approximate: boolean;
}

/**
 * How to print a row's date.
 *
 * A row imported from the notes knows its month and nothing more. Rendering
 * "1 Aug" for it would invent a day that was never recorded, and would put a
 * month of spending on a single date. Those rows say "Aug 2026" instead.
 */
export function formatOccurred(row: TransactionRecord): OccurredDisplay {
  const date = new Date(row.occurred_at);

  if (row.date_precision === 'month')
    return {
      text: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      approximate: true,
    };

  return {
    text: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    approximate: false,
  };
}

export interface ListStats {
  shown: number;
  total: number;
  flagged: number;
  uncategorised: number;
  spendMinor: number;
}

export function listStats(
  all: TransactionRecord[],
  shown: TransactionRecord[]
): ListStats {
  return {
    shown: shown.length,
    total: all.length,
    flagged: all.filter((r) => r.needs_review).length,
    uncategorised: all.filter((r) => r.finance_categories === null).length,
    spendMinor: shown.filter(isSpendRow).reduce((n, r) => n + r.amount_minor, 0),
  };
}
