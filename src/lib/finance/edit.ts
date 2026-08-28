/**
 * Turning an edited transaction row into a database patch.
 *
 * Pure, and separate from the component, because one of the decisions here is
 * load-bearing: when an imported row's date is edited to a real day,
 * date_precision has to flip from 'month' to 'day'. Miss that and the app goes
 * on printing "~" beside a date the user chose deliberately, and the promise
 * that a month-precision row never renders a day quietly becomes false. It is
 * a one-line rule that nothing in the UI would fail loudly about, which is
 * exactly the kind of rule that belongs in a tested function.
 *
 * The patch only ever contains fields that actually changed. Sending the whole
 * row back would rewrite occurred_at on every comment edit, and that alone
 * would flip precision on rows nobody touched.
 */

export type Direction = 'expense' | 'income';
export type DatePrecision = 'day' | 'month';

/** The subset of a transaction this module reads. */
export interface EditableRow {
  amount_minor: number;
  direction: Direction;
  comment: string;
  occurred_at: string;
  date_precision: DatePrecision;
}

/** What the form holds. Strings, because that is what inputs give back. */
export interface RowDraft {
  /** Major units as typed — "10120.29". Commas tolerated. */
  amount: string;
  direction: Direction;
  comment: string;
  /** "YYYY-MM-DD" from a date input, or "" to leave the date alone. */
  date: string;
  /** "HH:MM" from a time input, or "" for midnight. */
  time: string;
}

export interface RowPatch {
  amount_minor?: number;
  direction?: Direction;
  comment?: string;
  occurred_at?: string;
  date_precision?: DatePrecision;
  /**
   * Which account a row touched. Not produced by `buildRowPatch` — the edit
   * form does not ask, because capture does not ask either. These come from
   * the "needs the other side" queue, which is a different question asked in a
   * different place: not "what was this?" but "where did it go?".
   */
  from_account_id?: string | null;
  to_account_id?: string | null;
}

export interface BuildPatchResult {
  patch: RowPatch;
  /** Reasons the edit was rejected. Empty when the patch is safe to send. */
  errors: string[];
  /** True when this edit turns an imported month-only row into a real day. */
  precisionUpgraded: boolean;
}

/** Two digits, for building local datetime strings. */
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A row's stored instant as the local "YYYY-MM-DD" and "HH:MM" an input shows.
 *
 * Local, not UTC, throughout. The pickers work in the viewer's timezone and
 * `monthKey` buckets in the viewer's timezone, so converting through UTC here
 * would make an edit at 00:30 land in the previous day's bucket.
 */
export function toDraftDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** The draft a form should open with for a given row. */
export function toDraft(row: EditableRow): RowDraft {
  const { date, time } = toDraftDateTime(row.occurred_at);
  return {
    amount: (row.amount_minor / 100).toString(),
    direction: row.direction,
    comment: row.comment,
    date,
    time,
  };
}

/** "2026-08-14" + "13:05" -> an ISO instant in the viewer's timezone. */
export function fromDraftDateTime(date: string, time: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;

  const [hh, mm] = (time || '00:00').split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const instant = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/**
 * Build the patch for an edited row.
 *
 * Amount is validated because amount_minor carries a CHECK (> 0) and a
 * rejected write would roll the optimistic update back with no explanation.
 * Better to say why before sending it.
 */
export function buildRowPatch(row: EditableRow, draft: RowDraft): BuildPatchResult {
  const patch: RowPatch = {};
  const errors: string[] = [];

  const major = Number(draft.amount.replace(/[\s,]/g, ''));
  if (!Number.isFinite(major) || major <= 0) {
    errors.push('Amount must be a number above zero.');
  } else {
    const minor = Math.round(major * 100);
    if (minor !== row.amount_minor) patch.amount_minor = minor;
  }

  if (draft.direction !== row.direction) patch.direction = draft.direction;

  const comment = draft.comment.trim();
  if (comment !== row.comment) patch.comment = comment;

  const current = toDraftDateTime(row.occurred_at);
  const dateChanged = Boolean(draft.date) && draft.date !== current.date;
  const timeChanged = Boolean(draft.date) && (draft.time || '00:00') !== current.time;

  let precisionUpgraded = false;

  if (dateChanged || timeChanged) {
    const occurredAt = fromDraftDateTime(draft.date, draft.time);
    if (!occurredAt) {
      errors.push('That date could not be read.');
    } else {
      patch.occurred_at = occurredAt;
      // The point of this whole module. A person picking a day out of a
      // calendar is asserting the day; the row is no longer month-only.
      if (row.date_precision === 'month') {
        patch.date_precision = 'day';
        precisionUpgraded = true;
      }
    }
  }

  return {
    patch: errors.length > 0 ? {} : patch,
    errors,
    precisionUpgraded: errors.length > 0 ? false : precisionUpgraded,
  };
}
