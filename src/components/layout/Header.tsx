'use client';

import { useSyncExternalStore } from 'react';

function formatTime() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function subscribe(callback: () => void) {
  const interval = setInterval(callback, 60_000);
  return () => clearInterval(interval);
}

export default function Header() {
  const time = useSyncExternalStore(subscribe, formatTime, () => '');

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-bg/95 backdrop-blur-sm px-4 font-mono">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold tracking-[2px] text-accent text-glow">CORTEX</span>
        <span className="text-[11px] text-text-muted">v1.0</span>
      </div>
      <span className="text-[11px] text-text-muted">{time}</span>
    </header>
  );
}
