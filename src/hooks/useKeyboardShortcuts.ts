'use client';

import { useEffect } from 'react';

interface ShortcutMap {
  [key: string]: () => void;
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs/textareas (except Escape)
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        if (e.key !== 'Escape') return;
      }

      // Build key combo string
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('ctrl');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      parts.push(e.key.toLowerCase());
      const combo = parts.join('+');

      if (shortcuts[combo]) {
        e.preventDefault();
        shortcuts[combo]();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, enabled]);
}
