'use client';

import { useState, useEffect } from 'react';
import type { Task } from '@/lib/types';
import { PRIORITY_COLORS } from '@/lib/constants';
import { useAreas } from '@/hooks/useAreas';
import { useProjects } from '@/hooks/useProjects';
import Modal from '@/components/ui/Modal';

interface TaskFormProps {
  task?: Task;
  defaultAreaId?: string;
  defaultProjectId?: string;
  onClose: () => void;
  onSave: (data: {
    title: string;
    area_id: string;
    project_id?: string;
    priority: number;
    due_date?: string;
    description?: string;
    estimated_minutes?: number;
  }) => Promise<void>;
}

export default function TaskForm({
  task,
  defaultAreaId,
  defaultProjectId,
  onClose,
  onSave,
}: TaskFormProps) {
  const { areas } = useAreas();

  const [title, setTitle] = useState(task?.title || '');
  const [areaId, setAreaId] = useState(task?.area_id || defaultAreaId || '');
  const [priority, setPriority] = useState<number>(task?.priority || 3);
  const [dueDate, setDueDate] = useState(task?.due_date || '');
  const [projectId, setProjectId] = useState(task?.project_id || defaultProjectId || '');
  const [description, setDescription] = useState(task?.description || '');
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>(
    task?.estimated_minutes?.toString() || ''
  );
  const [saving, setSaving] = useState(false);

  const { projects } = useProjects(areaId ? { area_id: areaId } : undefined);

  // Set default area when areas load
  useEffect(() => {
    if (!areaId && areas.length > 0) {
      setAreaId(defaultAreaId || areas[0].id);
    }
  }, [areas, areaId, defaultAreaId]);

  // Clear project if area changes and project doesn't match
  useEffect(() => {
    if (projectId && projects.length > 0) {
      const projectBelongsToArea = projects.some((p) => p.id === projectId);
      if (!projectBelongsToArea) {
        setProjectId('');
      }
    }
  }, [areaId, projects, projectId]);

  const handleSubmit = async () => {
    if (!title.trim() || !areaId) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        area_id: areaId,
        project_id: projectId || undefined,
        priority,
        due_date: dueDate || undefined,
        description: description.trim() || undefined,
        estimated_minutes: estimatedMinutes ? parseInt(estimatedMinutes, 10) : undefined,
      });
      onClose();
    } catch {
      // Error handling is done by the parent via the hook
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        onClick={onClose}
        className="px-4 py-2 font-mono text-sm text-text-muted hover:text-text-primary transition-colors duration-150"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={!title.trim() || !areaId || saving}
        className="px-4 py-2 font-mono text-sm rounded bg-accent text-bg font-semibold hover:bg-accent-dim transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : task ? 'Update' : 'Create'}
      </button>
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title={task ? '── EDIT TASK' : '── NEW TASK'} footer={footer}>
      <div className="flex flex-col gap-4">
        {/* Title */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="Task title..."
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors duration-150"
          />
        </div>

        {/* Area */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Area</label>
          <select
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors duration-150"
          >
            <option value="">Select area...</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.icon} {area.name}
              </option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Priority</label>
          <div className="flex gap-2">
            {([1, 2, 3, 4] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className="px-3 py-1.5 font-mono text-xs rounded border transition-all duration-150"
                style={{
                  borderColor: priority === p ? PRIORITY_COLORS[p] : 'var(--color-border)',
                  backgroundColor: priority === p ? `${PRIORITY_COLORS[p]}22` : 'transparent',
                  color: priority === p ? PRIORITY_COLORS[p] : 'var(--color-text-muted)',
                }}
              >
                P{p}
              </button>
            ))}
          </div>
        </div>

        {/* Due date */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors duration-150"
          />
        </div>

        {/* Project */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">
            Project <span className="normal-case">(optional)</span>
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors duration-150"
          >
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">
            Description <span className="normal-case">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Details..."
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors duration-150 resize-none"
          />
        </div>

        {/* Estimated minutes */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">
            Estimated Minutes <span className="normal-case">(optional)</span>
          </label>
          <input
            type="number"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
            min={1}
            placeholder="e.g. 30"
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors duration-150"
          />
        </div>
      </div>
    </Modal>
  );
}
