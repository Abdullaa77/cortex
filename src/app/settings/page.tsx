'use client';

import AppShell from '@/components/layout/AppShell';

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:px-10 lg:py-6 page-enter">
        <div className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
          <span>--</span>
          <span>SETTINGS</span>
          <span className="flex-1 section-line" />
        </div>

        <div className="mt-12 text-center">
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
