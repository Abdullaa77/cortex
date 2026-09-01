/**
 * The cutover: the line between reference and truth.
 *
 * Scott's ledger has a gap. Two months of notes were written before any of
 * this existed, and no amount of reconstruction will make them balance against
 * a physical count. The cutover is where that gets acknowledged once and left
 * behind, instead of being carried forward forever as a discrepancy that never
 * closes. Everything before it is REFERENCE — real, kept, still shown — and
 * everything from it onward is TRUTH, expected to reconcile against money you
 * can actually put your hands on.
 *
 * NOTHING HERE IS WIRED INTO A CALCULATION YET. Stage 1 stores the date and
 * derives the mark; Stage 2 is where the reconciliation starts drawing the
 * line. This file exists now so that when Stage 2 does, the answer to "is this
 * row before the cutover" already has exactly one implementation.
 *
 * DERIVED, NEVER STORED. There is no is_pre_cutover column on transactions,
 * deliberately: it would duplicate `occurred_at < cutover_date` and go stale
 * the moment the date was edited. Same rule the opening balance follows — one
 * source of truth, or the two drift.
 */

/** A row only needs its instant to be placed against the cutover. */
export interface DateableRow {
  occurred_at: string;
}

/**
 * Local calendar date of an instant, as YYYY-MM-DD.
 *
 * Local, not UTC, to match `monthKey` — a row must not be able to land in
 * August's bucket while reading as a July date. cutover_date is stored as a
 * DATE precisely because a cutover is a fact about a day, so the comparison is
 * made between two days rather than between a day and an instant.
 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`
  );
}

/**
 * Is this row before the cutover, and therefore reference rather than truth?
 *
 * No cutover set means nothing is pre-cutover — the default is that the whole
 * ledger is truth, and Scott opts into the line rather than inheriting it.
 *
 * The cutover day itself is NOT pre-cutover. The cutover is the day the count
 * was taken and the clean ledger starts, so it belongs to the truth side.
 */
export function isPreCutover(
  row: DateableRow,
  cutoverDate: string | null
): boolean {
  if (!cutoverDate) return false;
  return dayKey(row.occurred_at) < cutoverDate;
}

/**
 * Split rows into what the cutover makes reference and what it leaves as truth.
 *
 * Returned as one pass over the rows rather than two filters, because both
 * halves are always wanted together — the point of the line is the comparison
 * across it.
 */
export function splitAtCutover<T extends DateableRow>(
  rows: T[],
  cutoverDate: string | null
): { reference: T[]; truth: T[] } {
  const reference: T[] = [];
  const truth: T[] = [];
  for (const row of rows) {
    (isPreCutover(row, cutoverDate) ? reference : truth).push(row);
  }
  return { reference, truth };
}

/**
 * The instant to stamp on a row that belongs to a given day.
 *
 * The inverse of `dayKey`, and it lives beside it so the round trip cannot
 * drift: `dayKey(atLocalNoon(d)) === d` for every d, which is the property
 * that matters and the one a test pins.
 *
 * Noon rather than midnight. A checkpoint carries a DATE and the adjustment it
 * writes carries a TIMESTAMPTZ, so something has to choose an instant, and
 * midnight is the worst available choice: it sits exactly on the boundary
 * `dayKey` compares against, and in a timezone with a DST jump at midnight it
 * can land on the day before. Noon is twelve hours from either edge.
 */
export function atLocalNoon(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

/**
 * The day before a given day, YYYY-MM-DD.
 *
 * Built through UTC rather than local time. This is pure calendar arithmetic
 * on a written-down date, and routing it through a local Date would let a DST
 * jump return the same day twice — which, for a figure that opens a month,
 * would silently move where the ledger starts.
 */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return (
    `${t.getUTCFullYear()}-` +
    `${String(t.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(t.getUTCDate()).padStart(2, '0')}`
  );
}
