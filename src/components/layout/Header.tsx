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
  // Use useSyncExternalStore to avoid the lint warning about setState in effect
  const time = useSyncExternalStore(subscribe, formatTime, () => '');

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-bg px-4 font-mono">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-accent">CORTEX</span>
        <span className="text-xs text-text-muted">v1.0</span>
      </div>
      <span className="text-xs text-text-muted">{time}</span>
    </header>
  );
}
