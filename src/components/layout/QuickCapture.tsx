'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

interface QuickCaptureProps {
  onCapture: (text: string) => Promise<void>;
  isModal?: boolean;
}

export default function QuickCapture({
  onCapture,
  isModal = false,
}: QuickCaptureProps) {
  const [value, setValue] = useState('');
  const [flash, setFlash] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const prefix = value.startsWith('!') ? 'urgent' : value.startsWith('?') ? 'idea' : null;

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    try {
      await onCapture(text);
      setValue('');
      setFlash(true);
      setTimeout(() => setFlash(false), 400);
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (isModal) {
    return (
      <form onSubmit={handleSubmit} className="w-full px-4 py-3">
        <div
          className={`flex items-center gap-2 rounded border font-mono transition-all duration-300 ${
            flash ? 'border-accent bg-accent/10' : 'border-border bg-surface'
          }`}
        >
          <span className={`pl-3 text-accent text-base ${focused ? 'text-glow-sm' : ''}`}>{'>'}</span>
          {prefix === 'urgent' && (
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
              URGENT
            </span>
          )}
          {prefix === 'idea' && (
            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-400">
              IDEA
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Capture a thought..."
            autoFocus
            className="flex-1 bg-transparent py-3 font-mono text-sm text-text-primary caret-accent placeholder:text-text-muted/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim() || submitting}
            className="pr-3 text-xs text-text-muted transition-colors hover:text-accent disabled:opacity-40"
          >
            Enter
          </button>
        </div>
      </form>
    );
  }

  return (
    <div
      className={`hidden lg:flex h-14 items-center gap-2 px-4 font-mono transition-all duration-300 ${
        flash ? 'animate-[capture-flash_0.4s_ease-out]' : ''
      }`}
      style={{
        borderTop: '1px solid transparent',
        borderImage: 'linear-gradient(90deg, transparent, rgba(0, 255, 136, 0.15), transparent) 1',
        background: 'rgba(17, 17, 24, 0.6)',
      }}
    >
      <span className={`text-accent text-base ${focused ? 'text-glow-sm' : ''}`}>{'>'}</span>
      {prefix === 'urgent' && (
        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
          URGENT
        </span>
      )}
      {prefix === 'idea' && (
        <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-400">
          IDEA
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Capture a thought..."
        className="flex-1 bg-transparent font-mono text-sm text-text-primary caret-accent placeholder:text-text-muted/50 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => handleSubmit()}
        disabled={!value.trim() || submitting}
        className="text-xs text-text-muted transition-colors hover:text-accent disabled:opacity-40"
      >
        Enter
      </button>
    </div>
  );
}
