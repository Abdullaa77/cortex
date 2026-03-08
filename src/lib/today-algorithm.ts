import { Task } from './types';
import { isOverdue, isDueToday } from './helpers';

const MAX_TODAY = 7;

export function computeTodayTasks(allTasks: Task[]): Task[] {
  const activeTasks = allTasks.filter(
    (t) => t.status === 'todo' || t.status === 'in_progress'
  );

  const scored = activeTasks.map((task) => ({
    task,
    score: computeScore(task),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_TODAY).map((s) => s.task);
}

function computeScore(task: Task): number {
  let score = 0;

  // In-progress tasks get highest base — you already started, finish it
  if (task.status === 'in_progress') score += 1000;

  // Overdue is critical
  if (isOverdue(task.due_date)) score += 500;

  // Due today is urgent
  if (isDueToday(task.due_date)) score += 300;

  // Manually pinned = user explicitly wants this today
  if (task.is_pinned) score += 200;

  // Priority weight (inverted — P1 gets most points)
  const priorityWeight = { 1: 100, 2: 60, 3: 30, 4: 10 };
  score += priorityWeight[task.priority as keyof typeof priorityWeight] || 10;

  // Due soon bonus (within 3 days)
  if (task.due_date) {
    const daysUntil = Math.ceil(
      (new Date(task.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil > 0 && daysUntil <= 3) score += 50;
  }

  return score;
}
