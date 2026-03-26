'use client';

import ReviewStep from './ReviewStep';
import ProgressBar from '@/components/ui/ProgressBar';
import Badge from '@/components/ui/Badge';
import type { Project, Area } from '@/lib/types';

interface ProjectsStepProps {
  projects: Project[];
  areas: Area[];
  onUpdateStatus: (id: string, status: Project['status']) => void;
}

export default function ProjectsStep({ projects, areas, onUpdateStatus }: ProjectsStepProps) {
  const areaMap = new Map(areas.map((a) => [a.id, a]));

  return (
    <ReviewStep title="PROJECTS">
      <p className="font-mono text-sm text-text-muted mb-4">
        {projects.length} active project{projects.length !== 1 ? 's' : ''} to review
      </p>

      <div className="space-y-3">
        {projects.map((project) => {
          const area = areaMap.get(project.area_id);
          const total = project.task_count || 0;
          const done = project.completed_task_count || 0;
          const progress = total > 0 ? Math.round((done / total) * 100) : 0;

          return (
            <div
              key={project.id}
              className="rounded-lg border border-border bg-surface/50 p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-text-primary flex-1 truncate">
                  {project.title}
                </span>
                {area && <Badge label={area.name} color={area.color} size="sm" />}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <ProgressBar value={progress} color={area?.color} />
                </div>
                <span className="font-mono text-[10px] text-text-muted shrink-0">
                  {done}/{total}
                </span>
              </div>

              <div className="flex gap-2">
                {(['active', 'paused', 'completed', 'abandoned'] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => onUpdateStatus(project.id, status)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                      project.status === status
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-border text-text-muted hover:border-accent/20 hover:text-text-primary'
                    }`}
                  >
                    {status === 'active' ? 'Active' : status === 'paused' ? 'Pause' : status === 'completed' ? 'Complete' : 'Abandon'}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ReviewStep>
  );
}
