'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Inbox, FolderKanban, ListChecks, Plus } from 'lucide-react';

interface MobileNavProps {
  onCapture: () => void;
}

const tabs = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/routines', label: 'Routines', icon: ListChecks },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
];

export default function MobileNav({ onCapture }: MobileNavProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around lg:hidden"
      style={{
        background: 'rgba(17, 17, 24, 0.9)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(0, 255, 136, 0.08)',
      }}
    >
      {tabs.map((tab) => {
        const active = isActive(tab.href);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-col items-center gap-1 text-[10px] transition-colors duration-150 ${
              active ? 'text-accent' : 'text-text-muted'
            }`}
          >
            <Icon size={20} />
            <span>{tab.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onCapture}
        className="flex flex-col items-center gap-1 text-[10px] text-text-muted active:text-accent"
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent"
          style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}
        >
          <Plus size={18} className="text-bg" />
        </div>
        <span>Capture</span>
      </button>
    </nav>
  );
}
