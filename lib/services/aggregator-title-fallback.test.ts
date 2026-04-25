import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAggregatorCache, getProjectDetail } from "@/lib/services/aggregator";
import * as claudeCodeSource from "@/lib/sources/claude-code";
import type { ClaudeSessionSummary } from "@/lib/sources/claude-code/types";
import * as claudeMemSource from "@/lib/sources/claude-mem";

const originalEnv = process.env.AIPANEL_CONFIG;

async function withTempConfig(content: string, run: () => Promise<void>) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-aggregator-title-test-"));
  const configPath = path.join(tempRoot, "projects.json");
  await fs.writeFile(configPath, content, "utf8");
  process.env.AIPANEL_CONFIG = configPath;

  try {
    await run();
  } finally {
    clearAggregatorCache();
    if (originalEnv) {
      process.env.AIPANEL_CONFIG = originalEnv;
    } else {
      delete process.env.AIPANEL_CONFIG;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

beforeEach(() => {
  clearAggregatorCache();
  vi.restoreAllMocks();
});

function createSession(overrides: Partial<ClaudeSessionSummary> = {}): ClaudeSessionSummary {
  return {
    sessionId: "s-1",
    title: "Claude log title",
    startedAt: "2026-04-21T09:00:00.000Z",
    lastActivityAt: "2026-04-21T09:10:00.000Z",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    usageSplit: {
      main: { inputTokens: 1, outputTokens: 1 },
      agents: { inputTokens: 0, outputTokens: 0 },
      total: { inputTokens: 1, outputTokens: 1 },
    },
    contextUsage: {
      contextTokens: 1,
      source: "estimated-from-latest-usage",
    },
    userPromptCount: 1,
    assistantTurnCount: 1,
    subagentCount: 0,
    ...overrides,
  };
}

describe("aggregator title fallback", () => {
  it("prefers claude-mem customTitle", async () => {
    vi.spyOn(claudeCodeSource, "listSessionsForProject").mockResolvedValue([createSession()]);

    vi.spyOn(claudeMemSource, "listSessionsForProject").mockResolvedValue([
      {
        contentSessionId: "s-1",
        memorySessionId: null,
        project: "demo",
        userPrompt: "Mem prompt title",
        customTitle: "Mem custom title",
        startedAt: "2026-04-21T09:00:00.000Z",
      },
    ]);

    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/demo" }],
      }),
      async () => {
        const detail = await getProjectDetail("demo");
        expect(detail?.sessions[0]?.title).toBe("Mem custom title");
      },
    );
  });

  it("falls back to claude-mem userPrompt when customTitle missing", async () => {
    vi.spyOn(claudeCodeSource, "listSessionsForProject").mockResolvedValue([createSession()]);

    vi.spyOn(claudeMemSource, "listSessionsForProject").mockResolvedValue([
      {
        contentSessionId: "s-1",
        memorySessionId: null,
        project: "demo",
        userPrompt: "Mem prompt title",
        customTitle: null,
        startedAt: "2026-04-21T09:00:00.000Z",
      },
    ]);

    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/demo" }],
      }),
      async () => {
        const detail = await getProjectDetail("demo");
        expect(detail?.sessions[0]?.title).toBe("Mem prompt title");
      },
    );
  });

  it("falls back to session title when claude-mem title fields are blank strings", async () => {
    vi.spyOn(claudeCodeSource, "listSessionsForProject").mockResolvedValue([createSession()]);

    vi.spyOn(claudeMemSource, "listSessionsForProject").mockResolvedValue([
      {
        contentSessionId: "s-1",
        memorySessionId: null,
        project: "demo",
        userPrompt: "   ",
        customTitle: "",
        startedAt: "2026-04-21T09:00:00.000Z",
      },
    ]);

    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/demo" }],
      }),
      async () => {
        const detail = await getProjectDetail("demo");
        expect(detail?.sessions[0]?.title).toBe("Claude log title");
      },
    );
  });

  it("falls back to session title when claude-mem title fields are empty", async () => {
    vi.spyOn(claudeCodeSource, "listSessionsForProject").mockResolvedValue([createSession()]);

    vi.spyOn(claudeMemSource, "listSessionsForProject").mockResolvedValue([
      {
        contentSessionId: "s-1",
        memorySessionId: null,
        project: "demo",
        userPrompt: null,
        customTitle: null,
        startedAt: "2026-04-21T09:00:00.000Z",
      },
    ]);

    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/demo" }],
      }),
      async () => {
        const detail = await getProjectDetail("demo");
        expect(detail?.sessions[0]?.title).toBe("Claude log title");
      },
    );
  });
});
