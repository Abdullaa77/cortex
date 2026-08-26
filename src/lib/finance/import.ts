/**
 * Import: turn a paste of capture notes into transaction rows.
 *
 * Pure, like the parser and the categoriser. The CLI wrapper in
 * scripts/import-finance.mjs does the I/O and emits SQL.
 *
 * DATES. The real notes carry no per-line date — only `JULY` / `AUGUST`
 * section headers. So a row's month and its position within that month are
 * real, and its day is not. Rather than invent days, every row lands on the
 * first of its month, offset by one minute per line to preserve the order it
 * was written in, and carries date_precision = 'month'. Monthly rollups are
 * exact; a daily view must check date_precision and say it has no day data for
 * these rows rather than stacking a month of spending onto the 1st.
 */

import { parseLine, type ParseResult } from './parse.ts';
import { categorize, CATEGORY_BY_SLUG } from './categorize.ts';

export interface ImportRow {
  direction: 'expense' | 'income';
  amountMinor: number;
  currency: 'UZS';
  comment: string;
  rawInput: string;
  categorySlug: string | null;
  categorySource: 'inferred' | 'confirmed' | 'manual';
  needsReview: boolean;
  parseFlags: string[];
  occurredAt: string;
  /** How much of occurredAt is real. Imported rows only know their month. */
  datePrecision: 'day' | 'month';
  /** Set when a human decided this row, so it reads as a decision not a guess. */
  note?: string;
}

export interface ImportSummary {
  rows: ImportRow[];
  linesRead: number;
  skipped: string[];
  needsReview: number;
  byMonth: Map<string, { spendMinor: number; incomeMinor: number; transferMinor: number }>;
  spendByCategory: Map<string, Map<string, number>>;
}

/**
 * Decisions Scott made by hand, keyed by a distinctive substring of the raw
 * line. These are recorded as `manual` so they read as confirmed calls rather
 * than inferences, and nobody re-argues them in three months.
 */
export const CONFIRMED: readonly {
  match: string;
  categorySlug: string;
  note: string;
}[] = [
  {
    match: 'transferred to mom for 400$',
    categorySlug: 'transfer',
    note: 'Scott-confirmed 2026-08-27: money held, not spent. Transfer, not spending.',
  },
  {
    match: 'transferred to PersonD aka and got 100$ cash',
    categorySlug: 'transfer',
    note: 'Scott-confirmed 2026-08-27: change of form, not spending. Transfer.',
  },
  {
    match: 'transferred to Otabek aka and got 100$ cash',
    categorySlug: 'transfer',
    note: 'Scott-confirmed 2026-08-27: change of form, not spending. Transfer.',
  },
];

const MONTHS: Record<string, string> = {
  JANUARY: '01', FEBRUARY: '02', MARCH: '03', APRIL: '04',
  MAY: '05', JUNE: '06', JULY: '07', AUGUST: '08',
  SEPTEMBER: '09', OCTOBER: '10', NOVEMBER: '11', DECEMBER: '12',
};

function monthHeader(line: string): string | null {
  const key = line.replace(/[^A-Za-z]/g, '').toUpperCase();
  return MONTHS[key] ?? null;
}

/** First of the month, plus one minute per line, to keep the written order. */
function occurredAt(year: number, month: string, index: number): string {
  const base = Date.UTC(year, Number(month) - 1, 1, 0, 0, 0);
  return new Date(base + index * 60_000).toISOString();
}

