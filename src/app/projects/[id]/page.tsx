'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useAreas } from '@/hooks/useAreas';
import TaskRow from '@/components/tasks/TaskRow';
import TaskForm from '@/components/tasks/TaskForm';
import TaskDetail from '@/components/tasks/TaskDetail';
import ProjectForm from '@/components/projects/ProjectForm';
import ProgressBar from '@/components/ui/ProgressBar';
import Badge from '@/components/ui/Badge';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import type { Task } from '@/lib/types';
import { formatRelativeDate, isOverdue } from '@/lib/helpers';
import { PRIORITY_COLORS } from '@/lib/constants';
import { ArrowLeft, Pencil, Trash2, Plus } from 'lucide-react';
import Link from 'next/link';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const { projects, updateProject, deleteProject } = useProjects();
  const { tasks, loading: tasksLoading, completeTask, togglePin, updateTask, deleteTask, createTask } = useTasks({ project_id: projectId });
  const { areas } = useAreas();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  const area = areas.find((a) => a.id === project?.area_id);

  const grouped = useMemo(() => ({
    todo: tasks.filter((t) => t.status === 'todo'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    done: tasks.filter((t) => t.status === 'done'),
  }), [tasks]);

  const totalTasks = tasks.filter((t) => t.status !== 'cancelled').length;
  const doneTasks = grouped.done.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  if (tasksLoading || !project) {
    return <AppShell><div className="p-6"><LoadingState /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 lg:px-10 lg:py-6 page-enter">
        {/* Header */}
        <div className="mb-6">
          <Link href="/projects" className="mb-2 inline-flex items-center gap-1 font-mono text-xs text-text-muted hover:text-accent">
            <ArrowLeft size={14} /> PROJECTS
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-mono text-xl font-bold text-text-primary">{project.title}</h1>
                {area && <Badge label={area.name} color={area.color} size="sm" />}
              </div>
              {project.description && (
                <p className="mt-1 font-sans text-sm text-text-muted">{project.description}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowProjectForm(true)} className="rounded p-1.5 text-text-muted hover:bg-surface2 hover:text-text-primary">
                <Pencil size={16} />
              </button>
              <button onClick={() => setConfirmDelete(true)} className="rounded p-1.5 text-text-muted hover:bg-surface2 hover:text-red-400">
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-3">
            <ProgressBar value={progress} />
            <div className="mt-1 flex items-center gap-3 font-mono text-xs text-text-muted">
              <span>{doneTasks}/{totalTasks} tasks</span>
              {project.deadline && (
                <>
                  <span className="text-border">•</span>
                  <span className={isOverdue(project.deadline) ? 'text-red-400' : ''}>
                    Due: {formatRelativeDate(project.deadline)}
                  </span>
                </>
              )}
              <span className="text-border">•</span>
              <Badge label={`P${project.priority}`} color={PRIORITY_COLORS[project.priority]} size="sm" />
            </div>
          </div>
        </div>

        {/* Task sections */}
        {grouped.todo.length > 0 && (
          <>
            <SectionHeader title="TODO" />
            {grouped.todo.map((t) => (
              <TaskRow key={t.id} task={t} areas={areas} onComplete={completeTask} onTogglePin={togglePin} onClick={setSelectedTask} />
            ))}
          </>
        )}

        {grouped.in_progress.length > 0 && (
          <>
            <SectionHeader title="IN PROGRESS" />
            {grouped.in_progress.map((t) => (
              <TaskRow key={t.id} task={t} areas={areas} onComplete={completeTask} onTogglePin={togglePin} onClick={setSelectedTask} />
            ))}
          </>
        )}

        {grouped.done.length > 0 && (
          <>
            <SectionHeader title="DONE" />
            {grouped.done.map((t) => (
              <TaskRow key={t.id} task={t} areas={areas} onComplete={completeTask} onTogglePin={togglePin} onClick={setSelectedTask} />
            ))}
          </>
        )}

        {/* Add task button */}
        <button
          onClick={() => setShowTaskForm(true)}
          className="mt-4 flex items-center gap-2 rounded border border-border px-3 py-2 font-mono text-sm text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <Plus size={14} /> Add Task
        </button>
      </div>

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={completeTask}
          onTogglePin={togglePin}
          onUpdate={updateTask}
          onDelete={async (id) => { await deleteTask(id); setSelectedTask(null); }}
          areas={areas}
        />
      )}

      {showTaskForm && (
        <TaskForm
          defaultProjectId={projectId}
          defaultAreaId={project.area_id}
          onClose={() => setShowTaskForm(false)}
          onSave={async (data) => { await createTask({ ...data, project_id: projectId }); setShowTaskForm(false); }}
        />
      )}

      {showProjectForm && (
        <ProjectForm
          project={project}
          onClose={() => setShowProjectForm(false)}
          onSave={async (data) => { await updateProject(project.id, data); setShowProjectForm(false); }}
        />
      )}

      <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Project">
        <p className="font-sans text-sm text-text-muted">
          Delete &quot;{project.title}&quot;? Tasks in this project will be unlinked, not deleted.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <button onClick={() => setConfirmDelete(false)} className="rounded px-3 py-1.5 font-mono text-sm text-text-muted hover:bg-surface2">Cancel</button>
          <button
            onClick={async () => { await deleteProject(project.id); router.push('/projects'); }}
            className="rounded bg-red-500/20 px-3 py-1.5 font-mono text-sm text-red-400 hover:bg-red-500/30"
          >Delete</button>
        </div>
      </Modal>
    </AppShell>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[3px]" style={{ color: '#4A6858' }}>
      <span>--</span>
      <span>{title}</span>
      <span className="flex-1 section-line" />
    </div>
  );
}
