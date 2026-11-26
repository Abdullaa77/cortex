/**
 * The bot's scheduled voice: evening day-close (21:00 Tashkent), due-date
 * pings (09:00), and the "remind me in 1 h" follow-up. The schedule itself
 * lives outside (Supabase pg_cron -> POST /api/telegram/cron?job=...), so this
 * module only decides WHAT to say given the clock it is handed.
 */
import { timingSafeEqual } from 'node:crypto';
import { isAccountKey } from './accounts.ts';
import { tashkentDay, type Deps } from './handle.ts';
import { renderBalanceQuestion, renderDayClose, renderOwedDue } from './render.ts';

export const JOBS = ['dayclose', 'due', 'snooze'] as const;
export type Job = (typeof JOBS)[number];
export const isJob = (v: unknown): v is Job => (JOBS as readonly unknown[]).includes(v);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 25 Nov" for a YYYY-MM-DD day; also whether it is a Sunday. */
export function dayLabel(day: string): { label: string; sunday: boolean } {
  const d = new Date(`${day}T00:00:00Z`);
  return { label: `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`, sunday: d.getUTCDay() === 0 };
}

export function sameBearer(header: string | null, secret: string): boolean {
  const given = /^Bearer\s+(\S+)$/.exec(header ?? '')?.[1];
  if (!given || secret.length < 16) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function runJob(job: Job, deps: Deps, chatId: number): Promise<{ sent: number }> {
  const now = deps.now();
  const day = tashkentDay(now);
  let sent = 0;
  const say = async (r: Parameters<Deps['send']>[1]) => {
    await deps.send(chatId, r);
    sent++;
  };

  if (job === 'dayclose') {
    const s = await deps.rpc('bot_day_summary', { p_day: day });
    if (!s.ok) throw new Error('day_summary_failed');
    const { label, sunday } = dayLabel(day);
    // Mark the question open BEFORE asking, so a fast answer is never lost.
    const st = await deps.rpc('bot_state_set', { p_patch: { pendingBalance: 'cash', snoozeUntil: null } });
    if (!st.ok) throw new Error('state_failed');
    await say(renderDayClose({ dateLabel: label, totalMinor: Number(s.totalMinor), top: s.top ?? [], sunday }));
  }

  if (job === 'due') {
    const r = await deps.rpc('bot_owed_due', { p_day: day });
    if (!r.ok) throw new Error('owed_due_failed');
    for (const o of (r.due ?? []) as { person: string; openMinor: number }[])
      await say(renderOwedDue(o.person, Number(o.openMinor)));
  }

  if (job === 'snooze') {
    const c = await deps.rpc('bot_context');
    if (!c.ok) throw new Error('context_failed');
    const until = c.snoozeUntil ? Date.parse(String(c.snoozeUntil)) : NaN;
    if (Number.isFinite(until) && until <= now.getTime()) {
      // Clear first: a retry must not ask twice.
      await deps.rpc('bot_state_set', { p_patch: { snoozeUntil: null } });
      if (isAccountKey(c.pendingBalance)) await say(renderBalanceQuestion(c.pendingBalance));
    }
  }
  return { sent };
}
