'use client';

import Link from 'next/link';
import Modal from '@/components/ui/Modal';
import TransactionRow from '@/components/finance/TransactionRow';
import { formatMinor } from '@/lib/finance/format';
import { drilldownRows, sumMinor } from '@/lib/finance/transactions';
import type { TransactionRecord } from '@/lib/finance/transactions';
import type { CategoryOption } from '@/hooks/useTransactions';
import type { RowPatch } from '@/lib/finance/edit';
import { ArrowRight } from 'lucide-react';

export interface DrilldownTarget {
  monthKey: string;
  monthLabel: string;
  slug: string;
  name: string;
  color: string;
  /** The figure that was clicked. The listed rows must add up to this. */
  minor: number;
}

interface CategoryDrilldownProps {
  target: DrilldownTarget | null;
  rows: TransactionRecord[];
  categories: CategoryOption[];
  onClose: () => void;
  onSetCategory: (id: string, categoryId: string) => Promise<void>;
  onUpdate: (id: string, patch: RowPatch) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAccept: (id: string) => Promise<void>;
}

/**
 * The transactions behind one figure.
 *
 * The rows are selected by the same function the figure was aggregated with,
 * so the total printed here is the clicked number recomputed, not a second
 * opinion about it. A test pins that across every category and month of the
 * real corpus.
 *
 * Rows are the same `TransactionRow` the list uses, editing and all. A second
 * row implementation would be a second place for a correction to behave
 * differently, which is the thing the shared assignment hook exists to prevent.
 */
export default function CategoryDrilldown({
  target,
  rows,
  categories,
  onClose,
  onSetCategory,
  onUpdate,
  onDelete,
  onAccept,
}: CategoryDrilldownProps) {
  if (!target) return null;

  const behind = drilldownRows(rows, target.monthKey, target.slug);
  const total = sumMinor(behind);
  // Only ever true if the two paths have drifted. Says so rather than quietly
  // showing a list that does not match the figure that opened it.
  const drifted = total !== target.minor;

  return (
    <Modal isOpen onClose={onClose} title={`${target.name} · ${target.monthLabel}`}>
      <div className="-mx-2">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2">
          <span
            className="font-mono text-lg tabular-nums"
            style={{ color: target.color }}
          >
            {formatMinor(total)}
          </span>
          <span className="font-mono text-[11px] text-text-muted">
            {behind.length} {behind.length === 1 ? 'entry' : 'entries'}
          </span>
          <Link
            href={`/finance/transactions?month=${target.monthKey}&category=${target.slug}`}
            onClick={onClose}
            className="ml-auto flex items-center gap-1 font-mono text-[11px] text-accent
              transition-colors hover:text-accent-dim"
          >
            open in list <ArrowRight size={11} />
          </Link>
        </div>

        {drifted && (
          <p className="mb-2 px-2 font-mono text-[11px] text-[#EF4444]">
            These rows total {formatMinor(total)}, but the figure clicked was{' '}
            {formatMinor(target.minor)}. Do not trust either until that is fixed.
          </p>
        )}

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border/50">
          {behind.map((row) => (
            <TransactionRow
              key={row.id}
              row={row}
              categories={categories}
              highlighted={false}
              onSetCategory={onSetCategory}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAccept={onAccept}
            />
          ))}
        </div>

        <p className="mt-2.5 px-2 font-mono text-[10px] leading-relaxed text-text-muted/60">
          Recategorising a row here moves it out of this figure.
        </p>
      </div>
    </Modal>
  );
}
