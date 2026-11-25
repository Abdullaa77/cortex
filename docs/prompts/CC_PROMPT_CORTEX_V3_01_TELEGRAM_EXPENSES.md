# Cortex v3 — Phase 1: Telegram bot + mini app, expenses first

Worktree: `/home/abdulloh/dev/projects/cortex-wt-telegram`, branch `feat/telegram-expenses` (from origin/main 2799e32).
Planned by Opus with Scott on 2026-11-25. Builder: Sonnet. Every decision below is Scott's, already made — do not re-ask.

## Why (Scott's words, short)

Cortex has many sections but Scott stopped using it. He logs expenses in Telegram Saved Messages because it is
fast. Goal: Cortex lives inside Telegram, where he works. The bot is the front door and the nag; the website opens
as a Telegram Mini App for viewing/editing. "The system enforces me while I'm in Telegram."

## Scott's decisions (locked)

1. **Capture in both places**: typing in the bot chat saves an expense; the mini app also has quick add.
2. **Save instantly**, reply `✓ Transport −25,000 · Cash` with inline buttons **Undo**, **Change category**, and an
   account row **[Cash] [Humo] [Uzum] [OFB] [7113]** (one tap moves it). Ask *before* saving only when the parser
   flags the line (`ok === false`: income-suspect, transfer-suspect, `$`, ambiguous comma, etc.).
3. **Default account = Cash.** Account is set by button, never typed.
4. **Moves**: a line starting with `*` (e.g. `*250 card to cash exchange`) is a transfer between his own accounts:
   bot asks "from → to" with the account buttons. Today the parser *drops* `*250 …` (zero transactions) — fix that.
   Scott wrote `*250` meaning 250,000, so when a `*` amount is under 1,000 with no `k`, the bot asks
   "250 or 250,000?" instead of guessing.
5. **Unknown category**: bot asks once with category buttons, then remembers (existing `finance_category_rules`,
   source `learned`).
6. **Balance checks**: cash every evening, all cards every Sunday. Bot asks "Cash now?", Scott types a number,
   Cortex compares with the computed balance and shows the gap ("Cash is 12,000 short — what's missing?").
   Reuse `src/lib/finance/reconcile.ts` / `checkpoints.ts` / `balance_checkpoints` — read them first.
7. **Day-close at 21:00 Tashkent (16:00 UTC)** every day: today's spend total + top categories + the cash
   question. Sunday's day-close also asks each card balance. Button **"Remind me in 1 h"**.
8. **Owed-to-me list** (and owed-by-me): person, amount, optional due date. Reminder on the due date morning
   (09:00 Tashkent). When an income line mentions a listed person ("+310k muxlisa opa reimbursement"), bot asks
   "Is this Muxlisa opa paying back? [Yes] [No]" and reduces the open amount on Yes.
9. **Mini app (phase 1 scope only)**: phone-first finance home — today's total, balance per place, owed list,
   recent lines with edit/delete, quick add. Opened inside Telegram, show only this; other sections stay reachable
   from the normal website. Simple, tailored, fast — no new heavy UI.
10. Tasks/reminders/notes via bot = **phase 2**, not now.

## Grammar (unchanged — `src/lib/finance/parse.ts` is authoritative)

`10k` = 10,000 · `10,120` = 10,120 · `10,120.29` = tiyin after the dot · all UZS · `$` in text is a flag, never a
currency · minor units exponent 2, never floats.

## Architecture decisions (Opus; state any change in the PR)

- **Webhook**: `POST /api/telegram/webhook`. Verify `X-Telegram-Bot-Api-Secret-Token` (constant-time) against env
  `TELEGRAM_WEBHOOK_SECRET`; accept only `from.id === TELEGRAM_OWNER_ID` (env), silently 200 everything else.
  Exempt the path in `src/middleware.ts` matcher like `api/ops/ingest`. Always answer Telegram 200 fast; never
  leak errors to chat beyond a short "couldn't save — database asleep, try again" line.
