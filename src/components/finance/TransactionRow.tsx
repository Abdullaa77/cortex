'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatMinor } from '@/lib/finance/format';
import { explainFlag } from '@/lib/finance/parse';
import {
  formatOccurred,
  repaymentsFor,
  repaidTarget,
  type TransactionRecord,
} from '@/lib/finance/transactions';
import { linkCandidates, reimbursementsByTarget, effectiveMinor } from '@/lib/finance/links';
import { planPairDeletion } from '@/lib/finance/transfers';
import { buildRowPatch, toDraft, type RowDraft, type RowPatch } from '@/lib/finance/edit';
import type { CategoryOption } from '@/hooks/useTransactions';
import { AlertTriangle, Check, Link2, Link2Off, Pencil, Trash2, X } from 'lucide-react';

interface TransactionRowProps {
  row: TransactionRecord;
  categories: CategoryOption[];
  highlighted: boolean;
  onSetCategory: (id: string, categoryId: string) => Promise<void>;
  onUpdate: (id: string, patch: RowPatch) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAccept: (id: string) => Promise<void>;
  /**
   * Every row, for resolving links. Omit to render without link controls —
   * the capture strip has no list to point at.
   */
  allRows?: TransactionRecord[];
  onLink?: (sourceId: string, targetId: string) => Promise<string | null>;
  onUnlink?: (sourceId: string) => Promise<void>;
}

/**
 * A transaction, readable at a glance and fully editable underneath.
 *
 * Every field is reachable here — amount, direction, comment, category, date
 * and time — because a row you can only half-correct is a row you end up
 * deleting and retyping. The editor is behind a pencil rather than always
 * open: the list is read far more often than it is edited.
 *
 * What the patch contains is decided by `buildRowPatch`, not here. That is
 * where the rule lives that editing an imported row's date flips its
 * date_precision to 'day', and it is tested, which this component is not.
 */
