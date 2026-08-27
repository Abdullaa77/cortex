/**
 * Finance capture parser.
 *
 * Pure — no React, no Supabase, no I/O. Everything here is a function of the
 * raw line, so it can be run over a paste of Scott's phone Notes from a plain
 * script before any UI exists.
 *
 * Grammar (authoritative, per Scott):
 *   10k        -> 10,000
 *   10,120     -> 10,120      comma is a thousands separator
 *   10,120.29  -> 10,120.29   dot is tiyin
 *
 * Every transaction is UZS. Dollar figures in the text are purchased goods or
 * reference amounts ("for 400$", "API $10"), never the denomination — so a `$`
 * in a comment raises a flag, it never sets a currency.
 *
 * Amounts are stored as integer minor units at a uniform exponent of 2, i.e.
 * 1 so'm = 100 minor units. Never floats.
 */

export const MINOR_UNITS_EXPONENT = 2;
const MINOR_PER_MAJOR = 100;

export type Direction = 'expense' | 'income';
export type Currency = 'UZS' | 'USD';

export type FlagCode =
  /** No sign, but the wording reads as income. Never inferred — always asked. */
  | 'UNSIGNED_INCOME_SUSPECT'
  /** Sign and wording disagree in the other direction. */
  | 'SIGN_CONTRADICTS_WORDING'
  /** `4406,44` — comma used as a decimal, against the stated grammar. */
  | 'AMBIGUOUS_DECIMAL_COMMA'
  /** Interior `+` split into separate transactions. */
  | 'INTERIOR_PLUS_SPLIT'
  /** Interior `+` joined two purposes in one transaction. */
  | 'INTERIOR_PLUS_JOINED'
  /** More than one number on the line; only the leading one is the amount. */
  | 'MULTI_NUMBER'
  /** Reads as debt, a transfer, or a change of form rather than spending. */
  | 'TRANSFER_SUSPECT'
  /** A `$` figure appears in the comment. Reference only, never the currency. */
  | 'USD_REFERENCE'
  /** Bare amount under 1000 with no k/m suffix — probably shorthand. */
  | 'BARE_SMALL_AMOUNT'
  /** Parsed an amount but the comment is empty. */
  | 'EMPTY_COMMENT'
  /** No amount at all — a section header or a blank. */
  | 'NO_AMOUNT';

export interface ParseFlag {
  code: FlagCode;
  detail: string;
}

/**
 * Plain-language reason for each flag, for surfaces that show a stored
 * parse_flags array rather than a live ParseFlag. A flag should explain itself
 * — "MULTI_NUMBER" glowing on a row tells nobody anything.
 */
export const FLAG_EXPLANATIONS: Record<FlagCode, string> = {
  UNSIGNED_INCOME_SUSPECT: 'Reads like income but had no + sign, so it was booked as an expense.',
  SIGN_CONTRADICTS_WORDING: 'The sign says expense but the wording says income.',
  AMBIGUOUS_DECIMAL_COMMA: 'A comma was used as a decimal point, against the usual grammar.',
  INTERIOR_PLUS_SPLIT: 'One line held two amounts and was split into separate entries.',
  INTERIOR_PLUS_JOINED: 'A + joined two purposes inside a single amount.',
  MULTI_NUMBER: 'More than one number on the line — only the leading one became the amount.',
  TRANSFER_SUSPECT: 'Reads as debt, a repayment or cash changing form, rather than spending.',
  USD_REFERENCE: 'A $ figure appears in the comment. It is a reference, not the currency.',
  BARE_SMALL_AMOUNT: 'A bare number under 1000 with no k/m suffix — possibly shorthand.',
  EMPTY_COMMENT: 'An amount with nothing describing it.',
  NO_AMOUNT: 'No amount could be read from this line.',
};

/** Look up an explanation for a stored flag string, unknown codes included. */
export function explainFlag(code: string): string {
  return FLAG_EXPLANATIONS[code as FlagCode] ?? code;
}

export interface ParsedTransaction {
  direction: Direction;
  /** Integer minor units, exponent 2. */
  amountMinor: number;
  comment: string;
  /** The exact substring the amount came from. */
  amountSource: string;
  currency: Currency;
  /** True when the text named a currency, rather than falling back to UZS. */
  explicitCurrency: boolean;
  /** True when the amount carried a k or m suffix. */
  scaled: boolean;
}

export interface ParseResult {
  raw: string;
  /** True when nothing on this line needs a human decision. */
  ok: boolean;
  transactions: ParsedTransaction[];
  flags: ParseFlag[];
  /** Numbers found past the leading amount — prose, not transactions. */
  extraNumbers: string[];
}

