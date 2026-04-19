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

export type ProjectMatchingMode = "exact" | "basename";
