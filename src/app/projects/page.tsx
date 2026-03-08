'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useProjects } from '@/hooks/useProjects';
import { useAreas } from '@/hooks/useAreas';
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectForm from '@/components/projects/ProjectForm';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import type { Project, Area } from '@/lib/types';
import { Plus } from 'lucide-react';

export default function ProjectsPage() {
  const { projects, loading, createProject } = useProjects();
  const { areas } = useAreas();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const grouped = {
    active: projects.filter((p) => p.status === 'active'),
    paused: projects.filter((p) => p.status === 'paused'),
    completed: projects.filter((p) => p.status === 'completed'),
    abandoned: projects.filter((p) => p.status === 'abandoned'),
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return <AppShell><div className="p-6"><LoadingState /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet."
            description="Start one."
            action={{ label: '+ New Project', onClick: () => setShowForm(true) }}
          />
        ) : (
          <>
            <ProjectSection
              title="ACTIVE"
              projects={grouped.active}
              areas={areas}
              onClickProject={(p) => router.push(`/projects/${p.id}`)}
              defaultExpanded
            />
            {grouped.paused.length > 0 && (
              <CollapsibleSection
                title="PAUSED"
                count={grouped.paused.length}
                expanded={!!expandedSections.paused}
                onToggle={() => toggleSection('paused')}
              >
                <ProjectGrid projects={grouped.paused} areas={areas} onClick={(p) => router.push(`/projects/${p.id}`)} />
              </CollapsibleSection>
            )}
            {grouped.completed.length > 0 && (
              <CollapsibleSection
                title="COMPLETED"
                count={grouped.completed.length}
                expanded={!!expandedSections.completed}
                onToggle={() => toggleSection('completed')}
              >
                <ProjectGrid projects={grouped.completed} areas={areas} onClick={(p) => router.push(`/projects/${p.id}`)} />
              </CollapsibleSection>
            )}
            {grouped.abandoned.length > 0 && (
              <CollapsibleSection
                title="ABANDONED"
                count={grouped.abandoned.length}
                expanded={!!expandedSections.abandoned}
                onToggle={() => toggleSection('abandoned')}
              >
                <ProjectGrid projects={grouped.abandoned} areas={areas} onClick={(p) => router.push(`/projects/${p.id}`)} />
              </CollapsibleSection>
            )}
          </>
        )}

        {/* FAB */}
        <button
          onClick={() => setShowForm(true)}
          className="fixed bottom-20 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-bg shadow-lg transition-transform hover:scale-105 lg:bottom-20"
        >
          <Plus size={24} />
        </button>
      </div>

      {showForm && (
        <ProjectForm
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            await createProject(data);
            setShowForm(false);
          }}
        />
      )}
    </AppShell>
  );
}

function ProjectSection({ title, projects, areas, onClickProject, defaultExpanded }: {
  title: string; projects: Project[]; areas: Area[];
  onClickProject: (p: Project) => void; defaultExpanded?: boolean;
}) {
  if (projects.length === 0 && !defaultExpanded) return null;
  return (
    <>
      <SectionHeader title={title} />
      <ProjectGrid projects={projects} areas={areas} onClick={onClickProject} />
    </>
  );
}

function ProjectGrid({ projects, areas, onClick }: {
  projects: Project[]; areas: Area[];
  onClick: (p: Project) => void;
}) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} areas={areas} onClick={onClick} />
      ))}
    </div>
  );
}

function CollapsibleSection({ title, count, expanded, onToggle, children }: {
  title: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <>
      <button onClick={onToggle} className="mb-3 mt-6 flex w-full items-center gap-2 font-mono text-xs uppercase text-text-muted hover:text-text-primary">
        <span className="text-border">──</span>
        <span>{title}</span>
        <span className="text-text-muted">({count})</span>
        <span className="flex-1 text-border">─────────────────────</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && children}
    </>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-2 font-mono text-xs uppercase text-text-muted">
      <span className="text-border">──</span>
      <span>{title}</span>
      <span className="flex-1 text-border">─────────────────────</span>
    </div>
  );
}
