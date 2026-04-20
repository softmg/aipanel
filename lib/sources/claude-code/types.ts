export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type ClaudeSessionSummary = {
  sessionId: string;
  startedAt: string | null;
  lastActivityAt: string | null;
  usage: TokenUsage;
  userPromptCount: number;
  assistantTurnCount: number;
  subagentCount: number;
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
