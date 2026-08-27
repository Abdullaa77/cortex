'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useCategoryAdmin } from '@/hooks/useCategoryAdmin';
import {
  validateDraft,
  planRetire,
  reclassifyCount,
  MAX_NAME_LENGTH,
  type CategoryRecord,
  type CategoryDraft,
  type CategoryKind,
} from '@/lib/finance/categories';
import { Archive, Check, Plus, RotateCcw, Trash2, X } from 'lucide-react';

interface CategoryManagerProps {
  open: boolean;
  onClose: () => void;
  categories: CategoryRecord[];
  rows: { category_id: string | null }[];
  onChanged: () => Promise<unknown> | unknown;
}

const KINDS: { value: CategoryKind; label: string; hint: string }[] = [
  { value: 'expense', label: 'expense', hint: 'counts as spending' },
  { value: 'income', label: 'income', hint: 'counts as money earned' },
  { value: 'transfer', label: 'transfer', hint: 'money moved, never spending' },
];

const PALETTE = [
  '#00FF88', '#06B6D4', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#3B82F6', '#22C55E', '#D4AF37', '#6B7280',
];

const BLANK: CategoryDraft = { name: '', icon: '◉', color: '#00FF88', kind: 'expense' };

/**
 * Add, rename, retire.
 *
 * A category's slug is fixed at creation and never appears here — renaming
 * "Eating out" to "Restaurants" changes what he reads, not what the code joins
 * on. `buildUpdate` enforces that; this screen just never offers the field.
 *
 * Retiring asks the data what it is allowed to do. A category nothing points
 * at is deleted; one with history is archived, because deleting it would drop
 * its rows into uncategorised and quietly lose a bar from every breakdown.
 */
