export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg font-mono">
      <div className="text-center space-y-6 px-4">
        <p className="text-xs tracking-[4px] text-accent text-glow">
          ── OFFLINE ──
        </p>
        <p className="text-text-muted text-sm">
          <span className="text-text-primary">&gt;</span> Connection lost.
        </p>
        <div className="space-y-1 text-xs text-text-muted">
          <p>You&apos;re offline. Cortex will sync when you&apos;re back online.</p>
          <p>Your cached pages are still available.</p>
        </div>
      </div>
    </div>
  );
}
