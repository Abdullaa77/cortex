# Handoff — Cortex v3 phase 1 (Telegram expenses), hop 5

Spec: `docs/prompts/CC_PROMPT_CORTEX_V3_01_TELEGRAM_EXPENSES.md`; earlier hops: hop2–hop4 handoffs. Branch `feat/telegram-expenses`, worktree `/home/abdulloh/dev/projects/cortex-wt-telegram` (node_modules symlink -> ../cortex/node_modules). All committed and pushed, tree clean.

## Done this hop
- Step 6: `src/lib/telegram/initdata.ts` (+test, 8 pass), `src/app/api/telegram/miniapp/route.ts` (behind the Supabase session), `src/app/finance/mini/page.tsx` (gate -> today total, balances, owed list, recent edit/delete, quick add). tsc + eslint clean. NOT browser-verified: needs Scott's login inside Telegram (not possible here); say so in the PR.
- Step 7: `src/lib/telegram/starting-data.ts`, `scripts/starting-data.mjs` (plan / `--sql` / `--undo`), PGlite test `starting-data.db.test.ts` (4 pass: loads, re-run no change, undo exact). Plan printed (17 rows, 2 owed, 5 counts); 5 accounts marked "?" default Humo (rows 6, 10-13). No prod write done.
- Step 8 partly: `docs/telegram-setup.md` written. `node --test src/lib/telegram/*.test.ts` = 90 + 4 db pass.

## Next
1. Full suite once: `SKIP_MIGRATION_CHECK=1 node scripts/run-tests.mjs`; show output.
2. `/code-review` the diff (branch vs main), fix real issues.
3. Open DRAFT PR (mention: spec said migration 018, real is 021; env names TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET/TELEGRAM_OWNER_ID/BOT_DB_TOKEN/CORTEX_CRON_SECRET; mini app unverified in browser; owed-by-me not built). No merge.
4. Ask Scott (one question at a time, recommend): confirm "?" accounts (all Humo) + Education category; then give him the setup guide.

## Gates
No prod writes, no merge, no migration paste, no setWebhook without Scott's go. Prod writes this hop: none.

## Scott's thread
(a) Open, verbatim: planner relayed Scott's go — "Continue steps 2 to 8 without stopping; only stop for stop-list items (e.g. applying migration 021 to Supabase)." Original: "let's move everything but expense being the priority … bot itself would send notifications and all so system does enforce me while being in the telegram where i live and work".
(b) Questions to Scott: none sent yet. Next: confirm the 4 "?" accounts (doc service +100k, math course −400k, cosmetics −200k, train −310k) and the 250k move (Humo→Cash) — recommend Humo for all; create "Education" category — recommend yes. Then: paste migration 021 + BotFather/Vercel steps (docs/telegram-setup.md).
(c) Promises: phase 2 = tasks, reminders, notes via the bot; exact setup steps (now in docs/telegram-setup.md; no secrets in chat).