export default function TransactionRow({
  row,
  categories,
  highlighted,
  onSetCategory,
  onUpdate,
  onDelete,
  onAccept,
  allRows,
  onLink,
  onUnlink,
}: TransactionRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /**
   * What this delete costs, worked out before it is offered rather than
   * reported after. Deleting one leg of a cross-currency pair does not corrupt
   * anything — the survivor goes back to the queue — but the rate the two
   * observed only ever existed in their pairing, so it goes with them. That is
   * worth one sentence in front of the click.
   */
  const pairDeletion = planPairDeletion(
    { ...row, transfer_pair_id: row.transfer_pair_id ?? null },
    allRows ?? [row]
  );
  const [showFlags, setShowFlags] = useState(false);
  const [draft, setDraft] = useState<RowDraft>(() => toDraft(row));
  const [errors, setErrors] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);

  /**
   * The category list is positioned fixed, against the viewport.
   *
   * Absolute positioning is clipped by any scrolling ancestor, and this row now
   * renders inside one — the drill-down modal scrolls its list. A picker that
   * gets cut in half on the last visible row makes the modal's main action
   * unusable, so the list escapes the clipping context entirely and is placed
   * from the chip's own rect. It flips above the chip when there is no room
   * below.
   *
   * Placed in a layout effect, before paint, so a stale position from the last
   * time the picker was open is never the one that gets drawn.
   */
  useLayoutEffect(() => {
    if (!pickerOpen) return;

    const place = () => {
      const chip = chipRef.current;
      if (!chip) return;
      const rect = chip.getBoundingClientRect();
      const height = Math.min(224, categories.length * 30 + 8);
      const below = window.innerHeight - rect.bottom;

      setPickerPos({
        top: below < height + 8 ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200)),
      });
    };

    place();
    window.addEventListener('resize', place);
    // Capture phase, so a scroll in any ancestor keeps the list on its chip.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [pickerOpen, categories.length]);

  const occurred = formatOccurred(row);
  const category = row.finance_categories;
  const income = row.direction === 'income';

  // Link state. Everything here is derived from the full row set, so a filter
  // that hides one half of a pair cannot make the other half read as unlinked.
  const linkable = allRows ?? [];
  const reimbursed = reimbursementsByTarget(linkable);
  const repayments = allRows ? repaymentsFor(row, linkable) : [];
  const repaid = allRows ? repaidTarget(row, linkable) : null;
  const backMinor = repayments.reduce((n, r) => n + r.amount_minor, 0);
  const netMinor = effectiveMinor(row, reimbursed);
  const candidates = allRows && onLink ? linkCandidates(row, linkable) : [];
  const canOfferLink = Boolean(onLink) && !repaid && income && candidates.length > 0;

  const openEditor = () => {
    setDraft(toDraft(row));
    setErrors([]);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(toDraft(row));
    setErrors([]);
    setEditing(false);
  };

  const save = async () => {
    const { patch, errors: problems } = buildRowPatch(row, draft);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    if (Object.keys(patch).length > 0) await onUpdate(row.id, patch);
    setEditing(false);
    setErrors([]);
  };

  const set = (patch: Partial<RowDraft>) => setDraft((d) => ({ ...d, ...patch }));

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
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            inputMode="decimal"
            aria-label="Amount"
            className="w-28 rounded border border-accent/30 bg-surface2 px-1.5 py-0.5 text-right
              font-mono text-xs tabular-nums text-text-primary focus:outline-none"
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
            value={draft.comment}
            onChange={(e) => set({ comment: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label="Description"
            className="min-w-0 flex-1 rounded border border-accent/30 bg-surface2 px-1.5 py-0.5
              font-mono text-xs text-text-primary focus:outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
            {row.comment || <span className="text-text-muted/50">no description</span>}
          </span>
        )}

        <div className="shrink-0">
          <button
            ref={chipRef}
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

          {pickerOpen && pickerPos && (
            <>
              {/* Click-away. The list is fixed, so it has no parent to catch this. */}
              <div
                className="fixed inset-0 z-[70]"
                onClick={() => setPickerOpen(false)}
                aria-hidden
              />
              <div
                className="fixed z-[71] max-h-56 w-48 overflow-y-auto rounded-lg border border-border
                  bg-surface p-1 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
                style={{ top: pickerPos.top, left: pickerPos.left }}
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
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-16">
          <div className="flex overflow-hidden rounded border border-border">
            {(['expense', 'income'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => set({ direction: d })}
                className="px-2 py-0.5 font-mono text-[10px] transition-colors"
                style={{
                  backgroundColor:
                    draft.direction === d
                      ? d === 'income'
                        ? '#00FF8815'
                        : '#EF444415'
                      : 'transparent',
                  color:
                    draft.direction === d
                      ? d === 'income'
                        ? '#00FF88'
                        : '#EF4444'
                      : '#6B7280',
                }}
              >
                {d}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
            aria-label="Date"
            className="rounded border border-border bg-surface2 px-1.5 py-0.5 font-mono text-[11px]
              text-text-primary focus:border-accent/40 focus:outline-none"
          />
          <input
            type="time"
            value={draft.time}
            onChange={(e) => set({ time: e.target.value })}
            aria-label="Time"
            className="rounded border border-border bg-surface2 px-1.5 py-0.5 font-mono text-[11px]
              text-text-primary focus:border-accent/40 focus:outline-none"
          />

          {row.date_precision === 'month' && (
            <span className="font-mono text-[10px] text-text-muted/60">
              picking a day makes this row exact
            </span>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <p className="mt-1.5 pl-16 font-mono text-[10px] text-[#EF4444]">
          {errors.join(' ')}
        </p>
      )}

      {/* What the link means, on whichever side of it this row sits. Both rows
          say so — a netted figure that is only explained on one of them is a
          figure the other row appears to contradict. */}
      {backMinor > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-16 font-mono text-[10px]">
          <Link2 size={10} className="shrink-0 text-accent/70" />
          <span className="text-text-muted">
            {formatMinor(backMinor)} came back ·{' '}
            <span className="text-accent">net {formatMinor(netMinor)}</span>
          </span>
          <span className="text-text-muted/50">
            {repayments.length === 1
              ? repayments[0].comment || 'repayment'
              : `${repayments.length} repayments`}
          </span>
        </div>
      )}

      {repaid && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-16 font-mono text-[10px]">
          <Link2 size={10} className="shrink-0 text-accent/70" />
          <span className="text-text-muted">
            repays{' '}
            <span className="text-text-primary">
              {repaid.comment || 'an expense'}
            </span>{' '}
            · {formatMinor(repaid.amount_minor)}
          </span>
          {onUnlink && (
            <button
              type="button"
              onClick={() => onUnlink(row.id)}
              title="Detach — both amounts are restored untouched"
              className="flex items-center gap-1 text-text-muted transition-colors hover:text-[#F59E0B]"
            >
              <Link2Off size={10} /> unlink
            </button>
          )}
        </div>
      )}

      {linkOpen && candidates.length > 0 && (
        <div className="mt-1.5 ml-16 rounded border border-accent/20 bg-surface2/40 p-1.5">
          <p className="mb-1 font-mono text-[10px] text-text-muted">
            Which expense does this repay?
          </p>
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={async () => {
                  const err = onLink ? await onLink(row.id, c.id) : null;
                  setLinkError(err);
                  if (!err) setLinkOpen(false);
                }}
                className="flex items-baseline gap-2 rounded px-1.5 py-1 text-left font-mono
                  text-[10px] transition-colors hover:bg-surface2"
              >
                <span className="w-20 shrink-0 tabular-nums text-[#EF4444]">
                  -{formatMinor(c.amount_minor)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  {c.comment || 'no description'}
                </span>
                <span className="shrink-0 text-text-muted/60">
                  {formatOccurred(c).text}
                </span>
              </button>
            ))}
          </div>
          {linkError && (
            <p className="mt-1 font-mono text-[10px] text-[#EF4444]">{linkError}</p>
          )}
        </div>
      )}

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
          {canOfferLink && (
            <button
              type="button"
              onClick={() => {
                setLinkError(null);
                setLinkOpen((o) => !o);
              }}
              title="Link this to the expense it repays"
              className={`transition-colors ${
                linkOpen ? 'text-accent' : 'text-text-muted hover:text-accent'
              }`}
            >
              <Link2 size={12} />
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
                onClick={cancel}
                aria-label="Cancel edit"
                className="text-text-muted transition-colors hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={openEditor}
              aria-label="Edit transaction"
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
                aria-label="Cancel delete"
                className="text-text-muted transition-colors hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete transaction"
              className="text-text-muted transition-colors hover:text-[#EF4444]"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {confirmDelete && pairDeletion.warning && (
        <p className="mt-1.5 ml-16 border-l border-[#EF4444]/30 pl-2 font-mono text-[10px]
          leading-relaxed text-text-muted">
          <span className="text-[#EF4444]">deleting this</span> — {pairDeletion.warning}
        </p>
      )}

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
