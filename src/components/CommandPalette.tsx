'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { fuzzyMatch, fuzzyScore, type SearchResult } from '@/lib/search';
import type { Area } from '@/lib/types';

type Mode = 'search' | 'create_task' | 'create_idea' | 'create_project';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: Mode;
}

// Type icons
const TYPE_ICONS: Record<string, string> = {
  task: '□',
  project: '◈',
  idea: '☆',
  area: '⊞',
  inbox: '☐',
};

// Quick actions shown when query is empty
const QUICK_ACTIONS: SearchResult[] = [
  { id: 'create_task', type: 'task', title: 'New Task', icon: '+', action: () => {} },
  { id: 'create_idea', type: 'idea', title: 'New Idea', icon: '+', action: () => {} },
  { id: 'create_project', type: 'project', title: 'New Project', icon: '+', action: () => {} },
  { id: 'nav_home', type: 'area', title: 'Go to Terminal', icon: '⌂', href: '/' },
  { id: 'nav_inbox', type: 'inbox', title: 'Go to Inbox', icon: '☐', href: '/inbox' },
  { id: 'nav_projects', type: 'project', title: 'Go to Projects', icon: '◈', href: '/projects' },
  { id: 'nav_areas', type: 'area', title: 'Go to Areas', icon: '⊞', href: '/areas' },
  { id: 'nav_ideas', type: 'idea', title: 'Go to Ideas', icon: '☆', href: '/ideas' },
];

const SHORTCUT_HINTS: Record<string, string> = {
  create_task: 'Ctrl+N',
  create_idea: 'Ctrl+I',
};

