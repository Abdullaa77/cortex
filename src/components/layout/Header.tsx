'use client';

import { useSyncExternalStore } from 'react';
import { usePWA } from '@/components/providers/PWAProvider';

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
  const { isOnline, isInstallable, installApp } = usePWA();

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-bg/95 backdrop-blur-sm px-4 font-mono">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold tracking-[2px] text-accent text-glow">CORTEX</span>
        <span className="text-[11px] text-text-muted">v1.0</span>
      </div>
      <div className="flex items-center gap-3">
        {isInstallable && (
          <button
            onClick={installApp}
            className="text-[10px] text-text-muted border border-accent/30 rounded px-2 py-0.5 hover:border-accent/60 hover:text-accent transition-colors"
          >
            Install
          </button>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">{time}</span>
          <span
            title={isOnline ? 'Online' : 'Offline'}
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isOnline
                ? 'bg-accent animate-[pulse-glow_3s_ease-in-out_infinite] shadow-[0_0_4px_rgba(0,255,136,0.5)]'
                : 'bg-red-500'
            }`}
          />
        </div>
      </div>
    </header>
  );
}
