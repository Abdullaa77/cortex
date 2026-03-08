'use client';

import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { useAreas } from '@/hooks/useAreas';
import type { Idea } from '@/lib/types';

interface IdeaFormProps {
  idea?: Idea;
  onClose: () => void;
  onSave: (data: { title: string; body?: string; area_id?: string | null; rating?: 0 | 1 | 2 | 3 }) => Promise<void>;
}

function StarRatingInput({
  rating,
  onChange,
}: {
  rating: 0 | 1 | 2 | 3;
  onChange: (rating: 0 | 1 | 2 | 3) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {([1, 2, 3] as const).map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star === rating ? 0 : star)}
          className="text-lg transition-colors duration-150 hover:scale-110 p-0.5"
          title={`Rate ${star === rating ? 0 : star}`}
        >
          {star <= rating ? (
            <span className="text-yellow-400">{'\u2605'}</span>
          ) : (
            <span className="text-text-muted">{'\u2606'}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export default function IdeaForm({ idea, onClose, onSave }: IdeaFormProps) {
  const { areas } = useAreas();
  const isEditing = !!idea;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [areaId, setAreaId] = useState('');
  const [rating, setRating] = useState<0 | 1 | 2 | 3>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (idea) {
      setTitle(idea.title);
      setBody(idea.body || '');
      setAreaId(idea.area_id || '');
      setRating(idea.rating);
    } else {
      setTitle('');
      setBody('');
      setAreaId('');
      setRating(0);
    }
  }, [idea]);

  const handleSave = async () => {
    if (!title.trim()) return;

    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        body: body.trim(),
        area_id: areaId || null,
        rating,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputClasses =
    'w-full bg-surface2 border border-border rounded px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent/50 transition-colors duration-150';
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
        disabled={saving || !title.trim()}
        className="px-4 py-2 text-sm font-mono bg-accent/10 text-accent border border-accent/30 rounded
          hover:bg-accent/20 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEditing ? 'Edit Idea' : 'New Idea'}
      footer={footer}
    >
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className={labelClasses}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputClasses} font-mono`}
            autoFocus
            placeholder="Idea title..."
          />
        </div>

        {/* Body */}
        <div>
          <label className={labelClasses}>Body (optional)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`${inputClasses} font-sans min-h-[120px] resize-y`}
            placeholder="Flesh out the idea..."
          />
        </div>

        {/* Area */}
        <div>
          <label className={labelClasses}>Area (optional)</label>
          <select
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className={`${inputClasses} font-mono`}
          >
            <option value="">No area</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.icon} {area.name}
              </option>
            ))}
          </select>
        </div>

        {/* Rating */}
        <div>
          <label className={labelClasses}>Rating</label>
          <StarRatingInput rating={rating} onChange={setRating} />
        </div>
      </div>
    </Modal>
  );
}
