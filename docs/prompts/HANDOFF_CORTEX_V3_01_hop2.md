# Handoff — Cortex v3 phase 1 (Telegram expenses), hop 2

Spec (authoritative, read first): `docs/prompts/CC_PROMPT_CORTEX_V3_01_TELEGRAM_EXPENSES.md`
Branch `feat/telegram-expenses`, worktree `/home/abdulloh/dev/projects/cortex-wt-telegram` (keep; remove when PR is done).
Not an ERP wave: no `wave update` applies.

## Done (committed)
- Step 1 `620634c` — parser: `*` lines → `isMove` transfer (bare `*250` still flags BARE_SMALL_AMOUNT). `parse.test.ts` 35/35.
- Step 2 — pure bot core in `src/lib/telegram/` (`accounts.ts`, `update.ts`, `callbacks.ts`, `render.ts`, `intent.ts`) + `telegram.test.ts` 44/44. Mutation-checked (removing the small-amount ask → 2 red). Spec edit (+80k/+6M rows) committed with it.

Design facts the next steps depend on:
- Decisions: `say | save(drafts) | ask(kind confirm|amount|move, raw, move?, render(pendingId)) | balance`. Route stores a **pending row** (id, kind, raw, payload) for every `ask`; callbacks reference the pending id (callback_data ≤64 bytes: one UUID max per button).
- Callback ops (see `callbacks.ts`): undo, menu, category (+learn rule), account, pending(choice), moveFrom, moveTo, snooze.
- Account keys `cash humo uzum ofb c7113` → real rows via DB table `bot_account_keys` (migration), never by name in the route.
- `renderTxn(view, cats)`, `renderGap`, `renderDayClose`, `renderOwedAsk/Reduced/Due`, `renderBalanceQuestion` exist. Balance gap: route fetches checkpoints+rows via RPC, calls `reconcileCount` (`finance/checkpoints.ts`), renders with `renderGap`.
- Owed follow-up after an income save: `matchOwed(comment, owed)` → pending kind `owed` with payload {txn, owedId}; `yes` reduces open amount.
- "Education" category is not in `CATEGORIES`; the starting-data script must create it if Scott accepts.

## Next
3. **Migration `021`** (NOT 018 — main is at 020). Pattern: `supabase/migrations/013_ops_ingest.sql` (private schema, token sha256, SECURITY DEFINER, `SET search_path=''`, REVOKE/GRANT) and test pattern `src/lib/ops/ops-ingest.db.test.ts` (PGlite; run migrations 005–010 + 013 + 021 in order with stubs). Needs: `@sentinel` line; bot token table; `bot_account_keys`; `bot_pending`; owed table (+ RLS for the owner so the mini app reads via session); RPCs `bot_capture, bot_undo, bot_set_category (learns finance_category_rules source learned), bot_set_account, bot_move, bot_checkpoint, bot_balance_inputs, bot_day_summary, bot_owed_*`, pending put/get/resolve, bot state for `pendingBalance` and snooze. Tests: anon can't touch tables, wrong/revoked token refused, other user's rows untouched. **Stop: Scott pastes it into Supabase.**
4. Webhook route `POST /api/telegram/webhook` + middleware exemption (copy `api/ops/ingest`, `src/lib/ops/door.ts`).
5. Cron route + schedule (check Vercel cron precision via Context7; else pg_cron+pg_net) — tests with injected clock.
6. Mini app finance home + initData HMAC check + Telegram WebApp script; run in browser, screenshot.
7. Starting-data script (plan / dry-run / undo; prints the spec's table).
8. `/code-review`, draft PR. Show runner output.

## Environment gotchas
- No `tsc` in this worktree (`npx tsc` fails); tests run via `node --test <file>` (type stripping, `.ts` import suffixes).
- `box-gate` refuses test runs when RAM < 2.5 GB: wait loop `until free -m` ≥ 2600, then run.
- Never run a bare `cat > file` without a heredoc — it hangs on stdin.
- glab auth was dead at session start (git push over ssh still works).
- Test commands: `node --test src/lib/finance/parse.test.ts`, `node --test src/lib/telegram/telegram.test.ts`; full suite `node scripts/run-tests.mjs` once at the end.

## Open gates (stop list)
Applying migration 021 to Supabase; creating the bot / setting `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_ID`, `CORTEX_BOT_DB_TOKEN`, `CORTEX_CRON_SECRET` in Vercel (Scott does it, give exact steps, never ask for a secret in chat); `setWebhook`; merge to main; loading the starting data (show plan first).

## Prod writes this session
None.

## Scott's thread
(a) Still open, verbatim: planner relayed Scott's go — "Continue steps 2 to 8 without stopping; only stop for stop-list items (e.g. applying migration 021 to Supabase)." Original: "let's move everything but expense being the priority … bot itself would send notifications and all so system does enforce me while being in the telegram where i live and work".
(b) Questions to Scott: the "+80k and +6M" screenshot question — ANSWERED (rows added to the spec table, 26 Nov). Pending for later (ask when the starting-data plan is printed, one at a time, with recommendation): confirm the "?" accounts (doc service +100k, math course −400k, cosmetics −200k, train −310k) — recommend Humo for all four; and whether to create an "Education" category for the math course — recommend yes.
(c) Promises: phase 2 = tasks, reminders, notes through the bot; exact steps for BotFather + Vercel env + `setWebhook` + pasting migration 021 (no secrets in chat).

## Suggested skills
`implement` (continue), `tdd`, `prove-it` (before the MR: RLS/token guards), `code-review` (step 8).
