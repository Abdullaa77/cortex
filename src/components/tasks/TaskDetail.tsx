'use client';

import { useState } from 'react';
import { Pin, PinOff, Trash2, Pencil } from 'lucide-react';
import type { Task, Area } from '@/lib/types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/constants';
import { formatRelativeDate, isOverdue, prioritySymbol } from '@/lib/helpers';
import Modal from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import TaskForm from './TaskForm';

interface TaskDetailProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  areas?: Area[];
}

const STATUS_ICONS: Record<Task['status'], string> = {
  todo: '□',
  in_progress: '◐',
  done: '■',
  cancelled: '■',
};

const STATUS_LABELS: Record<Task['status'], string> = {
  todo: 'TODO',
  in_progress: 'IN PROGRESS',
  done: 'DONE',
  cancelled: 'CANCELLED',
};

const STATUS_FLOW: Task['status'][] = ['todo', 'in_progress', 'done'];

export default function TaskDetail({
  task,
  isOpen,
  onClose,
  onComplete,
  onTogglePin,
  onUpdate,
  onDelete,
  areas,
}: TaskDetailProps) {
  const [showEditForm, setShowEditForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const area = areas?.find((a) => a.id === task.area_id);
  const overdue = isOverdue(task.due_date);
  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[3];

  const handleStatusChange = (newStatus: Task['status']) => {
    if (newStatus === 'done') {
      onComplete(task.id);
    } else {
      onUpdate(task.id, { status: newStatus });
    }
  };

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(task.id);
      onClose();
    } else {
      setConfirmDelete(true);
    }
  };

  const handleEditSave = async (data: Record<string, unknown>) => {
    onUpdate(task.id, data as Partial<Task>);
  };

  if (showEditForm) {
    return (
      <TaskForm
        task={task}
        onClose={() => setShowEditForm(false)}
        onSave={handleEditSave}
      />
    );
  }

  const footer = (
    <div className="flex items-center justify-between">
      <div className="flex gap-2">
        {/* Complete / Reopen */}
        {task.status !== 'done' ? (
          <button
            onClick={() => onComplete(task.id)}
            className="px-3 py-1.5 font-mono text-xs rounded bg-accent text-bg font-semibold hover:bg-accent-dim transition-colors duration-150"
          >
            Complete
          </button>
        ) : (
          <button
            onClick={() => onUpdate(task.id, { status: 'todo', completed_at: null })}
            className="px-3 py-1.5 font-mono text-xs rounded border border-border text-text-muted hover:text-text-primary transition-colors duration-150"
          >
            Reopen
          </button>
        )}

        {/* Pin / Unpin */}
        <button
          onClick={() => onTogglePin(task.id)}
          className="px-3 py-1.5 font-mono text-xs rounded border border-border text-text-muted hover:text-text-primary transition-colors duration-150 flex items-center gap-1.5"
        >
          {task.is_pinned ? <PinOff size={12} /> : <Pin size={12} />}
          {task.is_pinned ? 'Unpin' : 'Pin'}
        </button>

        {/* Edit */}
        <button
          onClick={() => setShowEditForm(true)}
          className="px-3 py-1.5 font-mono text-xs rounded border border-border text-text-muted hover:text-text-primary transition-colors duration-150 flex items-center gap-1.5"
        >
          <Pencil size={12} />
          Edit
        </button>
      </div>

      {/* Delete */}
      <button
        onClick={handleDelete}
        className={`px-3 py-1.5 font-mono text-xs rounded border transition-colors duration-150 flex items-center gap-1.5 ${
          confirmDelete
            ? 'border-red-500 bg-red-500/20 text-red-400'
            : 'border-border text-text-muted hover:text-red-400 hover:border-red-400/50'
        }`}
      >
        <Trash2 size={12} />
        {confirmDelete ? 'Confirm?' : 'Delete'}
      </button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="── TASK DETAIL" footer={footer}>
      <div className="flex flex-col gap-4">
        {/* Title */}
        <h3
          className={`font-mono text-lg font-semibold ${
            overdue && task.status !== 'done' ? 'text-red-400' : 'text-text-primary'
          }`}
        >
          {task.title}
        </h3>

        {/* Status flow */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-2">Status</label>
          <div className="flex gap-2">
            {STATUS_FLOW.map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                className="px-3 py-1.5 font-mono text-xs rounded border transition-all duration-150"
                style={{
                  borderColor: task.status === s ? 'var(--color-accent)' : 'var(--color-border)',
                  backgroundColor: task.status === s ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                  color: task.status === s ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                {STATUS_ICONS[s]} {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Priority */}
          <Badge
            label={`[${prioritySymbol(task.priority)}] ${PRIORITY_LABELS[task.priority]}`}
            color={priorityColor}
          />

          {/* Area */}
          {area && <Badge label={area.name} color={area.color} />}

          {/* Pinned */}
          {task.is_pinned && <Badge label="Pinned" color="#00FF88" />}
        </div>

        {/* Due date */}
        {task.due_date && (
          <div>
            <label className="block font-mono text-xs text-text-muted uppercase mb-1">Due</label>
            <span
              className={`font-mono text-sm ${
                overdue && task.status !== 'done' ? 'text-red-400' : 'text-text-primary'
              }`}
            >
              {formatRelativeDate(task.due_date)}
            </span>
          </div>
        )}

        {/* Estimated time */}
        {task.estimated_minutes && (
          <div>
            <label className="block font-mono text-xs text-text-muted uppercase mb-1">
              Estimated
            </label>
            <span className="font-mono text-sm text-text-primary">{task.estimated_minutes}m</span>
          </div>
        )}

        {/* Description */}
        {task.description && (
          <div>
            <label className="block font-mono text-xs text-text-muted uppercase mb-1">
              Description
            </label>
            <p className="font-sans text-sm text-text-primary whitespace-pre-wrap">
              {task.description}
            </p>
          </div>
        )}

        {/* Project */}
        {task.project && (
          <div>
            <label className="block font-mono text-xs text-text-muted uppercase mb-1">
              Project
            </label>
            <span className="font-mono text-sm text-text-primary">{task.project.title}</span>
          </div>
        )}

        {/* Timestamps */}
        <div className="pt-2 border-t border-border">
          <span className="font-mono text-xs text-text-muted">
            Created {formatRelativeDate(task.created_at.split('T')[0])}
            {task.completed_at &&
              ` · Completed ${formatRelativeDate(task.completed_at.split('T')[0])}`}
          </span>
        </div>
      </div>
    </Modal>
  );
}
