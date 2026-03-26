'use client';

import { Pin, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Task, Area } from '@/lib/types';
import { PRIORITY_COLORS } from '@/lib/constants';
import { isOverdue, truncate, prioritySymbol } from '@/lib/helpers';
import Badge from '@/components/ui/Badge';

interface TaskRowProps {
  task: Task;
  onComplete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onStatusChange?: (id: string, status: Task['status']) => void;
  onClick: (task: Task) => void;
  areas?: Area[];
}

const STATUS_ICONS: Record<Task['status'], string> = {
  todo: '\u25A1',
  in_progress: '\u25D0',
  done: '\u25A0',
  cancelled: '\u25A0',
};

export default function TaskRow({ task, onComplete, onTogglePin, onStatusChange, onClick, areas }: TaskRowProps) {
  const router = useRouter();
  const area = areas?.find((a) => a.id === task.area_id);
  const overdue = isOverdue(task.due_date);
  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[3];

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.status === 'todo') {
      if (onStatusChange) {
        onStatusChange(task.id, 'in_progress');
      }
    } else if (task.status === 'in_progress') {
      onComplete(task.id);
    }
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(task.id);
  };

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded transition-all duration-150 hover:bg-surface2/50 group"
      style={{
        borderLeft: task.priority <= 2 ? `2px solid ${priorityColor}33` : '2px solid transparent',
      }}
      onClick={() => onClick(task)}
    >
      {/* Status icon */}
      <button
        onClick={handleStatusClick}
        className="font-mono text-sm shrink-0 hover:text-accent transition-colors duration-150"
        style={{
          color:
            task.status === 'done'
              ? PRIORITY_COLORS[3]
              : task.status === 'in_progress'
                ? '#3B82F6'
                : '#6B7280',
        }}
        title={task.status === 'todo' ? 'Start' : task.status === 'in_progress' ? 'Complete' : ''}
      >
        {STATUS_ICONS[task.status]}
      </button>

      {/* Priority indicator */}
      <span
        className="font-mono text-xs shrink-0"
        style={{
          color: priorityColor,
          textShadow: task.priority === 1 ? `0 0 6px ${priorityColor}66` : undefined,
        }}
      >
        [{prioritySymbol(task.priority)}]
      </span>

      {/* Title */}
      <span
        className={`font-mono text-sm flex-1 min-w-0 truncate ${
          task.status === 'done' ? 'line-through text-text-muted' : ''
        } ${overdue && task.status !== 'done' ? 'text-red-400' : 'text-text-primary'}`}
      >
        {truncate(task.title, 50)}
      </span>

      {/* Focus button */}
      {(task.status === 'todo' || task.status === 'in_progress') && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/focus?task=${task.id}`);
          }}
          className="shrink-0 text-text-muted/0 group-hover:text-text-muted hover:!text-accent transition-all duration-150"
          title="Focus on this task"
        >
          <Play size={14} />
        </button>
      )}

      {/* Pin indicator */}
      {task.is_pinned && (
        <button
          onClick={handlePinClick}
          className="shrink-0 text-accent opacity-70 hover:opacity-100 transition-opacity duration-150"
          title="Unpin"
        >
          <Pin size={12} />
        </button>
      )}

      {/* Area badge */}
      {area && (
        <Badge label={area.name} color={area.color} size="sm" />
      )}

      {/* Estimated time */}
      {task.estimated_minutes && (
        <span className="font-mono text-[11px] text-text-muted shrink-0">
          {task.estimated_minutes}m
        </span>
      )}
    </div>
  );
}
