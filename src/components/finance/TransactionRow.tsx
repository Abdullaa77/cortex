'use client';

import { useEffect, useRef, useState } from 'react';
import { formatMinor } from '@/lib/finance/format';
import { explainFlag } from '@/lib/finance/parse';
import { formatOccurred, type TransactionRecord } from '@/lib/finance/transactions';
import type { CategoryOption } from '@/hooks/useTransactions';
import { AlertTriangle, Check, Pencil, Trash2, X } from 'lucide-react';

interface TransactionRowProps {
  row: TransactionRecord;
  categories: CategoryOption[];
  highlighted: boolean;
  onSetCategory: (id: string, categoryId: string) => Promise<void>;
  onUpdate: (id: string, patch: { comment?: string; amount_minor?: number }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAccept: (id: string) => Promise<void>;
}

export default function TransactionRow({
  row,
  categories,
  highlighted,
  onSetCategory,
  onUpdate,
  onDelete,
  onAccept,
}: TransactionRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showFlags, setShowFlags] = useState(false);
  const [draftComment, setDraftComment] = useState(row.comment);
  const [draftAmount, setDraftAmount] = useState(
    (row.amount_minor / 100).toString()
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);

  const occurred = formatOccurred(row);
  const category = row.finance_categories;
  const income = row.direction === 'income';

  const save = async () => {
    const major = Number(draftAmount.replace(/,/g, ''));
    const patch: { comment?: string; amount_minor?: number } = {};
    if (draftComment !== row.comment) patch.comment = draftComment;
    if (Number.isFinite(major) && major > 0 && Math.round(major * 100) !== row.amount_minor)
      patch.amount_minor = Math.round(major * 100);
    if (Object.keys(patch).length > 0) await onUpdate(row.id, patch);
    setEditing(false);
  };

  return (
    <div
      ref={ref}
      className={`border-b border-border/30 px-3 py-2.5 transition-colors last:border-b-0 ${
        highlighted ? 'bg-accent/[0.07] ring-1 ring-accent/30' : ''
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="w-16 shrink-0 font-mono text-[10px] text-text-muted/70"
          title={
            occurred.approximate
              ? 'No day recorded — imported from notes, month only'
              : undefined
          }
        >
          {occurred.text}
          {occurred.approximate && <span className="ml-0.5 opacity-50">~</span>}
        </span>

        {editing ? (
          <input
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            className="w-28 rounded border border-accent/30 bg-surface2 px-1.5 py-0.5 text-right
              font-mono text-xs text-text-primary focus:outline-none"
          />
        ) : (
          <span
            className="w-28 shrink-0 text-right font-mono text-xs tabular-nums"
            style={{ color: income ? '#00FF88' : '#EF4444' }}
          >
            {income ? '+' : '-'}
            {formatMinor(row.amount_minor)}
          </span>
        )}

        {editing ? (
          <input
            value={draftComment}
            onChange={(e) => setDraftComment(e.target.value)}
            className="min-w-0 flex-1 rounded border border-accent/30 bg-surface2 px-1.5 py-0.5
              font-mono text-xs text-text-primary focus:outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
            {row.comment || <span className="text-text-muted/50">no description</span>}
          </span>
        )}

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors"
            style={{
              borderColor: `${category?.color ?? '#6B7280'}55`,
              color: category?.color ?? '#6B7280',
              backgroundColor: `${category?.color ?? '#6B7280'}15`,
            }}
          >
            {category ? `${category.icon} ${category.name}` : '? uncategorised'}
            <span className="ml-1 opacity-60">▾</span>
          </button>

          {pickerOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 max-h-56 w-48 overflow-y-auto rounded-lg
                border border-border bg-surface p-1 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
            >
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={async () => {
                    setPickerOpen(false);
                    await onSetCategory(row.id, c.id);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono
                    text-[11px] text-text-muted transition-colors hover:bg-surface2 hover:text-text-primary"
                >
                  <span style={{ color: c.color }}>{c.icon}</span>
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-16">
        {/* The thing he actually typed. Without it a bad parse cannot be audited. */}
        <code className="min-w-0 truncate font-mono text-[10px] text-text-muted/50">
          {row.raw_input}
        </code>

        {row.needs_review && (
          <button
            type="button"
            onClick={() => setShowFlags((s) => !s)}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]
              transition-colors"
            style={{ color: '#F59E0B', backgroundColor: '#F59E0B15' }}
          >
            <AlertTriangle size={10} />
            needs review
          </button>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {row.needs_review && (
            <button
              type="button"
              onClick={() => onAccept(row.id)}
              title="Looks right — clear the flag"
              className="text-text-muted transition-colors hover:text-accent"
            >
              <Check size={12} />
            </button>
          )}
          {editing ? (
            <>
              <button
                type="button"
                onClick={save}
                className="font-mono text-[10px] text-accent hover:text-accent-dim"
              >
                save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraftComment(row.comment);
                  setDraftAmount((row.amount_minor / 100).toString());
                }}
                className="text-text-muted transition-colors hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-text-muted transition-colors hover:text-text-primary"
            >
              <Pencil size={12} />
            </button>
          )}
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => onDelete(row.id)}
                className="font-mono text-[10px] text-[#EF4444] hover:underline"
              >
                delete?
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-text-muted transition-colors hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-text-muted transition-colors hover:text-[#EF4444]"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {showFlags && row.parse_flags.length > 0 && (
        <ul className="mt-1.5 ml-16 flex flex-col gap-1 border-l border-[#F59E0B]/30 pl-2">
          {row.parse_flags.map((code) => (
            <li key={code} className="font-mono text-[10px] leading-relaxed text-text-muted">
              <span className="text-[#F59E0B]">{code}</span> — {explainFlag(code)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
