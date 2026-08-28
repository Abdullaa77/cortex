/**
 * Where the money is, right now, in every container it is in.
 *
 * `checkpoints.ts` answers "what does this one account hold". This adds them
 * up, and the adding up is where the honesty has to be defended, because two
 * things can go quietly wrong at exactly this step.
 *
 * The first is treating uncounted as zero. An account nobody has counted holds
 * an unknown amount, and folding a null into a sum turns "I don't know" into
 * "nothing", which is a lie the total then carries silently forever. Uncounted
 * accounts are listed, never summed.
 *
 * The second is averaging currencies. Positions stay NATIVE — som with som,
 * dollars with dollars — and the household figure is a single, explicit
 * conversion at a rate a person typed in, stated alongside the result with the
 * date it was set. No live FX fetch: a rate that moves on its own makes
 * yesterday's total unreproducible, and Scott changes money at a counter, at a
 * rate he knows. A household total that does not name its rate is not a
 * figure, it is a mood.
 */

import {
  balanceAt,
  type BalanceCheckpoint,
  type DerivedBalance,
  type MovementRow,
} from './checkpoints.ts';
import { activeAccounts, type AccountRecord, type AccountCurrency, type AccountOwner } from './accounts.ts';
import { dayKey } from './cutover.ts';

export interface AccountPosition {
  account: AccountRecord;
  balance: DerivedBalance;
  /** True when nobody has counted this account on or before the day asked for. */
  uncounted: boolean;
  /** Days since the count this position rests on. Null when uncounted. */
  daysSinceCount: number | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two YYYY-MM-DD days. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY
  );
}

/** Today, in the same YYYY-MM-DD shape checkpoints are stored in. */
export function today(): string {
  return dayKey(new Date().toISOString());
}

/**
 * Every active account's position on a given day, in display order.
 *
 * Retired accounts are left out: they are kept so history can still point at
 * them, not so they can go on claiming to hold something.
 *
 * Nothing here needs to know about the cutover, and that is a property of the
 * model rather than an oversight. Checkpoint #0 is written during the cutover
 * sitting, and `balanceAt` counts only rows dated strictly after the count it
 * rests on — so every pre-cutover row is already excluded from current-position
 * math, by the same rule that excludes anything else the count superseded. The
 * reference rows stay visible in the list; they simply do not get a second
 * vote on what is in the drawer.
 */
export function positionsAt(
  accounts: AccountRecord[],
  checkpoints: BalanceCheckpoint[],
  rows: MovementRow[],
  day: string
): AccountPosition[] {
  return activeAccounts(accounts).map((account) => {
    const balance = balanceAt(account.id, checkpoints, rows, day);
    return {
      account,
      balance,
      uncounted: balance.basis === null,
      daysSinceCount: balance.basis ? daysBetween(balance.basis.counted_at, day) : null,
    };
  });
}

export interface CurrencyTotal {
  currency: AccountCurrency;
  /** Sum of the counted accounts in this currency. Native units. */
  minor: number;
  /** How many accounts contributed. */
  countedAccounts: number;
  /** How many were left out because nobody has counted them. */
  uncountedAccounts: number;
}

export interface OwnerTotal {
  owner: AccountOwner;
  byCurrency: CurrencyTotal[];
}

export interface FxRate {
  /** So'm per one dollar, in tiyin. 12,650 so'm/$ is 1_265_000. */
  uzsPerUsdMinor: number;
  /** The day it was entered. Shown so its age is visible. */
  setAt: string;
}

export interface HouseholdTotal {
  byCurrency: CurrencyTotal[];
  byOwner: OwnerTotal[];
  /**
   * Everything, in so'm, at the stated rate.
   *
   * NULL when there are dollars to convert and no rate to convert them at.
   * Not "the som part on its own" — that would be a smaller number wearing the
   * label of the whole, which is worse than no number.
   */
  totalUzsMinor: number | null;
  /** The som contribution of the dollar positions, at that rate. */
  convertedUzsMinor: number;
  /** The rate used, echoed so the total can state it. Null when none is set. */
  rate: FxRate | null;
  /** True when a rate is the only thing standing between here and a total. */
  needsRate: boolean;
  /** Accounts left out of every figure above, because nobody has counted them. */
  uncounted: AccountPosition[];
}

