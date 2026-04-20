export type ClaudeMemSession = {
  contentSessionId: string;
  memorySessionId: string | null;
  project: string;
  userPrompt: string | null;
  customTitle: string | null;
  startedAt: string | null;
};

export type ClaudeMemSummary = {
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  nextSteps: string | null;
};

export type ClaudeMemObservation = {
  id: number;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  filesRead: string | null;
  filesModified: string | null;
  promptNumber: number | null;
  createdAt: string;
};

export type ProjectMatchingMode = "exact" | "basename";
