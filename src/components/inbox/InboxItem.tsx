'use client';

import { useState } from 'react';
import type { InboxItem as InboxItemType } from '@/lib/types';

interface InboxItemProps {
  item: InboxItemType;
  onProcess: (item: InboxItemType, type: 'task' | 'idea' | 'project' | 'trash') => void;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
}

const ACTION_BUTTONS = [
  { type: 'task' as const, label: '\u2192T', hoverText: 'hover:text-blue-400', hoverBorder: 'hover:border-blue-400/30' },
  { type: 'idea' as const, label: '\u2192I', hoverText: 'hover:text-purple-400', hoverBorder: 'hover:border-purple-400/30' },
  { type: 'project' as const, label: '\u2192P', hoverText: 'hover:text-accent', hoverBorder: 'hover:border-accent/30' },
  { type: 'trash' as const, label: '\u2715', hoverText: 'hover:text-red-400', hoverBorder: 'hover:border-red-400/30' },
] as const;

export default function InboxItem({ item, onProcess }: InboxItemProps) {
  const [exiting, setExiting] = useState(false);

  const handleProcess = (type: 'task' | 'idea' | 'project' | 'trash') => {
    setExiting(true);
    setTimeout(() => onProcess(item, type), 200);
  };

  return (
    <div
      className={`flex items-center justify-between p-3 border-b border-border hover:bg-surface2/30 transition-all duration-150 group ${
        exiting ? 'animate-[slideOutLeft_0.2s_ease-out_forwards]' : ''
      }`}
    >
      <div className="flex-1 min-w-0 mr-4">
        <p className="font-mono text-text-primary text-sm truncate">
          &ldquo;{item.raw_text}&rdquo;
        </p>
        <p className="text-text-muted/60 text-[11px] mt-1 font-mono">
          {relativeTime(item.created_at)}
        </p>
      </div>

      <div className="flex flex-row items-center gap-2 shrink-0">
        {ACTION_BUTTONS.map((btn) => (
          <button
            key={btn.type}
            onClick={() => handleProcess(btn.type)}
            className={`bg-surface2/50 border border-border rounded px-2 py-1 text-xs font-mono
              text-text-muted transition-all duration-150
              ${btn.hoverText} ${btn.hoverBorder}`}
            title={btn.type === 'trash' ? 'Trash' : `Process to ${btn.type}`}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