/** Dollars (in cents) to so'm (in tiyin), at a stated rate. */
export function convertUsdToUzs(usdMinor: number, rate: FxRate): number {
  // usdMinor / 100 is dollars; dollars * uzsPerUsdMinor is tiyin. Written as
  // one expression so the division happens once, at the end, against a single
  // rounding.
  return Math.round((usdMinor * rate.uzsPerUsdMinor) / 100);
}

const CURRENCIES: AccountCurrency[] = ['UZS', 'USD'];
const OWNERS: AccountOwner[] = ['me', 'mom', 'sister'];

function totalsFor(positions: AccountPosition[]): CurrencyTotal[] {
  return CURRENCIES.map((currency) => {
    const mine = positions.filter((p) => p.account.currency === currency);
    return {
      currency,
      minor: mine.reduce((n, p) => n + (p.balance.minor ?? 0), 0),
      countedAccounts: mine.filter((p) => !p.uncounted).length,
      uncountedAccounts: mine.filter((p) => p.uncounted).length,
    };
  }).filter((t) => t.countedAccounts + t.uncountedAccounts > 0);
}

/**
 * The household position: native totals per currency, and one figure in so'm.
 *
 * Uncounted accounts contribute nothing to any total and are handed back
 * separately, so the page can say "these three add up to X, and nobody has
 * counted the fourth" rather than quietly presenting X as everything.
 */
export function householdTotal(
  positions: AccountPosition[],
  rate: FxRate | null
): HouseholdTotal {
  const byCurrency = totalsFor(positions);
  const byOwner = OWNERS.map((owner) => ({
    owner,
    byCurrency: totalsFor(positions.filter((p) => p.account.owner === owner)),
  })).filter((o) => o.byCurrency.length > 0);

  const uzs = byCurrency.find((t) => t.currency === 'UZS');
  const usd = byCurrency.find((t) => t.currency === 'USD');

  const hasDollars = (usd?.countedAccounts ?? 0) > 0;
  const convertedUzsMinor = usd && rate ? convertUsdToUzs(usd.minor, rate) : 0;
  const needsRate = hasDollars && rate === null;

  return {
    byCurrency,
    byOwner,
    totalUzsMinor: needsRate ? null : (uzs?.minor ?? 0) + convertedUzsMinor,
    convertedUzsMinor,
    rate,
    needsRate,
    uncounted: positions.filter((p) => p.uncounted),
  };
}

/**
 * The household's opening balance, for the month reconciliation.
 *
 * /finance still walks the months from a single opening figure, and that
 * figure now comes from the counts rather than from a table of its own — it is
 * the sum of every account's FIRST checkpoint, as of the earliest of them.
 * Same arithmetic the page has always run, one fewer source of truth behind
 * it.
 *
 * Dollar accounts are converted at the stated rate, and without a rate they
 * are left out entirely rather than added in raw — a dollar counted as a som
 * would move the opening by a factor of twelve thousand, which is precisely
 * the averaging this file exists to refuse. The count of what was skipped
 * comes back so the page can say so.
 */
export function openingFromCheckpoints(
  accounts: AccountRecord[],
  checkpoints: BalanceCheckpoint[],
  rate: FxRate | null
): { amountMinor: number; asOf: string; skippedAccounts: number } | null {
  const firsts = new Map<string, BalanceCheckpoint>();
  for (const c of checkpoints) {
    const held = firsts.get(c.account_id);
    if (!held || c.counted_at < held.counted_at) firsts.set(c.account_id, c);
  }
  if (firsts.size === 0) return null;

  const byId = new Map(accounts.map((a) => [a.id, a]));
  let amountMinor = 0;
  let skippedAccounts = 0;
  let asOf: string | null = null;

  for (const [accountId, checkpoint] of firsts) {
    const account = byId.get(accountId);
    // A checkpoint whose account is gone should be impossible — the column is
    // ON DELETE CASCADE — but a page holding a stale array is not, and adding
    // an amount of unknown currency is the one thing worth refusing outright.
    if (!account) {
      skippedAccounts++;
      continue;
    }
    if (account.currency === 'USD') {
      if (!rate) {
        skippedAccounts++;
        continue;
      }
      amountMinor += convertUsdToUzs(checkpoint.counted_minor, rate);
    } else {
      amountMinor += checkpoint.counted_minor;
    }
    if (!asOf || checkpoint.counted_at < asOf) asOf = checkpoint.counted_at;
  }

  if (asOf === null) return null;
  return { amountMinor, asOf, skippedAccounts };
}
