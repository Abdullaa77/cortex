export interface Area {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  area_id: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  priority: 1 | 2 | 3;
  deadline: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Computed (joined)
  area?: Area;
  task_count?: number;
  completed_task_count?: number;
}

export interface Task {
  id: string;
  user_id: string;
  project_id: string | null;
  area_id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 1 | 2 | 3 | 4;
  due_date: string | null;
  estimated_minutes: number | null;
  is_pinned: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Computed (joined)
  area?: Area;
  project?: Project;
}

export interface Idea {
  id: string;
  user_id: string;
  area_id: string | null;
  title: string;
  body: string;
  rating: 0 | 1 | 2 | 3;
  tags: string[];
  created_at: string;
  updated_at: string;
  // Computed
  area?: Area;
}

export interface InboxItem {
  id: string;
  user_id: string;
  raw_text: string;
  source: 'quick_capture' | 'manual';
  created_at: string;
  processed_at: string | null;
  processed_to: 'task' | 'idea' | 'project' | 'trashed' | null;
  processed_ref_id: string | null;
}
