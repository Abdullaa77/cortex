'use client';

import { Columns2 } from 'lucide-react';

export interface MonthTab {
  key: string;
  label: string;
  year: string;
}

interface MonthTabsProps {
  tabs: MonthTab[];
  activeKey: string;
  comparing: boolean;
  /** Null when there is no earlier month to compare the active one against. */
  compareAgainstLabel: string | null;
  onSelect: (key: string) => void;
  onToggleCompare: () => void;
}

/**
 * One month at a time, with comparison as a toggle.
 *
 * Comparison is what found the 1.43m everyday floor, so it stays — but it is
 * not the resting state. Looking at one month is the ordinary act; putting two
 * side by side is a question you go and ask.
 *
 * The tabs come from the months that have rows. Nothing here knows that July
 * and August exist, so September appears on its own the first time something
 * lands in it.
 */
export default function MonthTabs({
  tabs,
  activeKey,
  comparing,
  compareAgainstLabel,
  onSelect,
  onToggleCompare,
}: MonthTabsProps) {
  // Newest first — the month you want is almost always the last one.
  const ordered = [...tabs].reverse();
  const showYear = new Set(tabs.map((t) => t.year)).size > 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5"
        role="tablist"
        aria-label="Month"
      >
        {ordered.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.key)}
              className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px]
                uppercase tracking-wider transition-colors ${
                  active
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border/60 text-text-muted hover:border-border hover:text-text-primary'
                }`}
            >
              {tab.label.slice(0, 3)}
              {showYear && <span className="ml-1 opacity-50">{tab.year.slice(2)}</span>}
            </button>
          );
        })}
      </div>

      {compareAgainstLabel && (
        <button
          type="button"
          onClick={onToggleCompare}
          aria-pressed={comparing}
          title={`Show ${compareAgainstLabel.toLowerCase()} beside this month`}
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono
            text-[11px] transition-colors ${
              comparing
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border/60 text-text-muted hover:border-border hover:text-text-primary'
            }`}
        >
          <Columns2 size={12} />
          compare
        </button>
      )}
    </div>
  );
}
