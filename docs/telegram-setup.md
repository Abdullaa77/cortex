# Telegram expenses bot — setup (Scott does these; never paste a secret in chat)

Order matters. Placeholders in `<angle brackets>`.

1. **Migration**: paste `supabase/migrations/021_telegram_bot.sql` in the Supabase SQL editor, run.
2. **Accounts + token** (dev box, then SQL editor). Make a token: `head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=' > ~/.config/cortex/bot-db-token && chmod 600 ~/.config/cortex/bot-db-token`.
   In SQL: insert the 5 accounts (Cash, Humo 6604, Uzum Visa 6693, Uzcard OFB 9461, Uzcard 7113) if missing, then the two inserts from the header of 021 (`bot_tokens` with the sha256 of the token, `bot_account_keys` with keys cash/humo/uzum/ofb/c7113).
   *Token already in Vercel and locked?* Skip making one: after deploy + setWebhook, message the bot; it replies with the token's sha256 fingerprint (safe to share) to put in `bot_tokens`.
3. **BotFather**: `/newbot` → keep the bot token. `/setmenubutton` → URL `https://<your-vercel-domain>/finance/mini`.
4. **Vercel env** (Production): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (16+ random chars), `TELEGRAM_OWNER_ID` (your Telegram numeric id), `CORTEX_BOT_DB_TOKEN` (the token from step 2), `CORTEX_CRON_SECRET` (random). Redeploy.
5. **setWebhook** (after deploy): `curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" --data-urlencode "url=https://<domain>/api/telegram/webhook" --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>"`.
6. **Schedules** (Supabase SQL editor; needs extensions `pg_cron` and `pg_net`):
```sql
select cron.schedule('cortex-dayclose','0 16 * * *', $$select net.http_post('https://<domain>/api/telegram/cron?job=dayclose', headers:='{"authorization":"Bearer <CORTEX_CRON_SECRET>"}'::jsonb)$$);
select cron.schedule('cortex-due','0 4 * * *', $$select net.http_post('https://<domain>/api/telegram/cron?job=due', headers:='{"authorization":"Bearer <CORTEX_CRON_SECRET>"}'::jsonb)$$);
select cron.schedule('cortex-snooze','*/15 * * * *', $$select net.http_post('https://<domain>/api/telegram/cron?job=snooze', headers:='{"authorization":"Bearer <CORTEX_CRON_SECRET>"}'::jsonb)$$);
```
7. **Starting data** (only after you confirm the plan): `node scripts/starting-data.mjs` prints it; `--sql` prints the SQL to paste; `--undo` removes exactly those rows.
8. Open the bot, send `-10k taxi`; open the menu button once and log in with your normal login.