export default function CommandPalette({ isOpen, onClose, initialMode }: CommandPaletteProps) {
  const router = useRouter();
  const { supabase, session } = useSupabase();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('search');
  const [searchData, setSearchData] = useState<SearchResult[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  // Create mode state
  const [createTitle, setCreateTitle] = useState('');
  const [createAreaId, setCreateAreaId] = useState('');
  const [createPriority, setCreatePriority] = useState(3);
  const [creating, setCreating] = useState(false);

  // Reset state when opened/closed
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setMode(initialMode || 'search');
      setCreateTitle('');
      setCreatePriority(3);
      setCreating(false);
      // Focus input after animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialMode]);

  // Fetch all searchable data + areas when opened
  useEffect(() => {
    if (!isOpen || !session?.user) return;

    Promise.all([
      supabase.from('tasks').select('id, title, area_id, status, priority').in('status', ['todo', 'in_progress']),
      supabase.from('projects').select('id, title, area_id, status').in('status', ['active', 'paused']),
      supabase.from('ideas').select('id, title, area_id, rating'),
      supabase.from('areas').select('*').eq('is_archived', false).order('sort_order'),
      supabase.from('inbox').select('id, raw_text').is('processed_at', null),
    ]).then(([tasksRes, projectsRes, ideasRes, areasRes, inboxRes]) => {
      const areaList = areasRes.data || [];
      setAreas(areaList);
      if (!createAreaId && areaList.length > 0) {
        setCreateAreaId(areaList[0].id);
      }

      const areaMap = new Map(areaList.map((a) => [a.id, a]));
      const results: SearchResult[] = [];

      for (const t of tasksRes.data || []) {
        const area = areaMap.get(t.area_id);
        results.push({
          id: t.id,
          type: 'task',
          title: t.title,
          subtitle: area?.name,
          icon: TYPE_ICONS.task,
          color: area?.color,
          href: `/areas/${t.area_id}`,
        });
      }

      for (const p of projectsRes.data || []) {
        const area = areaMap.get(p.area_id);
        results.push({
          id: p.id,
          type: 'project',
          title: p.title,
          subtitle: area?.name,
          icon: TYPE_ICONS.project,
          color: area?.color,
          href: `/projects/${p.id}`,
        });
      }

      for (const i of ideasRes.data || []) {
        const area = i.area_id ? areaMap.get(i.area_id) : null;
        results.push({
          id: i.id,
          type: 'idea',
          title: i.title,
          subtitle: area?.name,
          icon: TYPE_ICONS.idea,
          color: area?.color,
          href: '/ideas',
        });
      }

      for (const a of areaList) {
        results.push({
          id: a.id,
          type: 'area',
          title: a.name,
          icon: a.icon,
          color: a.color,
          href: `/areas/${a.id}`,
        });
      }

      for (const item of inboxRes.data || []) {
        results.push({
          id: item.id,
          type: 'inbox',
          title: item.raw_text,
          icon: TYPE_ICONS.inbox,
          href: '/inbox',
        });
      }

      setSearchData(results);
    });
  }, [isOpen, session?.user, supabase, createAreaId]);

  // Filter and score results
  const filteredResults = useMemo(() => {
    if (!query.trim()) return [];
    return searchData
      .filter((r) => fuzzyMatch(query, r.title) || (r.subtitle && fuzzyMatch(query, r.subtitle)))
      .sort((a, b) => fuzzyScore(query, b.title) - fuzzyScore(query, a.title))
      .slice(0, 20);
  }, [query, searchData]);

  // Items to display
  const displayItems = query.trim() ? filteredResults : QUICK_ACTIONS;

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Execute selected item
  const executeItem = useCallback(
    (item: SearchResult) => {
      // Handle create actions
      if (item.id === 'create_task') {
        setMode('create_task');
        setCreateTitle('');
        setCreatePriority(3);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      if (item.id === 'create_idea') {
        setMode('create_idea');
        setCreateTitle('');
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      if (item.id === 'create_project') {
        setMode('create_project');
        setCreateTitle('');
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }

      // Navigate
      if (item.href) {
        router.push(item.href);
        onClose();
        return;
      }

      // Custom action
      if (item.action) {
        item.action();
        onClose();
      }
    },
    [router, onClose]
  );

  // Create entity
  const handleCreate = useCallback(async () => {
    if (!createTitle.trim() || !session?.user || creating) return;
    setCreating(true);

    try {
      if (mode === 'create_task') {
        const { error } = await supabase.from('tasks').insert({
          title: createTitle.trim(),
          area_id: createAreaId,
          priority: createPriority,
          user_id: session.user.id,
        });
        if (error) throw error;
      } else if (mode === 'create_idea') {
        const { error } = await supabase.from('ideas').insert({
          title: createTitle.trim(),
          area_id: createAreaId || null,
          user_id: session.user.id,
        });
        if (error) throw error;
      } else if (mode === 'create_project') {
        const { error } = await supabase.from('projects').insert({
          title: createTitle.trim(),
          area_id: createAreaId,
          user_id: session.user.id,
        });
        if (error) throw error;
      }
      onClose();
    } catch (err) {
      console.error('Failed to create:', err);
    } finally {
      setCreating(false);
    }
  }, [createTitle, createAreaId, createPriority, mode, session?.user, supabase, onClose, creating]);

  // Keyboard handler for the palette
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode !== 'search') {
        if (e.key === 'Escape') {
          e.preventDefault();
          setMode('search');
          setQuery('');
          return;
        }
        if (e.key === 'Backspace' && !createTitle) {
          e.preventDefault();
          setMode('search');
          setQuery('');
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCreate();
          return;
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          e.preventDefault();
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          setSelectedIndex((prev) => {
            const next = prev + dir;
            if (next < 0) return displayItems.length - 1;
            if (next >= displayItems.length) return 0;
            return next;
          });
          break;
        }
        case 'Enter':
          e.preventDefault();
          if (displayItems[selectedIndex]) {
            executeItem(displayItems[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (query) {
            setQuery('');
          } else {
            onClose();
          }
          break;
      }
    },
    [mode, query, displayItems, selectedIndex, executeItem, onClose, createTitle, handleCreate]
  );

  // Scroll selected item into view
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!resultsRef.current) return;
    const selected = resultsRef.current.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const modeLabels: Record<Mode, string> = {
    search: '>',
    create_task: '+ task:',
    create_idea: '+ idea:',
    create_project: '+ project:',
  };

  const modePlaceholders: Record<Mode, string> = {
    search: 'Search or jump to...',
    create_task: 'Task title...',
    create_idea: 'Idea title...',
    create_project: 'Project title...',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] animate-[overlay-in_150ms_ease-out]"
      style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 rounded-lg shadow-xl animate-[modal-in_150ms_ease-out] overflow-hidden"
        style={{
          background: 'rgba(17, 17, 24, 0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(0, 255, 136, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-accent font-mono text-sm font-bold shrink-0">
            {modeLabels[mode]}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={mode === 'search' ? query : createTitle}
            onChange={(e) => {
              if (mode === 'search') setQuery(e.target.value);
              else setCreateTitle(e.target.value);
            }}
            placeholder={modePlaceholders[mode]}
            className="flex-1 bg-transparent text-text-primary font-mono text-base outline-none placeholder:text-text-muted/50 caret-accent"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline text-[10px] text-text-muted border border-border rounded px-1.5 py-0.5 font-mono">
            ESC
          </kbd>
        </div>

        {/* Create mode: area + priority selectors */}
        {mode !== 'search' && (
          <div className="px-4 py-3 border-b border-border space-y-3">
            {/* Area pills */}
            <div className="flex flex-wrap gap-1.5">
              {areas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => setCreateAreaId(area.id)}
                  className={`text-[11px] font-mono px-2 py-1 rounded transition-colors ${
                    createAreaId === area.id
                      ? 'bg-surface2 border border-accent/40'
                      : 'border border-border hover:border-accent/20'
                  }`}
                  style={{ color: createAreaId === area.id ? area.color : undefined }}
                >
                  {area.icon} {area.name}
                </button>
              ))}
            </div>

            {/* Priority selector for tasks */}
            {mode === 'create_task' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted tracking-wide">PRIORITY</span>
                {[1, 2, 3, 4].map((p) => {
                  const labels = ['', 'P1', 'P2', 'P3', 'P4'];
                  const colors = ['', '#EF4444', '#F59E0B', '#00FF88', '#6B7280'];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCreatePriority(p)}
                      className={`text-[11px] font-mono px-2 py-0.5 rounded transition-colors ${
                        createPriority === p
                          ? 'bg-surface2 border border-current'
                          : 'border border-border hover:border-current'
                      }`}
                      style={{ color: colors[p] }}
                    >
                      {labels[p]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Results list */}
        {mode === 'search' && (
          <div ref={resultsRef} className="max-h-80 overflow-y-auto py-2">
            {/* Section header */}
            {!query.trim() && (
              <div className="px-4 py-1.5">
                <span className="text-[10px] tracking-[2px] text-text-muted font-mono">
                  QUICK ACTIONS
                </span>
              </div>
            )}
            {query.trim() && filteredResults.length > 0 && (
              <div className="px-4 py-1.5">
                <span className="text-[10px] tracking-[2px] text-text-muted font-mono">
                  SEARCH RESULTS
                </span>
              </div>
            )}
            {query.trim() && filteredResults.length === 0 && (
              <div className="px-4 py-6 text-center text-text-muted text-sm font-mono">
                No results for &ldquo;{query}&rdquo;
              </div>
            )}

            {displayItems.map((item, i) => (
              <button
                key={item.id}
                type="button"
                data-selected={i === selectedIndex}
                onClick={() => executeItem(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left font-mono text-sm transition-colors ${
                  i === selectedIndex
                    ? 'bg-surface2/80 border-l-2 border-accent'
                    : 'border-l-2 border-transparent hover:bg-surface2/40'
                }`}
              >
                <span
                  className="text-xs w-4 text-center shrink-0"
                  style={{ color: item.color || 'var(--color-text-muted)' }}
                >
                  {item.icon}
                </span>
                <span className="flex-1 text-text-primary truncate">{item.title}</span>
                {item.subtitle && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border shrink-0"
                    style={{ color: item.color }}
                  >
                    {item.subtitle}
                  </span>
                )}
                {SHORTCUT_HINTS[item.id] && (
                  <span className="text-[10px] text-text-muted shrink-0">
                    {SHORTCUT_HINTS[item.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Create mode footer hint */}
        {mode !== 'search' && (
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-text-muted font-mono">
              Enter to create · Esc to cancel
            </span>
            {creating && (
              <span className="text-[10px] text-accent font-mono animate-pulse">
                Creating...
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