- **DB access without a session**: copy the ops pattern (migrations 013/015: token sha256 in a private table,
  `SECURITY DEFINER`, `SET search_path = ''`, explicit REVOKE anon/authenticated + GRANT only what's needed).
  New RPCs (names are suggestions): `bot_capture`, `bot_undo`, `bot_set_category`, `bot_set_account`,
  `bot_move`, `bot_checkpoint`, `bot_day_summary`, `bot_owed_*`. The route holds env `CORTEX_BOT_DB_TOKEN`.
  No service-role key (the codebase deliberately has none — keep it that way).
- **Sending**: plain `fetch` to the Bot API with env `TELEGRAM_BOT_TOKEN`. No bot framework dependency unless
  Context7 shows a strong reason.
- **Schedules**: need minute-accurate 16:00 UTC daily and 04:00 UTC due-date pings. Check (Context7 / Vercel
  docs) whether this Vercel plan's cron is hour-imprecise; if so use Supabase `pg_cron` + `pg_net` calling
  `POST /api/telegram/cron?job=…` with a bearer secret (env `CORTEX_CRON_SECRET`). Side win: a daily DB hit stops
  the free-tier 7-day pause.
- **Mini app auth**: Scott logs in once inside the Telegram webview with the existing Supabase login; check the
  session persists across reopen on Android. Also validate `Telegram.WebApp.initData` (HMAC with bot token,
  per Telegram docs) server-side and show "not your Cortex" when the user id ≠ owner. Bot menu button opens the
  mini app URL.
- **Accounts**: `accounts` table exists (migration 008; kinds cash/card/savings). Need 5 accounts:
  Cash, Humo 6604 (Hamkor, main card, income lands here), Uzum Visa 6693, Uzcard OFB 9461, Uzcard 7113.
  Expense → `from_account` set; income → `to_account`; move → both (see `accounts.ts` comment block).
- **Migrations**: next number is 018. Each must declare its `@sentinel` for `scripts/check-migrations.mjs`.
  Migrations are pasted into the Supabase SQL editor **by Scott** — do not apply them yourself.

## Starting data (load only after Scott confirms the printed plan)

Balances **now** (25 Nov ~22:00 Tashkent): Cash 160,000.00 · Humo6604 3,711,800.50 · Uzum6693 350,805.23 ·
OFB9461 800.44 · 7113 0.00. Store as checkpoints at that instant; Cortex derives Monday's opening by reversing
the lines below.

| when (Tashkent) | line | category | account (best guess — Scott confirms) |
|---|---|---|---|
| 24 Nov 17:06 | −70,200 VIA PAYMENT — phone plan (his + mom's) | phone-internet | Humo |
| 24 Nov 18:08 | −930,823.89 Muxlisa opa reimbursement | transfer/debt; opens owed-to-me 930,823.89 | Uzum |
| 24 Nov 18:17 | −10k taxi | transport | Cash |
| 24 Nov 18:18 | move 250k card → cash | transfer | Humo → Cash (confirm) |
| 24 Nov 18:18 | −43k gm club | entertainment | Cash |
| 24 Nov 18:18 | −15k sandwich | eating-out | Cash |
| 25 Nov 11:22 | −8k banana | groceries | Cash |
| 25 Nov 11:24 | +100k doc service | income | ? (confirm) |
| 25 Nov 11:25 | −400k math course payment | none yet — ask (suggest new "Education") | ? (confirm) |
| 25 Nov 11:26 | −200k cosmetics for mom | ask (gifts?) | ? (confirm) |
| 25 Nov 11:26 | −310k train ticket | travel | ? (confirm) |
| 25 Nov 11:29 | −50k lent to Dior, due **30 Nov** | transfer/debt; owed-to-me 50k due 2026-11-30 | Cash |
| 25 Nov 12:20 | −200k gift to Muxlisa opa's sister | gifts-events | Uzum |
| 25 Nov 12:24 | −40k bread | groceries | Cash |
| 25 Nov 12:18 | +310k Muxlisa opa paying back | repayment; owed-to-me → 620,823.89 | Humo |

Bank screenshots also show many Humo→Visa and Visa→Humo/Uzcard moves on 23–24 Nov (fee-avoidance hops). They
cancel out; do not load them unless Scott asks. Scott still owes a screenshot of the "+80k and +6M" lines.
Load via a script with: printed plan → Scott "yes" → run → undo file → re-run shows 0 changes.

## Plan — `[step] → verify`

Read first: `parse.ts`, `categorize.ts`, `accounts.ts`, `reconcile.ts`, `checkpoints.ts`, migrations 005–010 and
013/015, `src/middleware.ts`, `src/app/api/ops/ingest/route.ts`, `src/lib/ops/door.ts`, `scripts/run-tests.mjs`,
and the Next 16 docs in `node_modules/next/dist/docs/` for route handlers. Context7 for Telegram Bot API /
Mini Apps (initData validation), Supabase pg_cron/pg_net, Vercel cron.

1. Parser: `*` move lines produce a transfer, not nothing → verify: failing test first, then green.
2. Pure bot core (`src/lib/telegram/`): update → intent (capture / move / callback / balance answer / unclear),
   reply text + keyboards. No I/O. → verify: unit tests over Scott's 13 real lines above.
3. Migration 018 (bot token table + RPCs + owed table) → verify: pglite tests like the ops ones (RLS, anon can't
   touch tables, wrong token refused). **Stop: Scott pastes it.**
4. Webhook route + middleware exemption → verify: route tests (bad secret 401/ignored, stranger ignored, owner
   capture calls RPC, DB unreachable → polite line).
5. Cron route + schedule (day-close, Sunday cards, due-date pings, snooze) → verify: tests with an injected
   clock (21:00 Tashkent, Sunday, 30 Nov).
6. Mini app finance home + initData check + Telegram WebApp script → verify: run it in a browser; screenshot.
7. Starting-data script (plan/dry-run/undo) → verify: dry run prints the table above.
8. `/code-review` the diff, open a **draft PR**. Show test runner output.

## Stop list for this ticket (ask Scott in one line each)

- Creating the bot in @BotFather and putting `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_OWNER_ID`, `CORTEX_BOT_DB_TOKEN`, `CORTEX_CRON_SECRET` into Vercel — **Scott does it; never ask him to
  paste a secret in chat.** Give him the exact steps.
- Pasting migration 018 into Supabase.
- Merging to main (it deploys). Loading the starting data (show the plan first).
- `setWebhook` call — give Scott the one command, or run it only after his go.

## Talk to Scott

Plain English, ≤5 lines, line 1 = done / stuck / need you. One question at a time, with your recommendation.
Times in Tashkent am/pm.

## Scott's thread

Verbatim, from the planning session (2026-11-25):

- "it doesnt feel like where i want to go in, it doesnt fulfill my needs … im keeping the expense journaling in my telegram saved messsages because it feels way simpler and easier … the UX and UI must also be simple and easy, tailored specifically to me … make our cortex the part of my life … think smart and out of the box bro"
- "let's move everything but expense being the priority and we dont have to make it just inline bot with API underneath, we just create bot and wire the cortex website as mini app, but bot itself would send notifications and all so system does enforce me while being in the telegram where i live and work"
- Capture in chat and mini app: "A". Save instantly with Undo/Change category: "A".
- "reimbursement is what we gotta pay … and yes she paid partly yet" (930,823.89 out; +310k back; 620,823.89 still owed to him — he confirmed "your reads are right")
- Balances: "cash - 160k(cuz i lended 50k to dior and bought bread for 40k) humo6604 - 3,711,800.50 so'm (main card i received income on monday but im moving money to uzumVISA6693 so i dont pay comission for transfer) uzumVISA6693 - 350,805.23 so'm uzcardOFB9461 - 800,44 so'm uzcard7113 - 0.0 so'm"
- "today's -200k was just gift to Muxlisa sister" · VIA PAYMENT: "it was for phone number sub (mine and mom's at together)"
- Auto card capture: "there is no notification and it would give the category or the reason correctly so i log bro myself" → NO auto-capture.
- Balance checks: "a" (cash nightly, cards Sunday). Day-close time: "9pm". Dior due: "30th november then".
- Build phase 1: "yes". Default account: "a" (cash default + one-tap account buttons).

Open asks to Scott: screenshot of the "+80k and +6 million" lines (screens 1 and 2 he sent were identical).
Promises made: phase 2 = tasks, reminders, notes through the bot.