export function buildImport(text: string, year: number): ImportSummary {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const rows: ImportRow[] = [];
  const skipped: string[] = [];
  let month: string | null = null;
  let indexInMonth = 0;

  for (const line of lines) {
    const header = monthHeader(line);
    if (header) {
      month = header;
      indexInMonth = 0;
      continue;
    }

    const parsed: ParseResult = parseLine(line);
    if (parsed.transactions.length === 0) {
      skipped.push(line);
      continue;
    }
    if (!month) {
      skipped.push(line);
      continue;
    }

    const flags = parsed.flags.map((f) => f.code);
    const confirmed = CONFIRMED.find((c) => line.includes(c.match));

    for (const txn of parsed.transactions) {
      const guess = categorize(txn.comment);
      const slug = confirmed ? confirmed.categorySlug : guess.slug;

      rows.push({
        direction: txn.direction,
        amountMinor: txn.amountMinor,
        currency: 'UZS',
        comment: txn.comment,
        rawInput: line,
        categorySlug: slug,
        categorySource: confirmed ? 'manual' : 'inferred',
        // A confirmed decision closes the question, even if the parser had
        // flagged the line. Otherwise: a parser flag OR no category at all.
        // Without the second half, "+200k cash" — the unnamed return leg of a
        // transfer — carries no flags, matches no rule, and silently counts as
        // income. An uncategorised row is exactly what a human should look at.
        needsReview: confirmed ? false : !parsed.ok || slug === null,
        parseFlags: flags,
        occurredAt: occurredAt(year, month, indexInMonth),
        // The notes carry no per-line date. Never claim a day we don't have.
        datePrecision: 'month',
        note: confirmed?.note,
      });
      indexInMonth++;
    }
  }

  const byMonth = new Map<string, { spendMinor: number; incomeMinor: number; transferMinor: number }>();
  const spendByCategory = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const key = row.occurredAt.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { spendMinor: 0, incomeMinor: 0, transferMinor: 0 });
    if (!spendByCategory.has(key)) spendByCategory.set(key, new Map());

    const kind = row.categorySlug
      ? CATEGORY_BY_SLUG.get(row.categorySlug)?.kind ?? 'expense'
      : 'expense';
    const bucket = byMonth.get(key)!;

    if (kind === 'transfer') {
      bucket.transferMinor += row.amountMinor;
    } else if (kind === 'income' || row.direction === 'income') {
      bucket.incomeMinor += row.amountMinor;
    } else {
      bucket.spendMinor += row.amountMinor;
      const cats = spendByCategory.get(key)!;
      const slug = row.categorySlug ?? '(uncategorised)';
      cats.set(slug, (cats.get(slug) ?? 0) + row.amountMinor);
    }
  }

  return {
    rows,
    linesRead: lines.length,
    skipped,
    needsReview: rows.filter((r) => r.needsReview).length,
    byMonth,
    spendByCategory,
  };
}

/** Single-quote escaping for the generated SQL. */
function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Emit a self-contained SQL script. Runs in the Supabase SQL editor, which
 * executes as the table owner and so bypasses RLS — user_id must be supplied
 * literally at the top.
 */
export function toSql(summary: ImportSummary, batchId: string): string {
  const out: string[] = [];
  out.push('-- Generated by scripts/import-finance.mjs. Review before running.');
  out.push('-- Set your user id, then execute. Re-running is safe: the batch id');
  out.push('-- is deleted first, so an import never double-counts.');
  out.push('');
  out.push('DO $$');
  out.push('DECLARE');
  out.push("  v_user UUID := 'PASTE-YOUR-AUTH-USER-ID-HERE';");
  out.push(`  v_batch UUID := '${batchId}';`);
  out.push('  v_area UUID;');
  out.push('BEGIN');
  out.push("  SELECT id INTO v_area FROM areas WHERE user_id = v_user AND name = 'Finance' LIMIT 1;");
  out.push('  DELETE FROM transactions WHERE user_id = v_user AND import_batch_id = v_batch;');
  out.push('');

  for (const row of summary.rows) {
    if (row.note) out.push(`  -- ${row.note}`);
    const category = row.categorySlug
      ? `(SELECT id FROM finance_categories WHERE user_id = v_user AND slug = ${q(row.categorySlug)})`
      : 'NULL';
    const flags = row.parseFlags.length
      ? `ARRAY[${row.parseFlags.map(q).join(', ')}]::TEXT[]`
      : `'{}'::TEXT[]`;
    out.push(
      '  INSERT INTO transactions (user_id, area_id, category_id, direction, amount_minor, ' +
        'currency, comment, raw_input, category_source, needs_review, parse_flags, occurred_at, ' +
        'date_precision, import_batch_id) VALUES ('
    );
    out.push(
      `    v_user, v_area, ${category}, ${q(row.direction)}, ${row.amountMinor}, ` +
        `${q(row.currency)}, ${q(row.comment)}, ${q(row.rawInput)}, ${q(row.categorySource)}, ` +
        `${row.needsReview}, ${flags}, ${q(row.occurredAt)}, ${q(row.datePrecision)}, v_batch);`
    );
  }

  out.push('END $$;');
  out.push('');
  return out.join('\n');
}
