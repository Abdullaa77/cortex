/**
 * One Telegram update -> database calls and replies. All I/O comes in through
 * `Deps`, so the whole conversation is testable without Telegram or Supabase.
 *
 * The bot saves first and lets Scott fix with buttons. Every database door is
 * token-checked inside Postgres (migration 021); this module never sees a key.
 */
import { reconcileCount } from '../finance/checkpoints.ts';
import { ACCOUNT_KEYS, isAccountKey, type AccountKey } from './accounts.ts';
import { decode } from './callbacks.ts';
import {
  decideMessage,
  matchOwed,
  resolveLine,
  type BotContext,
  type Decision,
  type OwedRef,
  type TxnDraft,
} from './intent.ts';
import type { Incoming } from './update.ts';
import {
  renderBalanceQuestion,
  renderCategoryMenu,
  renderGap,
  renderMoveTo,
  renderOwedAsk,
  renderOwedReduced,
  renderTxn,
  renderUndone,
  type MenuCategory,
  type Reply,
  type TxnView,
} from './render.ts';

type J = Record<string, any>;

export interface Deps {
  /** Calls a bot_* RPC with the token already attached. Returns the jsonb body. */
  rpc(fn: string, args?: J): Promise<J>;
  send(chatId: number, reply: Reply): Promise<void>;
  edit(chatId: number, messageId: number, reply: Reply): Promise<void>;
  answer(callbackId: string): Promise<void>;
  now(): Date;
}

const TASHKENT_OFFSET_MS = 5 * 3600_000;
/** YYYY-MM-DD in Tashkent (UTC+5, no DST). */
export const tashkentDay = (d: Date) => new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);

const FAIL: Reply = { text: 'Something went wrong — nothing was changed. Try again.', buttons: [] };
const NOT_FOUND: Reply = { text: 'That one is already done or gone.', buttons: [] };

interface Loaded {
  ctx: BotContext;
  cats: MenuCategory[];
}

async function load(deps: Deps): Promise<Loaded | null> {
  const r = await deps.rpc('bot_context');
  if (!r.ok) return null;
  return {
    ctx: {
      learned: new Map(Object.entries((r.learned ?? {}) as Record<string, string>)),
      owed: (r.owed ?? []) as OwedRef[],
      pendingBalance: isAccountKey(r.pendingBalance) ? r.pendingBalance : null,
    },
    cats: (r.categories ?? []) as MenuCategory[],
  };
}

const toRpcDraft = (d: TxnDraft) => ({
  direction: d.direction,
  amount_minor: d.amountMinor,
  comment: d.comment,
  category_slug: d.categorySlug,
  account: d.account,
});

/** Run one decision. `target` set = edit the message the user tapped instead of sending a new one. */
async function perform(
  deps: Deps,
  chatId: number,
  d: Decision,
  raw: string,
  loaded: Loaded,
  target?: number
): Promise<void> {
  const show = (r: Reply) => (target ? deps.edit(chatId, target, r) : deps.send(chatId, r));

  switch (d.type) {
    case 'say':
      return show(d.reply);

    case 'save': {
      const r = await deps.rpc('bot_capture', { p_raw: raw, p_drafts: d.drafts.map(toRpcDraft) });
      if (!r.ok) return show(FAIL);
      const views = r.saved as TxnView[];
      for (let i = 0; i < views.length; i++)
        await (i === 0 ? show : (x: Reply) => deps.send(chatId, x))(renderTxn(views[i], loaded.cats));
      // An income line naming someone who owes Scott: ask, never assume.
      for (const draft of d.drafts) {
        if (draft.direction !== 'income') continue;
        const owed = matchOwed(draft.comment, loaded.ctx.owed);
        if (!owed) continue;
        const p = await deps.rpc('bot_pending_put', {
          p_kind: 'owed',
          p_raw: raw,
          p_payload: { owedId: owed.id, person: owed.person, amountMinor: draft.amountMinor },
        });
        if (p.ok) await deps.send(chatId, renderOwedAsk(p.id, owed.person));
      }
      return;
    }

    case 'ask': {
      const p = await deps.rpc('bot_pending_put', {
        p_kind: d.kind,
        p_raw: raw,
        p_payload: d.move ?? {},
      });
      if (!p.ok) return show(FAIL);
      return show(d.render(p.id));
    }

    case 'balance': {
      const inputs = await deps.rpc('bot_balance_inputs', { p_account: d.account });
      if (!inputs.ok) return show(FAIL);
      const day = tashkentDay(deps.now());
      // Reconcile BEFORE storing: the new count must not be its own basis.
      const result = reconcileCount(inputs.accountId, inputs.checkpoints, inputs.rows, day, d.countedMinor);
      const saved = await deps.rpc('bot_checkpoint', { p_account: d.account, p_counted_minor: d.countedMinor, p_day: day });
      if (!saved.ok) return show(FAIL);
      // Sunday: after each count, ask the next account (cash, then every card).
      const next = new Date(`${day}T00:00:00Z`).getUTCDay() === 0 ? ACCOUNT_KEYS[ACCOUNT_KEYS.indexOf(d.account) + 1] : undefined;
      const adv = await deps.rpc('bot_state_set', { p_patch: { pendingBalance: next ?? null, snoozeUntil: null } });
      if (!adv.ok) return show(renderGap(d.account, d.countedMinor, result.gapMinor));
      await show(renderGap(d.account, d.countedMinor, result.gapMinor));
      if (next) await deps.send(chatId, renderBalanceQuestion(next));
      return;
    }
  }
}

