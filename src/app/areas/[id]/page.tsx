'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAreas } from '@/hooks/useAreas';
import { useProjects } from '@/hooks/useProjects';
import { useTasks } from '@/hooks/useTasks';
import { useIdeas } from '@/hooks/useIdeas';
import { useRouter } from 'next/navigation';
import TaskRow from '@/components/tasks/TaskRow';
import TaskForm from '@/components/tasks/TaskForm';
import TaskDetail from '@/components/tasks/TaskDetail';
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectForm from '@/components/projects/ProjectForm';
import IdeaCard from '@/components/ideas/IdeaCard';
import IdeaForm from '@/components/ideas/IdeaForm';
import LoadingState from '@/components/ui/LoadingState';
import type { Task, Idea } from '@/lib/types';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';

export default function AreaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const areaId = params.id as string;

  const { areas } = useAreas();
  const { projects, createProject } = useProjects({ area_id: areaId });
  const { tasks, loading, completeTask, togglePin, updateTask, deleteTask, createTask } = useTasks({ area_id: areaId });
  const { ideas, rateIdea, updateIdea } = useIdeas({ area_id: areaId });

  const area = areas.find((a) => a.id === areaId);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);

  if (loading || !area) {
    return <AppShell><div className="p-6"><LoadingState /></div></AppShell>;
  }

  const activeProjects = projects.filter((p) => p.status === 'active');

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:px-10 lg:py-6 page-enter">
        {/* Header */}
        <Link href="/areas" className="mb-2 inline-flex items-center gap-1 font-mono text-xs text-text-muted hover:text-accent">
          <ArrowLeft size={14} /> AREAS
        </Link>
        <h1 className="flex items-center gap-2 font-mono text-xl font-bold">
          <span style={{ color: area.color }}>{area.icon}</span>
          <span style={{ color: area.color }}>{area.name}</span>
        </h1>

        {/* Projects */}
        {activeProjects.length > 0 && (
          <>
            <SectionHeader title="PROJECTS" count={`${activeProjects.length} active`} />
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {activeProjects.map((p) => (
                <ProjectCard key={p.id} project={p} areas={areas} onClick={(p) => router.push(`/projects/${p.id}`)} />
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => setShowProjectForm(true)}
          className="mb-4 flex items-center gap-1 font-mono text-xs text-accent hover:text-accent-dim"
        >
          <Plus size={12} /> Add Project
        </button>

        {/* Tasks */}
        <SectionHeader title="TASKS" count={`${tasks.length} open`} />
        {tasks.length > 0 ? (
          <div className="mb-4">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} areas={areas} onComplete={completeTask} onTogglePin={togglePin} onClick={setSelectedTask} />
            ))}
          </div>
        ) : (
          <p className="mb-4 font-mono text-xs text-text-muted">No open tasks</p>
        )}

        <button
          onClick={() => setShowTaskForm(true)}
          className="mb-4 flex items-center gap-1 font-mono text-xs text-accent hover:text-accent-dim"
        >
          <Plus size={12} /> Add Task
        </button>

        {/* Ideas */}
        {ideas.length > 0 && (
          <>
            <SectionHeader title="IDEAS" count={`${ideas.length}`} />
            {ideas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} areas={areas} onRate={rateIdea} onClick={setSelectedIdea} />
            ))}
          </>
        )}
      </div>

      {selectedTask && (
        <TaskDetail
          task={selectedTask} isOpen={!!selectedTask} onClose={() => setSelectedTask(null)}
          onComplete={completeTask} onTogglePin={togglePin} onUpdate={updateTask}
          onDelete={async (id) => { await deleteTask(id); setSelectedTask(null); }} areas={areas}
        />
      )}

      {showTaskForm && (
        <TaskForm
          defaultAreaId={areaId}
          onClose={() => setShowTaskForm(false)}
          onSave={async (data) => { await createTask({ ...data, area_id: areaId }); setShowTaskForm(false); }}
        />
      )}

      {showProjectForm && (
        <ProjectForm
          defaultAreaId={areaId}
          onClose={() => setShowProjectForm(false)}
          onSave={async (data) => { await createProject({ ...data, area_id: areaId }); setShowProjectForm(false); }}
        />
      )}

      {selectedIdea && (
        <IdeaForm
          idea={selectedIdea}
          onClose={() => setSelectedIdea(null)}
          onSave={async (data) => {
            await updateIdea(selectedIdea.id, data);
            setSelectedIdea(null);
          }}
        />
      )}
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
