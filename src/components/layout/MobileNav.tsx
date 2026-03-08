'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Inbox, FolderKanban, Lightbulb, Plus } from 'lucide-react';

interface MobileNavProps {
  onCapture: () => void;
}

const tabs = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
];

export default function MobileNav({ onCapture }: MobileNavProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-border bg-surface lg:hidden">
      {tabs.map((tab) => {
        const active = isActive(tab.href);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-col items-center gap-1 text-[10px] ${
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
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent">
          <Plus size={18} className="text-bg" />
        </div>
        <span>Capture</span>
      </button>
    </nav>
  );
}
