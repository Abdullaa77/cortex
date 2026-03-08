export const DEFAULT_AREAS = [
  { name: 'Imperial', icon: '>_', color: '#3B82F6' },
  { name: 'DST', icon: '⚡', color: '#F59E0B' },
  { name: 'AI Biz', icon: '◇', color: '#8B5CF6' },
  { name: 'Freelance', icon: '↗', color: '#10B981' },
  { name: 'Dev', icon: '{}', color: '#00FF88' },
  { name: 'Health', icon: '♥', color: '#EF4444' },
  { name: 'Learning', icon: '◈', color: '#06B6D4' },
  { name: 'Faith', icon: '☾', color: '#D4AF37' },
  { name: 'Personal', icon: '◉', color: '#EC4899' },
  { name: 'Finance', icon: '$', color: '#22C55E' },
] as const;

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const PRIORITY_COLORS: Record<number, string> = {
  1: '#EF4444',
  2: '#F59E0B',
  3: '#00FF88',
  4: '#6B7280',
};

export const STATUS_COLORS = {
  todo: '#6B7280',
  in_progress: '#3B82F6',
  done: '#00FF88',
  cancelled: '#4B5563',
  active: '#00FF88',
  paused: '#F59E0B',
  completed: '#00FF88',
  abandoned: '#EF4444',
} as const;

export const MAX_TODAY_TASKS = 7;

export const RATING_LABELS: Record<number, string> = {
  0: 'Unrated',
  1: 'Meh',
  2: 'Interesting',
  3: 'Fire',
};
