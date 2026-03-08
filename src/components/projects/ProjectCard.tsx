'use client';

import type { Project, Area } from '@/lib/types';
import { PRIORITY_COLORS } from '@/lib/constants';
import { formatRelativeDate, isOverdue, truncate } from '@/lib/helpers';
import Badge from '@/components/ui/Badge';
import ProgressBar from '@/components/ui/ProgressBar';

interface ProjectCardProps {
  project: Project;
  onClick: (project: Project) => void;
  areas?: Area[];
}

export default function ProjectCard({ project, onClick, areas }: ProjectCardProps) {
  const area = areas?.find((a) => a.id === project.area_id);
  const taskCount = project.task_count || 0;
  const completedCount = project.completed_task_count || 0;
  const progress = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;
  const priorityColor = PRIORITY_COLORS[project.priority] || PRIORITY_COLORS[2];
  const deadlineOverdue = project.deadline ? isOverdue(project.deadline) : false;

  return (
    <div
      onClick={() => onClick(project)}
      className="p-4 bg-surface border border-border rounded-lg cursor-pointer transition-all duration-200 hover:border-accent/30"
      style={{
        boxShadow: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 255, 136, 0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Header: title + area badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-mono text-sm font-semibold text-text-primary truncate">
          {project.title}
        </h3>
        {area && <Badge label={area.name} color={area.color} size="sm" />}
      </div>

      {/* Description */}
      {project.description && (
        <p className="font-mono text-xs text-text-muted mb-3 truncate">
          {truncate(project.description, 80)}
        </p>
      )}

      {/* Progress */}
      <div className="mb-3">
        <ProgressBar value={progress} />
        <span className="font-mono text-xs text-text-muted mt-1 inline-block">
          {completedCount}/{taskCount} tasks
        </span>
      </div>

      {/* Footer: deadline + priority */}
      <div className="flex items-center gap-3">
        {project.deadline && (
          <span
            className={`font-mono text-xs ${
              deadlineOverdue && project.status !== 'completed' ? 'text-red-400' : 'text-text-muted'
            }`}
          >
            Due: {formatRelativeDate(project.deadline)}
          </span>
        )}
        <Badge
          label={`P${project.priority}`}
          color={priorityColor}
          size="sm"
        />
      </div>
    </div>
  );
}
