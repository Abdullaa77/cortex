'use client';

import { useState, useEffect, useMemo } from 'react';
import Modal from '@/components/ui/Modal';
import { useAreas } from '@/hooks/useAreas';
import { useProjects } from '@/hooks/useProjects';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/constants';
import type { InboxItem } from '@/lib/types';

interface ProcessModalProps {
  item: InboxItem | null;
  processType: 'task' | 'idea' | 'project';
  isOpen: boolean;
  onClose: () => void;
  onProcess: (type: string, inboxId: string, data: Record<string, unknown>) => Promise<void>;
}

const MODAL_TITLES: Record<string, string> = {
  task: 'Process to Task',
  idea: 'Process to Idea',
  project: 'Process to Project',
};

export default function ProcessModal({ item, processType, isOpen, onClose, onProcess }: ProcessModalProps) {
  const { areas } = useAreas();

  const [title, setTitle] = useState('');
  const [areaId, setAreaId] = useState('');
  const [priority, setPriority] = useState<1 | 2 | 3 | 4>(3);
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const { projects } = useProjects(areaId ? { area_id: areaId, status: 'active' } : undefined);

  // Reset form when item or processType changes
  useEffect(() => {
    if (item) {
      setTitle(item.raw_text);
      setAreaId('');
      setPriority(3);
      setProjectId('');
      setDueDate('');
      setBody('');
    }
  }, [item, processType]);

  // Clear project selection when area changes
  useEffect(() => {
    setProjectId('');
  }, [areaId]);

  const filteredProjects = useMemo(() => {
    if (!areaId) return [];
    return projects.filter((p) => p.area_id === areaId);
  }, [projects, areaId]);

  const handleSave = async () => {
    if (!item || !title.trim()) return;

    setSaving(true);
    try {
      const data: Record<string, unknown> = { title: title.trim() };

      if (processType === 'task') {
        if (!areaId) return;
        data.area_id = areaId;
        data.priority = priority;
        if (projectId) data.project_id = projectId;
        if (dueDate) data.due_date = dueDate;
      } else if (processType === 'idea') {
        if (areaId) data.area_id = areaId;
        if (body.trim()) data.body = body.trim();
      } else if (processType === 'project') {
        if (!areaId) return;
        data.area_id = areaId;
        if (body.trim()) data.description = body.trim();
      }

      await onProcess(processType, item.id, data);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputClasses =
    'w-full bg-surface2 border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:outline-none focus:border-accent/50 transition-colors duration-150';
  const labelClasses = 'block text-text-muted text-xs font-mono mb-1';

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        onClick={onClose}
        className="px-4 py-2 text-sm font-mono text-text-muted hover:text-text-primary border border-border rounded transition-colors duration-150"
      >
        Cancel
      </button>
      <button
        onClick={handleSave}
        disabled={saving || !title.trim() || ((processType === 'task' || processType === 'project') && !areaId)}
        className="px-4 py-2 text-sm font-mono bg-accent/10 text-accent border border-accent/30 rounded
          hover:bg-accent/20 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={MODAL_TITLES[processType] || ''} footer={footer}>
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className={labelClasses}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClasses}
            autoFocus
            placeholder="Title..."
          />
        </div>

        {/* Area selector */}
        <div>
          <label className={labelClasses}>
            Area{processType === 'idea' ? ' (optional)' : ''}
          </label>
          <select
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className={inputClasses}
          >
            <option value="">Select area...</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.icon} {area.name}
              </option>
            ))}
          </select>
        </div>

        {/* Task-specific fields */}
        {processType === 'task' && (
          <>
            {/* Priority */}
            <div>
              <label className={labelClasses}>Priority</label>
              <div className="flex gap-2">
                {([1, 2, 3, 4] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`flex-1 px-2 py-1.5 text-xs font-mono rounded border transition-colors duration-150
                      ${priority === p
                        ? 'border-current bg-current/10'
                        : 'border-border bg-surface2 text-text-muted hover:border-border'
                      }`}
                    style={priority === p ? { color: PRIORITY_COLORS[p], borderColor: `${PRIORITY_COLORS[p]}50` } : undefined}
                  >
                    {PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            {/* Project selector */}
            {areaId && filteredProjects.length > 0 && (
              <div>
                <label className={labelClasses}>Project (optional)</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className={inputClasses}
                >
                  <option value="">No project</option>
                  {filteredProjects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Due date */}
            <div>
              <label className={labelClasses}>Due date (optional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputClasses}
              />
            </div>
          </>
        )}

        {/* Idea body */}
        {processType === 'idea' && (
          <div>
            <label className={labelClasses}>Notes (optional)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={`${inputClasses} font-sans min-h-[120px] resize-y`}
              placeholder="Expand on the idea..."
            />
          </div>
        )}

        {/* Project description */}
        {processType === 'project' && (
          <div>
            <label className={labelClasses}>Description (optional)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={`${inputClasses} font-sans min-h-[120px] resize-y`}
              placeholder="Project description..."
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
