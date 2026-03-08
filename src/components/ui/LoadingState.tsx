'use client';

export default function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16 px-4">
      <p className="font-mono text-sm text-text-muted">
        <span className="text-accent">{'>'}</span>
        {' Loading'}
        <span className="inline-block w-2 h-4 bg-accent ml-0.5 align-middle animate-[blink_1s_step-end_infinite]" />
      </p>
    </div>
  );
}
