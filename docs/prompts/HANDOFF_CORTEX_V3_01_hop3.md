# Handoff — Cortex v3 phase 1 (Telegram expenses), hop 3

Spec (authoritative): `docs/prompts/CC_PROMPT_CORTEX_V3_01_TELEGRAM_EXPENSES.md`. Previous: `HANDOFF_CORTEX_V3_01_hop2.md` (read its design facts + gotchas + gates; still valid).
Branch `feat/telegram-expenses`, worktree `/home/abdulloh/dev/projects/cortex-wt-telegram` (keep until PR done; I symlinked `node_modules -> ../cortex/node_modules`, git-ignored, needed for PGlite).

## Done this hop
- Step 3 committed: `supabase/migrations/021_telegram_bot.sql` + `src/lib/telegram/bot-db.db.test.ts` — **13/13 green** (`node --test src/lib/telegram/bot-db.db.test.ts`; runs real 005–010 + 013 + 021 in PGlite).
- Tables: `ops_private.bot_tokens | bot_account_keys | bot_pending | bot_state`, `public.bot_owed` (owner SELECT RLS).
- RPCs (all `(p_token, ...)`, return jsonb `{ok,...}`/`{ok:false,error}`; anon-callable): `bot_capture(token, raw, drafts jsonb[{direction,amount_minor,comment,category_slug,account,flags?}])` → `{saved:[TxnView]}`; `bot_move(token, raw, amount_minor, comment, from, to)`; `bot_undo(token, txn)`; `bot_set_category(token, txn, slug)` (learns rule); `bot_set_account(token, txn, key)`; `bot_checkpoint(token, key, counted_minor, day)`; `bot_balance_inputs(token, key)` → `{accountId, checkpoints, rows}` for `reconcileCount`; `bot_context(token)` → `{learned{key:slug}, categories, owed[{id,person,openMinor}], pendingBalance, snoozeUntil}`; `bot_day_summary(token, day)` → `{totalMinor, top}`; `bot_state_set(token, patch{pendingBalance?,snoozeUntil?})`; `bot_pending_put(token, kind, raw, payload)` → `{id}` / `_get` / `_resolve` (atomic claim) / `_patch` (merge payload, for move 2-tap); `bot_owed_add/_reduce/_due`.
- TxnView returned = `{id, direction expense|income|move, amountMinor, categorySlug, account, toAccount?}` (matches render.ts).
- Note: bigints come back as JSON numbers from jsonb (fine < 2^53). `rows` in balance_inputs have only id, amount_minor, occurred_at, from/to_account_id.

## Still to do on step 3
- **prove-it**: mutate-RED the guards (drop token check in one RPC; drop `user_id` filter in `bot_undo`; drop REVOKE) → test must fail; revert. Not done yet.
- **Stop for Scott**: he pastes 021 into the Supabase SQL editor. Give him exact steps incl. token insert + `bot_account_keys` inserts (the 5 accounts must exist first in `accounts`; the starting-data script step 7 can create them). Never ask for the token in chat.
- Spec said migration "018"; real number is 021 (spec text stale, mention in PR).

## Next (steps 4–8 unchanged from hop2)
4. Webhook route `POST /api/telegram/webhook` + middleware exemption (copy `api/ops/ingest`, `src/lib/ops/door.ts`); route wires `parseUpdate` → `bot_context` → `decideMessage`/callbacks → RPCs → `sendMessage` fetch. 5. Cron route (check Vercel cron precision with Context7). 6. Mini app home + initData HMAC. 7. Starting-data script (plan/dry-run/undo). 8. `/code-review`, draft PR, show runner output. Full suite `node scripts/run-tests.mjs` once at the end.
- `scripts/check-migrations.mjs` needs `SKIP_MIGRATION_CHECK=1` locally (no env).

## Gates / prod writes
Unchanged (see hop2). Prod writes this hop: none.

## Scott's thread
(a) Still open, verbatim: planner relayed Scott's go — "Continue steps 2 to 8 without stopping; only stop for stop-list items (e.g. applying migration 021 to Supabase)." Original: "let's move everything but expense being the priority … bot itself would send notifications and all so system does enforce me while being in the telegram where i live and work".
(b) Questions to Scott: none waiting now. Later, one at a time when the starting-data plan prints: confirm "?" accounts (doc service +100k, math course −400k, cosmetics −200k, train −310k) — recommend Humo for all four; create an "Education" category for the math course — recommend yes. Soon: ask him to paste migration 021 (I give steps).
(c) Promises: phase 2 = tasks, reminders, notes through the bot; exact steps for BotFather + Vercel env + `setWebhook` + pasting 021 (no secrets in chat).
