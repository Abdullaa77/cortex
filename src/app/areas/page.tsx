'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAreas } from '@/hooks/useAreas';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';

interface AreaCounts {
  projects: Record<string, number>;
  tasks: Record<string, number>;
}

export default function AreasPage() {
  const { areas, loading, createArea } = useAreas();
  const { supabase, session } = useSupabase();
  const router = useRouter();
  const [counts, setCounts] = useState<AreaCounts>({ projects: {}, tasks: {} });
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', icon: '◉', color: '#00FF88' });

  useEffect(() => {
    if (!session?.user || areas.length === 0) return;
    let cancelled = false;
    (async () => {
      const [projectsRes, tasksRes] = await Promise.all([
        supabase.from('projects').select('area_id, status').eq('status', 'active'),
        supabase.from('tasks').select('area_id, status').in('status', ['todo', 'in_progress']),
      ]);
      if (cancelled) return;
      const pc: Record<string, number> = {};
      const tc: Record<string, number> = {};
      for (const p of projectsRes.data || []) { pc[p.area_id] = (pc[p.area_id] || 0) + 1; }
      for (const t of tasksRes.data || []) { tc[t.area_id] = (tc[t.area_id] || 0) + 1; }
      setCounts({ projects: pc, tasks: tc });
    })();
    return () => { cancelled = true; };
  }, [supabase, session?.user, areas]);

  if (loading) {
    return <AppShell><div className="p-6"><LoadingState /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        <div className="mb-3 mt-6 flex items-center gap-2 font-mono text-xs uppercase text-text-muted">
          <span className="text-border">──</span>
          <span>AREAS</span>
          <span className="flex-1 text-border">─────────────────────</span>
        </div>

        <div>
          {areas.map((area) => {
            const pCount = counts.projects[area.id] || 0;
            const tCount = counts.tasks[area.id] || 0;
            return (
              <button
                key={area.id}
                onClick={() => router.push(`/areas/${area.id}`)}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left font-mono text-sm transition-colors hover:bg-surface2"
              >
                <span style={{ color: area.color }} className="w-5 text-center">{area.icon}</span>
                <span className="flex-1 font-bold uppercase tracking-wide" style={{ color: area.color }}>
                  {area.name}
                </span>
                <span className="text-xs text-text-muted">
                  {pCount} project{pCount !== 1 ? 's' : ''} &middot; {tCount} task{tCount !== 1 ? 's' : ''}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowForm(true)}
          className="mt-4 font-mono text-xs text-accent hover:text-accent-dim"
        >
          + Add Area
        </button>
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="New Area">
        <div className="space-y-3">
          <input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Area name"
            className="w-full rounded border border-border bg-surface2 px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            autoFocus
          />
          <div className="flex gap-3">
            <input
              value={formData.icon}
              onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
              placeholder="Icon"
              className="w-16 rounded border border-border bg-surface2 px-3 py-2 text-center font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
            <input
              type="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="h-10 w-10 cursor-pointer rounded border border-border bg-surface2"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button onClick={() => setShowForm(false)} className="rounded px-3 py-1.5 font-mono text-sm text-text-muted hover:bg-surface2">Cancel</button>
          <button
            disabled={!formData.name.trim()}
            onClick={async () => {
              await createArea(formData);
              setShowForm(false);
              setFormData({ name: '', icon: '◉', color: '#00FF88' });
            }}
            className="rounded bg-accent/20 px-3 py-1.5 font-mono text-sm text-accent hover:bg-accent/30 disabled:opacity-50"
          >Create</button>
        </div>
      </Modal>
    </AppShell>
  );
}
