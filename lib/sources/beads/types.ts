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
