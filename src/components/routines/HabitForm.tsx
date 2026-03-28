'use client';

import { useState } from 'react';
import type { Habit } from '@/lib/types';
import Modal from '@/components/ui/Modal';

const PRESET_COLORS = ['#00FF88', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#D4AF37', '#EC4899', '#10B981'];

interface HabitFormProps {
  habit?: Habit;
  onClose: () => void;
  onSave: (data: {
    name: string;
    icon?: string;
    color?: string;
    track_type?: 'checkbox' | 'number';
    target_value?: number;
    unit?: string;
  }) => Promise<void>;
}

export default function HabitForm({ habit, onClose, onSave }: HabitFormProps) {
  const [name, setName] = useState(habit?.name || '');
  const [icon, setIcon] = useState(habit?.icon || '\u25CB');
  const [color, setColor] = useState(habit?.color || '#00FF88');
  const [trackType, setTrackType] = useState<'checkbox' | 'number'>(habit?.track_type || 'checkbox');
  const [targetValue, setTargetValue] = useState(habit?.target_value?.toString() || '');
  const [unit, setUnit] = useState(habit?.unit || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        icon,
        color,
        track_type: trackType,
        target_value: trackType === 'number' && targetValue ? Number(targetValue) : undefined,
        unit: trackType === 'number' && unit ? unit.trim() : undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        onClick={onClose}
        className="px-4 py-2 font-mono text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={!name.trim() || saving}
        className="px-4 py-2 font-mono text-sm rounded bg-accent text-bg font-semibold hover:bg-accent-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : habit ? 'Update' : 'Create'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={habit ? '\u2500\u2500 EDIT HABIT' : '\u2500\u2500 NEW HABIT'}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Habit name..."
            className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Icon */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Icon</label>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-16 px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary text-center focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Color */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Color</label>
          <div className="flex gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? '#fff' : 'transparent',
                  boxShadow: color === c ? `0 0 8px ${c}` : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {/* Track Type */}
        <div>
          <label className="block font-mono text-xs text-text-muted uppercase mb-1">Track Type</label>
          <div className="flex gap-2">
            {(['checkbox', 'number'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrackType(t)}
                className={`px-3 py-1.5 font-mono text-xs rounded border transition-all ${
                  trackType === t
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-muted hover:border-accent/30'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Number fields */}
        {trackType === 'number' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block font-mono text-xs text-text-muted uppercase mb-1">Target</label>
              <input
                type="number"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="8"
                min="1"
                className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="block font-mono text-xs text-text-muted uppercase mb-1">Unit</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="cups"
                className="w-full px-3 py-2 font-mono text-sm bg-surface2 border border-border rounded text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
