'use client';

import AppShell from '@/components/layout/AppShell';

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        <div className="mb-3 mt-6 flex items-center gap-2 font-mono text-xs uppercase text-text-muted">
          <span className="text-border">--</span>
          <span>SETTINGS</span>
          <span className="flex-1 text-border">---------------------</span>
        </div>

        <div className="mt-8 text-center">
          <p className="font-mono text-sm text-text-muted">
            {'>'} Coming soon.
          </p>
          <p className="mt-2 font-mono text-xs text-text-muted/60">
            Settings will be available in the next update.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
