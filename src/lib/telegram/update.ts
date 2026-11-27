/**
 * Telegram update -> the little we care about. Pure and defensive: the body is
 * attacker-controllable until the secret header has been checked, and even then
 * only the owner is listened to. Anything else is `ignore`, answered with 200.
 */

export type Incoming =
  | { kind: 'message'; chatId: number; messageId: number; text: string }
  | {
      kind: 'callback';
      callbackId: string;
      chatId: number;
      messageId: number;
      data: string;
    }
  | { kind: 'ignore' };

const IGNORE: Incoming = { kind: 'ignore' };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

export function parseUpdate(update: unknown, ownerId: number): Incoming {
  if (!isObj(update)) return IGNORE;

  const message = update.message;
  if (isObj(message)) {
    const from = message.from;
    const chat = message.chat;
    if (!isObj(from) || from.id !== ownerId || from.is_bot === true) return IGNORE;
    if (!isObj(chat) || !isInt(chat.id) || !isInt(message.message_id)) return IGNORE;
    if (typeof message.text !== 'string' || message.text.trim() === '') return IGNORE;
    return {
      kind: 'message',
      chatId: chat.id,
      messageId: message.message_id,
      text: message.text,
    };
  }

  const cb = update.callback_query;
  if (isObj(cb)) {
    const from = cb.from;
    const msg = cb.message;
    if (!isObj(from) || from.id !== ownerId) return IGNORE;
    if (typeof cb.id !== 'string' || typeof cb.data !== 'string') return IGNORE;
    if (!isObj(msg) || !isInt(msg.message_id) || !isObj(msg.chat) || !isInt(msg.chat.id))
      return IGNORE;
    return {
      kind: 'callback',
      callbackId: cb.id,
      chatId: msg.chat.id,
      messageId: msg.message_id,
      data: cb.data,
    };
  }

  return IGNORE;
}
