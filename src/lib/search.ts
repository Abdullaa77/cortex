export interface SearchResult {
  id: string;
  type: 'task' | 'project' | 'idea' | 'area' | 'inbox';
  title: string;
  subtitle?: string;
  icon: string;
  color?: string;
  href?: string;
  action?: () => void;
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Substring match first
  if (t.includes(q)) return true;

  // Fuzzy: characters appear in order
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  if (t === q) return 100;
  if (t.startsWith(q)) return 90;

  const idx = t.indexOf(q);
  if (idx >= 0) return 80 - idx;

  let score = 0;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}
