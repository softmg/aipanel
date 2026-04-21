export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type ClaudeSubagentSummary = {
  agentId: string;
  agentName: string;
  turns: number;
  lastActivityAt: string | null;
};

export type ClaudeSessionSummary = {
  sessionId: string;
  title?: string;
  startedAt: string | null;
  lastActivityAt: string | null;
  usage: TokenUsage;
  userPromptCount: number;
  assistantTurnCount: number;
  subagentCount: number;
  subagents?: ClaudeSubagentSummary[];
};

export type ClaudeSessionDetail = ClaudeSessionSummary;

export type ClaudeNotificationKind = "question" | "permission" | "task";

export type ClaudeNotification = {
  id: string;
  sessionId: string;
  sessionLabel: string;
  projectSlug?: string;
  projectLabel?: string;
  createdAt: string;
  kind: ClaudeNotificationKind;
  title: string;
  details?: string;
  status?: string;
};
