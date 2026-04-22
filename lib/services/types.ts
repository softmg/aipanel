import type { BeadTask } from "@/lib/sources/beads/types";
import type { ClaudeNotification, ClaudeSessionSummary, TokenUsageSplit } from "@/lib/sources/claude-code/types";
import type { ClaudeMemSummary } from "@/lib/sources/claude-mem/types";

export type ProjectCard = {
  slug: string;
  name: string;
  absolutePath: string;
  lastActivityAt: string | null;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  usageSplit: TokenUsageSplit;
  beadsCounts: {
    open: number;
    in_progress: number;
    blocked: number;
    closed: number;
    other: number;
  };
};

export type ProjectDetail = {
  project: {
    slug: string;
    name: string;
    absolutePath: string;
  };
  sessions: Array<
    ClaudeSessionSummary & {
      title?: string;
      summary?: ClaudeMemSummary | null;
      memorySessionId?: string | null;
    }
  >;
  beads: BeadTask[];
  notifications: ClaudeNotification[];
  warnings: string[];
};
