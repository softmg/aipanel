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
