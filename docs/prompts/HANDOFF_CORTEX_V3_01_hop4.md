# Handoff — Cortex v3 phase 1 (Telegram expenses), hop 4

Spec: `docs/prompts/CC_PROMPT_CORTEX_V3_01_TELEGRAM_EXPENSES.md`. Earlier: hop2, hop3 handoffs (design facts, gates still valid).
Branch `feat/telegram-expenses`, worktree `/home/abdulloh/dev/projects/cortex-wt-telegram` (node_modules symlink -> ../cortex/node_modules, git-ignored, needed for PGlite). All committed, tree clean.

## Done this hop (all green: `node --test src/lib/telegram/*.test.ts` = 82 pass; `npx tsc --noEmit` clean)
- Step 3 prove-it DONE: mutated revoked-token, undo user filter, pending_resolve user filter, short-token check -> all RED, reverted GREEN. Two tests added to bot-db.db.test.ts (14/14). REVOKE mutation not done (anon-call test covers table access only) — optional.
- Step 4 DONE: `src/lib/telegram/{handle,api,webhook}.ts` + `src/app/api/telegram/webhook/route.ts` + middleware exemption. handle.ts = all conversation logic over injected `Deps` (rpc/send/edit/answer/now); owed ask + move 2-tap + balance (reconcile BEFORE storing) + snooze. Webhook: secret header constant-time, owner-only, always 200 after auth.
- Step 5 DONE: `src/lib/telegram/cron.ts` + `src/app/api/telegram/cron/route.ts` (POST ?job=dayclose|due|snooze, bearer secret). Sunday card chain lives in handle.ts balance case. Vercel Hobby cron is once/day and hour-imprecise (Context7) -> use Supabase pg_cron + pg_net.
- ENV NAMES USED (spec said CORTEX_BOT_DB_TOKEN; I used): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_ID`, `BOT_DB_TOKEN` (opens 021 doors), `CORTEX_CRON_SECRET`. Either rename in code or tell Scott the used names in the setup guide.
- Not wired in v1: nothing known missing except owed-by-me (only owed-to-me exists in 021).

## Next
6. Mini app finance home + Telegram initData HMAC check (route handler validating `initData` with bot token HMAC; then Scott logs in once with existing Supabase login inside the webview per spec "Mini app auth" lines ~60). Show: today's total, balance per place, owed list, recent lines edit/delete, quick add. Keep light. Verify in browser + screenshot. `src/app` has no (app) group; finance pages live in `src/app/finance`.
7. Starting-data script (plan / dry-run / undo; spec table ~line 75-100; prod write = needs Scott's go after the plan prints).
8. `/code-review`, push, draft PR (mention: spec said migration 018, real number is 021; env names). Full suite once: `SKIP_MIGRATION_CHECK=1 node scripts/run-tests.mjs`. Pasting 021, BotFather, Vercel env, setWebhook, pg_cron SQL = Scott, steps given in a setup doc `docs/telegram-setup.md` (write it; pg_cron SQL with placeholders; 3 jobs: dayclose 16:00 UTC, due 04:00 UTC, snooze every 15 min; never ask for secrets in chat).

## Gates
Unchanged: no prod writes, no merge, no migration paste, no setWebhook without Scott's go. Prod writes this hop: none.

## Scott's thread
(a) Still open, verbatim: planner relayed Scott's go — "Continue steps 2 to 8 without stopping; only stop for stop-list items (e.g. applying migration 021 to Supabase)." Original: "let's move everything but expense being the priority … bot itself would send notifications and all so system does enforce me while being in the telegram where i live and work".
(b) Questions to Scott: none waiting now. Later, one at a time when the starting-data plan prints: confirm "?" accounts (doc service +100k, math course −400k, cosmetics −200k, train −310k) — recommend Humo for all four; create an "Education" category for the math course — recommend yes. Soon: ask him to paste migration 021 (give steps) and do BotFather/Vercel env.
(c) Promises: phase 2 = tasks, reminders, notes through the bot; exact steps for BotFather + Vercel env + `setWebhook` + pasting 021 + pg_cron SQL (no secrets in chat).
