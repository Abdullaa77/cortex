#!/usr/bin/env node
/**
 * Starting data for the Telegram expenses bot.
 *   node scripts/starting-data.mjs          print the plan (dry run, default)
 *   node scripts/starting-data.mjs --sql    print the SQL to paste in the Supabase SQL editor
 *   node scripts/starting-data.mjs --undo   print the SQL that removes exactly those rows
 * Writes nothing itself.
 */
import { renderPlan, toSql, undoSql } from '../src/lib/telegram/starting-data.ts';

const flag = process.argv[2];
if (flag === '--sql') console.log(toSql());
else if (flag === '--undo') console.log(undoSql());
else if (!flag) console.log(renderPlan());
else {
  console.error('usage: node scripts/starting-data.mjs [--sql|--undo]');
  process.exit(1);
}
