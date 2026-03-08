'use client';

import { useState, type ReactNode } from 'react';
import { useInbox } from '@/components/providers/InboxProvider';
import Header from './Header';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import QuickCapture from './QuickCapture';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const inbox = useInbox();
  const [showMobileCapture, setShowMobileCapture] = useState(false);

  const handleCapture = async (text: string) => {
    await inbox.capture(text);
  };

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar inboxCount={inbox.unprocessedCount} />

        <main className="flex-1 overflow-y-auto">
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
          <div className="bg-surface border-t border-border">
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
    </div>
  );
}
