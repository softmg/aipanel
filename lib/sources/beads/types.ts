export type BeadTask = {
  id: string;
  title: string;
  status: string;
  priority?: number;
  type?: string;
  assignee?: string;
  created_at?: string;
  updated_at?: string;
};

export type BeadStatusColumn = "open" | "in_progress" | "blocked" | "closed" | "other";

export type BeadTaskDetail = {
  id: string;
  title: string;
  status: string;
  priority?: number;
  type?: string;
  assignee?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  close_reason?: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
};
