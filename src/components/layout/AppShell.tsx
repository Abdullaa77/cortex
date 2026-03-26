'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useInbox } from '@/components/providers/InboxProvider';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import CommandPalette from '@/components/CommandPalette';
import Header from './Header';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import QuickCapture from './QuickCapture';

type PaletteMode = 'search' | 'create_task' | 'create_idea' | 'create_project';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const inbox = useInbox();
  const { supabase, session } = useSupabase();
  const [showMobileCapture, setShowMobileCapture] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('search');
  const [reviewDue, setReviewDue] = useState(false);

  // Check if weekly review is due
  useEffect(() => {
    if (!session?.user) return;
    supabase
      .from('weekly_reviews')
      .select('week_start')
      .order('week_start', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!data || data.length === 0) {
          setReviewDue(true);
          return;
        }
        const lastReviewDate = new Date(data[0].week_start);
        const daysSince = (Date.now() - lastReviewDate.getTime()) / (1000 * 60 * 60 * 24);
        setReviewDue(daysSince >= 7);
      });
  }, [supabase, session?.user]);

  const openPalette = (mode: PaletteMode = 'search') => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  };

  const shortcuts = useMemo(
    () => ({
      'ctrl+k': () => openPalette('search'),
      'ctrl+n': () => openPalette('create_task'),
      'ctrl+i': () => openPalette('create_idea'),
      'escape': () => setPaletteOpen(false),
    }),
    []
  );

  useKeyboardShortcuts(shortcuts, !paletteOpen);

  const handleCapture = async (text: string) => {
    await inbox.capture(text);
  };

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar inboxCount={inbox.unprocessedCount} reviewDue={reviewDue} />

        <main className="flex-1 overflow-y-auto bg-grid">
          {children}
        </main>
      </div>

      {/* Desktop: bottom capture bar */}
      <QuickCapture onCapture={handleCapture} />

      {/* Mobile: bottom nav */}
      <MobileNav onCapture={() => setShowMobileCapture(true)} />

      {/* Mobile capture modal overlay */}
      {showMobileCapture && (
        <div className="fixed inset-0 z-[60] flex flex-col lg:hidden">
          <button
            type="button"
            onClick={() => setShowMobileCapture(false)}
            className="flex-1 bg-bg/80 backdrop-blur-sm"
            aria-label="Close capture"
          />
          <div
            className="bg-surface/95 backdrop-blur-md border-t border-border"
            style={{ animation: 'slideUp 0.2s ease-out' }}
          >
            <QuickCapture
              isModal
              onCapture={async (text) => {
                await handleCapture(text);
                setShowMobileCapture(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Command Palette */}
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        initialMode={paletteMode}
      />
    </div>
  );
}
