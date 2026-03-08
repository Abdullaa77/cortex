'use client';

import { useState, useEffect } from 'react';
import type { Project } from '@/lib/types';
import { PRIORITY_COLORS } from '@/lib/constants';
import { useAreas } from '@/hooks/useAreas';
import Modal from '@/components/ui/Modal';

interface ProjectFormProps {
  project?: Project;
  defaultAreaId?: string;
  onClose: () => void;
  onSave: (data: {
    title: string;
    area_id: string;
    description?: string;
    priority: 1 | 2 | 3;
    deadline?: string;
  }) => Promise<void>;
}

export default function ProjectForm({
  project,
  defaultAreaId,
  onClose,
  onSave,
}: ProjectFormProps) {
  const { areas } = useAreas();

  const [title, setTitle] = useState(project?.title || '');
  const [areaId, setAreaId] = useState(project?.area_id || defaultAreaId || '');
  const [description, setDescription] = useState(project?.description || '');
  const [priority, setPriority] = useState<1 | 2 | 3>(project?.priority || 2);
  const [deadline, setDeadline] = useState(project?.deadline || '');
  const [saving, setSaving] = useState(false);

  // Set default area when areas load
  useEffect(() => {
    if (!areaId && areas.length > 0) {
      setAreaId(defaultAreaId || areas[0].id);
    }
  }, [areas, areaId, defaultAreaId]);

  const handleSubmit = async () => {
    if (!title.trim() || !areaId) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        area_id: areaId,
        description: description.trim() || undefined,
        priority,
        deadline: deadline || undefined,
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
        {saving ? 'Saving...' : project ? 'Update' : 'Create'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={project ? '── EDIT PROJECT' : '── NEW PROJECT'}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {/* Title */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="Project title..."
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

        {/* Description */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">
            Description <span className="normal-case">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this project about..."
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors duration-150 resize-none"
          />
        </div>

        {/* Priority (1-3 for projects) */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Priority</label>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((p) => (
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

        {/* Deadline */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">
            Deadline <span className="normal-case">(optional)</span>
          </label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors duration-150"
          />
        </div>
      </div>
    </Modal>
  );
}
