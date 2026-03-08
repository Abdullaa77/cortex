'use client';

import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useInbox } from '@/components/providers/InboxProvider';
import InboxItemComponent from '@/components/inbox/InboxItem';
import ProcessModal from '@/components/inbox/ProcessModal';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import type { InboxItem } from '@/lib/types';

export default function InboxPage() {
  const { items, loading, processToTask, processToIdea, processToProject, trash } = useInbox();
  const [processItem, setProcessItem] = useState<InboxItem | null>(null);
  const [processType, setProcessType] = useState<'task' | 'idea' | 'project'>('task');

  const handleProcess = (item: InboxItem, type: 'task' | 'idea' | 'project' | 'trash') => {
    if (type === 'trash') {
      trash(item.id);
      return;
    }
    setProcessItem(item);
    setProcessType(type);
  };

  const handleProcessSubmit = async (type: string, inboxId: string, data: Record<string, unknown>) => {
    if (type === 'task') {
      await processToTask(inboxId, data as { title: string; area_id: string; priority?: number; project_id?: string; due_date?: string });
    } else if (type === 'idea') {
      await processToIdea(inboxId, data as { title: string; area_id?: string; body?: string });
    } else if (type === 'project') {
      await processToProject(inboxId, data as { title: string; area_id: string; description?: string });
    }
  };

  if (loading) {
    return <AppShell><div className="p-6"><LoadingState /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:px-10 lg:py-6 page-enter">
        <SectionHeader title="INBOX" count={items.length > 0 ? `${items.length} unprocessed` : undefined} />

        {items.length === 0 ? (
          <EmptyState title="Inbox zero." description="Your mind is clear." />
        ) : (
          <div>
            {items.map((item) => (
              <InboxItemComponent
                key={item.id}
                item={item}
                onProcess={handleProcess}
              />
            ))}
          </div>
        )}
      </div>

      <ProcessModal
        item={processItem}
        processType={processType}
        isOpen={!!processItem}
        onClose={() => setProcessItem(null)}
        onProcess={handleProcessSubmit}
      />
    </AppShell>
  );
}

function SectionHeader({ title, count }: { title: string; count?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
      <span>--</span>
      <span>{title}</span>
      {count && <span className="tracking-normal font-normal text-text-muted">({count})</span>}
      <span className="flex-1 section-line" />
    </div>
  );
}
