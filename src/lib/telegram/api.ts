/**
 * The three Telegram Bot API calls the bot needs, and the Deps the handler
 * runs on. The bot token is in every URL, so errors are reduced to a status
 * word here and never carry the URL further.
 */
import { anonClient } from '../ops/door.ts';
import type { Deps } from './handle.ts';
import type { Reply } from './render.ts';

export interface BotEnv {
  botToken: string;
  /** The token that opens the 021 doors (ops_private.bot_tokens), not the Telegram one. */
  dbToken: string;
}

const keyboard = (r: Reply) => ({
  inline_keyboard: r.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
});

async function call(env: BotEnv, method: string, body: Record<string, unknown>, f: typeof fetch): Promise<void> {
  let res: Response;
  try {
    res = await f(`https://api.telegram.org/bot${env.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`telegram ${method}: unreachable`);
  }
  if (!res.ok) {
    // Tapping the same choice again re-sends identical text: Telegram's 400 is harmless.
    if (res.status === 400 && method === 'editMessageText') {
      const body = await res.text().catch(() => '');
      if (body.includes('message is not modified')) return;
    }
    throw new Error(`telegram ${method}: ${res.status}`);
  }
}

export function makeDeps(env: BotEnv, f: typeof fetch = fetch): Deps {
  return {
    async rpc(fn, args = {}) {
      try {
        const { data, error } = await anonClient().rpc(fn, { p_token: env.dbToken, ...args });
        if (error) return { ok: false, error: 'database_error' };
        return (data ?? { ok: false, error: 'empty' }) as Record<string, unknown>;
      } catch {
        return { ok: false, error: 'database_unreachable' };
      }
    },
    send: (chatId, r) =>
      call(env, 'sendMessage', { chat_id: chatId, text: r.text, reply_markup: r.buttons.length ? keyboard(r) : undefined }, f),
    edit: (chatId, messageId, r) =>
      call(
        env,
        'editMessageText',
        { chat_id: chatId, message_id: messageId, text: r.text, reply_markup: keyboard(r) },
        f
      ),
    answer: (id) => call(env, 'answerCallbackQuery', { callback_query_id: id }, f),
    now: () => new Date(),
  };
}