/** Flags that mean the line cannot be imported without Scott looking at it. */
const BLOCKING: ReadonlySet<FlagCode> = new Set<FlagCode>([
  'UNSIGNED_INCOME_SUSPECT',
  'SIGN_CONTRADICTS_WORDING',
  'AMBIGUOUS_DECIMAL_COMMA',
  'INTERIOR_PLUS_SPLIT',
  'TRANSFER_SUSPECT',
  'BARE_SMALL_AMOUNT',
  'EMPTY_COMMENT',
  'NO_AMOUNT',
]);

/**
 * A number, in any shape the real text uses.
 *   1. grouped thousands, optional decimal:  87,549   4,850,000   41,948.5
 *   2. plain, optional decimal:              3043     8.5   4406,44
 * Ordered — grouped must win, or `87,549` parses as `87.549`.
 */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?`;
/**
 * Amount = number + optional k/m, which may be separated by a space ("75 k").
 * The suffix must not run into a word, or "87,549 korzinka" reads as 87,549k
 * and "10,200 metro" as 10,200m.
 */
const AMOUNT_HEAD = new RegExp(
  String.raw`^\s*(${NUMBER})(?:\s*([kKmM])(?![A-Za-z]))?`
);
const NUMBER_ANYWHERE = new RegExp(NUMBER, 'g');

/**
 * A currency marker. The captured corpus has none — every transaction in two
 * months is UZS, and the dollar figures in it are purchased goods or reference
 * amounts sitting inside comments. But the capture grammar has always allowed
 * "-$5 coffee", so a marker in the leading position names the currency; one
 * anywhere else is still just prose.
 */
const CURRENCY_HEAD = /^\s*\$\s*/;
const CURRENCY_TAIL = /^\s*(\$|usd)\b/i;

/** Does this text begin with something we would read as an amount? */
function startsWithAmount(text: string): boolean {
  return AMOUNT_HEAD.test(text.replace(CURRENCY_HEAD, ''));
}

// Deliberately narrow. A bare "gave" matches both "Muxlisa opa gave" (income)
// and "gave to Lochin aka" (expense), so it earns its place on neither list.
const INCOME_WORDS = [
  'salary', 'avans', 'cashback', 'sent back', 'got cash',
  'got debt', 'balance of salary', 'refund',
];
const TRANSFER_WORDS = [
  'debt', 'sent back', 'exchanged', 'transferred', 'sent to', 'gave cash',
  'he sent back', 'he gave cash', 'got cash', 'to cash', 'got debt',
];

function containsAny(haystack: string, needles: readonly string[]): string | null {
  const low = haystack.toLowerCase();
  for (const n of needles) if (low.includes(n)) return n;
  return null;
}

/**
 * Convert a matched number + scale suffix into integer minor units.
 * Returns null when the text isn't a number we understand.
 */
export function toMinorUnits(
  numberText: string,
  scale?: string
): { minor: number; commaDecimal: boolean } | null {
  const groupedThousands = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numberText);
  // A comma is a decimal point only when it isn't separating thousands —
  // `4406,44` has two digits after it, `4,850,000` has three-digit groups.
  const commaDecimal = !groupedThousands && numberText.includes(',');

  const normalized = groupedThousands
    ? numberText.replace(/,/g, '')
    : numberText.replace(',', '.');

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  const multiplier = scale ? (scale.toLowerCase() === 'm' ? 1_000_000 : 1_000) : 1;

  // Scale in minor units so 8.5k lands on 850000 exactly, with no float dust.
  const minor = Math.round(value * MINOR_PER_MAJOR) * multiplier;
  return { minor, commaDecimal };
}

/**
 * Should an interior `+` split the line into two transactions?
 * Yes only when a number follows it — `13,713(...) + 38,500(taxi)` is two
 * purchases, but `bus+ metro` and `osh+ somsa` are one purchase with two parts.
 */
function splitOnInteriorPlus(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < body.length; i++) {
    if (body[i] !== '+') continue;
    const after = body.slice(i + 1);
    if (!startsWithAmount(after)) continue;
    parts.push(body.slice(start, i));
    start = i + 1;
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSegment(
  segment: string,
  direction: Direction
): { txn: ParsedTransaction; flags: ParseFlag[]; extraNumbers: string[] } | null {
  let rest = segment;
  let currency: Currency = 'UZS';
  let explicitCurrency = false;

  const head = CURRENCY_HEAD.exec(rest);
  if (head) {
    currency = 'USD';
    explicitCurrency = true;
    rest = rest.slice(head[0].length);
  }

  const match = AMOUNT_HEAD.exec(rest);
  if (!match) return null;

  const [matched, numberText, scale] = match;
  const converted = toMinorUnits(numberText, scale);
  if (!converted) return null;

  const flags: ParseFlag[] = [];
  let after = rest.slice(matched.length);

  if (!explicitCurrency) {
    const tail = CURRENCY_TAIL.exec(after);
    if (tail) {
      currency = 'USD';
      explicitCurrency = true;
      after = after.slice(tail[0].length);
    }
  }

  const comment = after.trim();

  if (converted.commaDecimal) {
    flags.push({
      code: 'AMBIGUOUS_DECIMAL_COMMA',
      detail: `"${numberText}" uses a comma as a decimal point, against the stated grammar`,
    });
  }

  if (!scale && converted.minor < 1000 * MINOR_PER_MAJOR) {
    flags.push({
      code: 'BARE_SMALL_AMOUNT',
      detail: `"${numberText}" has no k/m suffix and is under 1000`,
    });
  }

  if (!comment) {
    flags.push({ code: 'EMPTY_COMMENT', detail: 'amount with no description' });
  }

  const extraNumbers = (comment.match(NUMBER_ANYWHERE) ?? []).slice();
  if (extraNumbers.length > 0) {
    flags.push({
      code: 'MULTI_NUMBER',
      detail: `extra numbers in the comment: ${extraNumbers.join(', ')}`,
    });
  }

  if (/\$/.test(comment)) {
    flags.push({
      code: 'USD_REFERENCE',
      detail: 'a $ figure appears in the comment — reference only, currency stays UZS',
    });
  }

  const transferWord = containsAny(comment, TRANSFER_WORDS);
  if (transferWord) {
    flags.push({
      code: 'TRANSFER_SUSPECT',
      detail: `reads as debt/transfer ("${transferWord}"), not spending`,
    });
  }

  return {
    txn: {
      direction,
      amountMinor: converted.minor,
      comment,
      amountSource: matched.trim(),
      currency,
      explicitCurrency,
      scaled: Boolean(scale),
    },
    flags,
    extraNumbers,
  };
}

/**
 * Parse one line of captured text.
 *
 * Sign rule: a leading `+` is income, anything else is an expense. Wording is
 * never allowed to override that — when the two disagree the line is flagged
 * for a human instead.
 */
export function parseLine(raw: string): ParseResult {
  const line = raw.trim();

  if (!line || /^[A-Za-z]+:?$/.test(line)) {
    return {
      raw,
      ok: false,
      transactions: [],
      flags: [{ code: 'NO_AMOUNT', detail: 'section header or blank line' }],
      extraNumbers: [],
    };
  }

  const signMatch = /^([+-])\s*/.exec(line);
  const explicitSign = signMatch ? signMatch[1] : null;
  const direction: Direction = explicitSign === '+' ? 'income' : 'expense';
  const body = signMatch ? line.slice(signMatch[0].length) : line;

  const segments = splitOnInteriorPlus(body);
  const flags: ParseFlag[] = [];
  const transactions: ParsedTransaction[] = [];
  const extraNumbers: string[] = [];

  if (segments.length > 1) {
    flags.push({
      code: 'INTERIOR_PLUS_SPLIT',
      detail: `split into ${segments.length} transactions; any trailing words apply to both`,
    });
  } else if (body.slice(1).includes('+')) {
    flags.push({
      code: 'INTERIOR_PLUS_JOINED',
      detail: 'interior + joins two purposes in one transaction',
    });
  }

  for (const segment of segments) {
    const parsed = parseSegment(segment, direction);
    if (!parsed) continue;
    transactions.push(parsed.txn);
    flags.push(...parsed.flags);
    extraNumbers.push(...parsed.extraNumbers);
  }

  if (transactions.length === 0) {
    return {
      raw,
      ok: false,
      transactions: [],
      flags: [{ code: 'NO_AMOUNT', detail: 'no leading amount found' }],
      extraNumbers: [],
    };
  }

  // Sign vs wording. Income vocabulary on an unsigned line is the "4,625,000
  // salary (July)" case — surfaced, never resolved automatically.
  const wholeComment = transactions.map((t) => t.comment).join(' ');
  const incomeWord = containsAny(wholeComment, INCOME_WORDS);
  if (incomeWord && explicitSign !== '+') {
    flags.push({
      code: explicitSign === '-' ? 'SIGN_CONTRADICTS_WORDING' : 'UNSIGNED_INCOME_SUSPECT',
      detail: `wording says income ("${incomeWord}") but the sign says expense`,
    });
  }

  const deduped = new Map<string, ParseFlag>();
  for (const f of flags) deduped.set(`${f.code}|${f.detail}`, f);
  const finalFlags = [...deduped.values()];

  return {
    raw,
    ok: !finalFlags.some((f) => BLOCKING.has(f.code)),
    transactions,
    flags: finalFlags,
    extraNumbers,
  };
}

/** Parse a whole paste. Blank lines and section headers come back flagged. */
export function parseNotes(text: string): ParseResult[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(parseLine);
}

/** Format integer minor units back to human text, for reports and review UI. */
export function formatMinor(minor: number): string {
  const major = Math.trunc(minor / MINOR_PER_MAJOR);
  const frac = Math.abs(minor % MINOR_PER_MAJOR);
  const grouped = major.toLocaleString('en-US');
  return frac === 0 ? grouped : `${grouped}.${String(frac).padStart(2, '0')}`;
}