export default function CategoryManager({
  open,
  onClose,
  categories,
  rows,
  onChanged,
}: CategoryManagerProps) {
  const admin = useCategoryAdmin(categories, rows, onChanged);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const live = categories.filter((c) => !c.is_archived);
  const archived = categories.filter((c) => c.is_archived);

  return (
    <Modal isOpen onClose={onClose} title="Categories">
      <div className="-mx-2">
        {error && (
          <p className="mb-2 px-2 font-mono text-[11px] text-[#EF4444]">{error}</p>
        )}

        <div className="max-h-[55vh] overflow-y-auto">
          {live.map((category) =>
            editingId === category.id ? (
              <Editor
                key={category.id}
                category={category}
                categories={categories}
                usageCount={admin.usageFor(category.id)}
                onCancel={() => setEditingId(null)}
                onSave={async (draft) => {
                  const err = await admin.update(category, draft);
                  setError(err);
                  if (!err) setEditingId(null);
                }}
              />
            ) : (
              <Row
                key={category.id}
                category={category}
                usageCount={admin.usageFor(category.id)}
                onEdit={() => {
                  setError(null);
                  setEditingId(category.id);
                }}
                onRetire={async () => setError(await admin.retire(category))}
              />
            )
          )}

          {adding ? (
            <Editor
              category={null}
              categories={categories}
              usageCount={0}
              onCancel={() => setAdding(false)}
              onSave={async (draft) => {
                const err = await admin.create(draft);
                setError(err);
                if (!err) setAdding(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
              className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-2 text-left
                font-mono text-[11px] text-accent transition-colors hover:bg-surface2/60"
            >
              <Plus size={12} /> new category
            </button>
          )}

          {archived.length > 0 && (
            <>
              <p className="mt-3 px-2 font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
                Archived
              </p>
              {archived.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center gap-2 border-b border-border/20 px-2 py-2 last:border-b-0"
                >
                  <span className="w-4 text-center font-mono text-xs opacity-40" style={{ color: category.color }}>
                    {category.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">
                    {category.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-text-muted/60">
                    {admin.usageFor(category.id)} rows keep it
                  </span>
                  <button
                    type="button"
                    onClick={async () => setError(await admin.restore(category))}
                    title="Bring it back into the picker"
                    className="shrink-0 text-text-muted transition-colors hover:text-accent"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        <p className="mt-2.5 px-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
          Renaming is safe — existing transactions and rules follow the category, not its
          name. A category with history is archived rather than deleted.
        </p>
      </div>
    </Modal>
  );
}

function Row({
  category,
  usageCount,
  onEdit,
  onRetire,
}: {
  category: CategoryRecord;
  usageCount: number;
  onEdit: () => void;
  onRetire: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const plan = planRetire(category, usageCount);

  return (
    <div className="border-b border-border/20 px-2 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="w-4 shrink-0 text-center font-mono text-xs" style={{ color: category.color }}>
          {category.icon}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-text-primary
            transition-colors hover:text-accent"
        >
          {category.name}
        </button>
        <span className="shrink-0 font-mono text-[10px] text-text-muted/60">
          {category.kind !== 'expense' && `${category.kind} · `}
          {usageCount}
        </span>
        <button
          type="button"
          onClick={() => setConfirming((c) => !c)}
          aria-label={plan.action === 'delete' ? 'Delete category' : 'Archive category'}
          className="shrink-0 text-text-muted transition-colors hover:text-[#F59E0B]"
        >
          {plan.action === 'delete' ? <Trash2 size={12} /> : <Archive size={12} />}
        </button>
      </div>

      {confirming && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
          <span className="font-mono text-[10px] text-text-muted">{plan.explanation}</span>
          <button
            type="button"
            onClick={async () => {
              setConfirming(false);
              await onRetire();
            }}
            className="font-mono text-[10px] text-[#F59E0B] hover:underline"
          >
            {plan.action === 'delete' ? 'delete' : 'archive'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            aria-label="Cancel"
            className="text-text-muted transition-colors hover:text-text-primary"
          >
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

function Editor({
  category,
  categories,
  usageCount,
  onCancel,
  onSave,
}: {
  category: CategoryRecord | null;
  categories: CategoryRecord[];
  usageCount: number;
  onCancel: () => void;
  onSave: (draft: CategoryDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CategoryDraft>(
    category
      ? { name: category.name, icon: category.icon, color: category.color, kind: category.kind }
      : BLANK
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const set = (patch: Partial<CategoryDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const restated = category ? reclassifyCount(category, draft, usageCount) : 0;

  const submit = async () => {
    const check = validateDraft(draft, categories, category?.id ?? null);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border/20 bg-surface2/30 px-2 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={draft.icon}
          onChange={(e) => set({ icon: e.target.value.slice(0, 2) })}
          aria-label="Icon"
          className="w-9 rounded border border-border bg-surface px-1 py-1 text-center font-mono
            text-xs text-text-primary focus:border-accent/40 focus:outline-none"
          style={{ color: draft.color }}
        />
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          maxLength={MAX_NAME_LENGTH}
          placeholder="name"
          aria-label="Category name"
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono
            text-xs text-text-primary focus:border-accent/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          aria-label="Save category"
          className="rounded border border-accent/40 bg-accent/10 px-2 py-1 text-accent
            transition-colors hover:bg-accent/20 disabled:opacity-40"
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="px-1 text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => set({ color })}
            aria-label={`Colour ${color}`}
            className="h-4 w-4 rounded-full border transition-transform hover:scale-110"
            style={{
              backgroundColor: color,
              borderColor: draft.color === color ? '#FFFFFF' : 'transparent',
            }}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => set({ kind: k.value })}
            title={k.hint}
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors"
            style={{
              borderColor: draft.kind === k.value ? '#00FF8866' : 'rgba(42,42,58,0.9)',
              color: draft.kind === k.value ? '#00FF88' : '#6B7280',
              backgroundColor: draft.kind === k.value ? '#00FF8815' : 'transparent',
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      {restated > 0 && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[#F59E0B]">
          Changing the kind restates {restated}{' '}
          {restated === 1 ? 'transaction' : 'transactions'} across every month.
        </p>
      )}

      {errors.length > 0 && (
        <p className="mt-1.5 font-mono text-[10px] text-[#EF4444]">{errors.join(' ')}</p>
      )}
    </div>
  );
}
