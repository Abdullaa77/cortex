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
 * The household position on a given day, as one so'm figure.
 *
 * This is what the month rollforward opens from, and it is deliberately the
 * SAME derivation the positions list shows — `positionsAt` then
 * `householdTotal`, no second path. The two figures on /finance are meant to
 * be independent routes to the same number, and the way to keep that
 * meaningful is for the seed to be exact rather than approximately right.
 *
 * WHAT THIS REPLACED, AND WHY. It used to sum every account's FIRST-EVER
 * checkpoint and report the earliest of their dates as the as-of. Two things
 * were wrong with that, and both were live:
 *
 *   - An account's first checkpoint is not its opening for any month but the
 *     first. Once Main has been counted again at the cutover, its first
 *     checkpoint is a figure from two months ago, and the rollforward went on
 *     opening from it forever.
 *
 *   - A brand-new account counted at the cutover contributed its SEPTEMBER
 *     cash to a figure stamped 30 JUNE, because the as-of was the minimum
 *     across accounts. The July opening moved by the amount in his mother's
 *     drawer, and then two months of household spend were subtracted from it.
 *
 * The as-of is now the day that was asked for, and nothing else. A figure that
 * carries a date and is then applied somewhere else is worse than a figure
 * with no date at all: the audit trail states the wrong thing confidently.
 *
 * Null when nobody had been counted by that day, or when there are dollars and
 * no rate — the same two refusals `householdTotal` already makes, for the same
 * reason. A seed that guessed would put an invented figure under every month.
 */
export interface HouseholdSnapshot {
  amountMinor: number;
  /** The day this figure is a fact about. Never a different day. */
  asOf: string;
  /** Accounts left out: uncounted on that day, or dollars with no rate. */
  skippedAccounts: number;
}

export function householdAt(
  accounts: AccountRecord[],
  checkpoints: BalanceCheckpoint[],
  rows: MovementRow[],
  rate: FxRate | null,
  day: string
): HouseholdSnapshot | null {
  const positions = positionsAt(accounts, checkpoints, rows, day);
  const counted = positions.filter((p) => !p.uncounted);
  if (counted.length === 0) return null;

  const household = householdTotal(positions, rate);
  if (household.totalUzsMinor === null) return null;

  return {
    amountMinor: household.totalUzsMinor,
    asOf: day,
    skippedAccounts: household.uncounted.length,
  };
}
