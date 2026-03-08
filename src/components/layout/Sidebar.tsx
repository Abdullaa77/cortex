'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Inbox,
  FolderKanban,
  Layout,
  Lightbulb,
  Settings,
} from 'lucide-react';

interface SidebarProps {
  inboxCount: number;
}

const navItems = [
  { href: '/', label: 'Terminal', icon: Home },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/areas', label: 'Areas', icon: Layout },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
];

export default function Sidebar({ inboxCount }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside
      className="hidden lg:flex flex-col w-[220px] font-mono text-sm h-full"
      style={{
        background: 'linear-gradient(180deg, #0A0A0F 0%, #0D0D14 100%)',
        borderRight: '1px solid rgba(0, 255, 136, 0.06)',
      }}
    >
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded px-3 py-3 transition-all duration-150 ${
                active
                  ? 'border-l-2 border-accent text-accent text-glow-sm'
                  : 'border-l-2 border-transparent text-text-muted hover:bg-surface2/50 hover:text-text-primary'
              }`}
            >
              {active && <span className="text-accent">{'>'}</span>}
              <Icon size={16} />
              <span>{item.label}</span>
              {item.href === '/inbox' && inboxCount > 0 && (
                <span
                  className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-bg"
                  style={{ animation: 'badge-pop 0.3s ease-out' }}
                  key={inboxCount}
                >
                  {inboxCount}
                </span>
              )}
            </Link>
          );
        })}

        <div className="my-2 section-line" />

        <Link
          href="/settings"
          className={`flex items-center gap-2 rounded px-3 py-3 transition-all duration-150 ${
            pathname.startsWith('/settings')
              ? 'border-l-2 border-accent text-accent text-glow-sm'
              : 'border-l-2 border-transparent text-text-muted hover:bg-surface2/50 hover:text-text-primary'
          }`}
        >
          {pathname.startsWith('/settings') && (
            <span className="text-accent">{'>'}</span>
          )}
          <Settings size={16} />
          <span>Settings</span>
        </Link>
      </nav>
    </aside>
  );
}