export async function handleMessage(deps: Deps, chatId: number, text: string): Promise<void> {
  const loaded = await load(deps);
  if (!loaded) return deps.send(chatId, FAIL);
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const decisions = decideMessage(text, loaded.ctx);
  // Only the first line may answer an open balance question; the rest are decided without it.
  const rest = decisions.length > 1 ? decideMessage(lines.slice(1).join('\n'), { ...loaded.ctx, pendingBalance: null }) : [];
  const all = [decisions[0], ...rest].filter(Boolean);
  for (let i = 0; i < all.length; i++) {
    await perform(deps, chatId, all[i], lines[i] ?? text.trim(), loaded);
  }
}

export async function handleCallback(
  deps: Deps,
  chatId: number,
  messageId: number,
  data: string
): Promise<void> {
  const op = decode(data);
  if (!op) return;
  const loaded = await load(deps);
  if (!loaded) return deps.edit(chatId, messageId, FAIL);
  const edit = (r: Reply) => deps.edit(chatId, messageId, r);
  const fromRpc = (r: J, ok: (r: J) => Reply) => edit(r.ok ? ok(r) : r.error === 'not_found' ? NOT_FOUND : FAIL);

  switch (op.op) {
    case 'undo':
      return fromRpc(await deps.rpc('bot_undo', { p_txn: op.txn }), () => renderUndone());

    case 'menu':
      return edit(renderCategoryMenu(op.txn, loaded.cats));

    case 'category':
      return fromRpc(await deps.rpc('bot_set_category', { p_txn: op.txn, p_slug: op.slug }), (r) =>
        renderTxn(r.txn as TxnView, loaded.cats)
      );

    case 'account':
      return fromRpc(await deps.rpc('bot_set_account', { p_txn: op.txn, p_account: op.account }), (r) =>
        renderTxn(r.txn as TxnView, loaded.cats)
      );

    case 'snooze': {
      const until = new Date(deps.now().getTime() + 3600_000).toISOString();
      const r = await deps.rpc('bot_state_set', { p_patch: { snoozeUntil: until } });
      return edit(r.ok ? { text: 'OK, I will ask again in an hour.', buttons: [] } : FAIL);
    }

    case 'moveFrom': {
      const got = await deps.rpc('bot_pending_get', { p_id: op.pending });
      if (!got.ok) return edit(got.error === 'not_found' ? NOT_FOUND : FAIL);
      const patched = await deps.rpc('bot_pending_patch', { p_id: op.pending, p_patch: { from: op.account } });
      if (!patched.ok) return edit(FAIL);
      return edit(renderMoveTo(op.pending, Number(got.payload?.amountMinor), op.account));
    }

    case 'moveTo': {
      // Look first: a bad tap must not burn the pending. Then claim, so a double tap moves money once.
      const peek = await deps.rpc('bot_pending_get', { p_id: op.pending });
      if (!peek.ok) return edit(peek.error === 'not_found' ? NOT_FOUND : FAIL);
      const peekFrom = peek.payload?.from as AccountKey | undefined;
      if (!peekFrom || !isAccountKey(peekFrom) || peekFrom === op.account) return edit(FAIL);
      const got = await deps.rpc('bot_pending_resolve', { p_id: op.pending });
      if (!got.ok) return edit(got.error === 'not_found' ? NOT_FOUND : FAIL);
      const from = peekFrom;
      const r = await deps.rpc('bot_move', {
        p_raw: got.raw,
        p_amount_minor: Number(got.payload.amountMinor),
        p_comment: String(got.payload.comment ?? ''),
        p_from: from,
        p_to: op.account,
      });
      if (!r.ok) {
        // Only 'invalid' means the database refused and rolled back. Any other failure (lost
        // connection, timeout) may have saved the move, so a retry button could move it twice.
        if (r.error !== 'invalid') {
          return edit({ text: 'Not sure that went through. Check the balance before trying again.', buttons: [] });
        }
        // The claim above burned the pending; put it back so one more tap can finish the move.
        const back = await deps.rpc('bot_pending_put', { p_kind: 'move', p_raw: got.raw, p_payload: got.payload });
        if (!back.ok) return edit(FAIL);
        const again = renderMoveTo(String(back.id), Number(got.payload.amountMinor), from);
        return edit({ ...again, text: `That did not go through — nothing was moved. Try again.\n${again.text}` });
      }
      return edit(renderTxn((r.saved as TxnView[])[0], loaded.cats));
    }

    case 'pending': {
      const got = await deps.rpc('bot_pending_resolve', { p_id: op.pending });
      if (!got.ok) return edit(got.error === 'not_found' ? NOT_FOUND : FAIL);

      if (got.kind === 'owed') {
        if (op.choice !== 'yes') return edit({ text: 'OK, left as it was.', buttons: [] });
        const paid = Number(got.payload?.amountMinor);
        const r = await deps.rpc('bot_owed_reduce', { p_id: got.payload?.owedId, p_paid_minor: paid });
        if (!r.ok) return edit(FAIL);
        const left = Math.max(0, Number(r.openMinor ?? 0));
        return edit(renderOwedReduced(String(got.payload?.person ?? r.person), paid, left));
      }

      return perform(deps, chatId, resolveLine(got.raw, op.choice, loaded.ctx), got.raw, loaded, messageId);
    }
  }
}

export async function handleIncoming(deps: Deps, incoming: Incoming): Promise<void> {
  if (incoming.kind === 'message') return handleMessage(deps, incoming.chatId, incoming.text);
  if (incoming.kind === 'callback') {
    try {
      await handleCallback(deps, incoming.chatId, incoming.messageId, incoming.data);
    } finally {
      // Always stop the button spinner, even when the work failed.
      await deps.answer(incoming.callbackId).catch(() => undefined);
    }
  }
}
