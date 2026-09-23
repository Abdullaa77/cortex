'use client';

import Link from 'next/link';
import { useOps } from '@/hooks/useOps';
import { TONE_COLOR } from './OpsBoard';

/**
 * One line on the home page: "3 waiting on you · prod clean · measured 12m ago".
 * A card gets scrolled past; a line reaches Scott without opening anything,
 * and links through to /ops. The text is the board's own summary — the same
 * rollup, not a second one.
 */
export default function OpsLine() {
  const { board, loading } = useOps();
  if (loading) return null;

  const tone = board?.tone ?? 'red';
  const text = board?.summary ?? 'ops: could not load';
  return (
    <Link
      href="/ops"
      className="mb-2 flex items-center gap-2 rounded border border-border/40 px-3 py-1.5 font-mono text-[11px] text-text-muted transition-colors hover:border-accent/40"
      data-ops-tone={tone}
    >
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="text-text-muted/50">ops →</span>
    </Link>
  );
}
