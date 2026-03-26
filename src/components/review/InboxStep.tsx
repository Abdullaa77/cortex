'use client';

import { useState } from 'react';
import ReviewStep from './ReviewStep';
import { useInbox } from '@/components/providers/InboxProvider';
import ProcessModal from '@/components/inbox/ProcessModal';
import type { InboxItem } from '@/lib/types';

export default function InboxStep() {
  const inbox = useInbox();
  const [processItem, setProcessItem] = useState<InboxItem | null>(null);
  const [processType, setProcessType] = useState<'task' | 'idea' | 'project'>('task');

  const handleProcess = async (type: string, inboxId: string, data: Record<string, unknown>) => {
    if (type === 'task') {
      await inbox.processToTask(inboxId, data as { title: string; area_id: string; priority?: number; project_id?: string; due_date?: string });
    } else if (type === 'idea') {
      await inbox.processToIdea(inboxId, data as { title: string; area_id?: string; body?: string });
    } else if (type === 'project') {
      await inbox.processToProject(inboxId, data as { title: string; area_id: string; description?: string });
    }
  };

  if (inbox.items.length === 0) {
    return (
      <ReviewStep title="INBOX">
        <div className="text-center py-12">
          <p className="font-mono text-2xl text-accent text-glow mb-2">Inbox zero.</p>
          <p className="font-mono text-sm text-text-muted">Nothing to process.</p>
        </div>
      </ReviewStep>
    );
  }

  return (
    <ReviewStep title="INBOX">
      <p className="font-mono text-sm text-text-muted mb-4">
        {inbox.items.length} unprocessed item{inbox.items.length !== 1 ? 's' : ''}
      </p>

      <div className="space-y-1">
        {inbox.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded hover:bg-surface2/50 transition-colors group"
          >
            <span className="font-mono text-sm text-text-muted">☐</span>
            <span className="font-mono text-sm text-text-primary flex-1 truncate">
              {item.raw_text}
            </span>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {(['task', 'idea', 'project'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setProcessItem(item);
                    setProcessType(type);
                  }}
                  className="px-2 py-0.5 text-[10px] font-mono border border-border rounded text-text-muted hover:text-accent hover:border-accent/30 transition-colors"
                >
                  {type === 'task' ? '→ Task' : type === 'idea' ? '→ Idea' : '→ Project'}
                </button>
              ))}
              <button
                onClick={() => inbox.trash(item.id)}
                className="px-2 py-0.5 text-[10px] font-mono border border-border rounded text-text-muted hover:text-red-400 hover:border-red-400/30 transition-colors"
              >
                Trash
              </button>
            </div>
          </div>
        ))}
      </div>

      <ProcessModal
        item={processItem}
        processType={processType}
        isOpen={!!processItem}
        onClose={() => setProcessItem(null)}
        onProcess={handleProcess}
      />
    </ReviewStep>
  );
}
