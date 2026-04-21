import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clearAggregatorCache,
  getProjectCards,
  getProjectDetail,
  getProjectNotifications,
  getProjectSessionObservations,
} from "@/lib/services/aggregator";
import * as claudeCodeSource from "@/lib/sources/claude-code";
import * as claudeMemSource from "@/lib/sources/claude-mem";

const originalEnv = process.env.AIPANEL_CONFIG;

async function withTempConfig(content: string, run: () => Promise<void>) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-aggregator-test-"));
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

describe("aggregator", () => {
  it("returns empty cards list when config path points to missing file", async () => {
    process.env.AIPANEL_CONFIG = "/tmp/definitely-missing-aipanel-config.json";
    const cards = await getProjectCards();
    expect(cards).toEqual([]);
  });

  it("sorts projects by latest activity descending", async () => {
    vi.spyOn(claudeCodeSource, "listSessionsForProject").mockImplementation(async (projectPath: string) => {
      if (projectPath.endsWith("/alpha")) {
        return [
          {
            sessionId: "s-alpha",
            startedAt: "2026-01-01T00:00:00.000Z",
            lastActivityAt: "2026-01-01T00:00:00.000Z",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
            userPromptCount: 1,
            assistantTurnCount: 1,
            subagentCount: 0,
          },
        ];
      }
      if (projectPath.endsWith("/beta")) {
        return [
          {
            sessionId: "s-beta",
            startedAt: "2026-02-01T00:00:00.000Z",
            lastActivityAt: "2026-02-01T00:00:00.000Z",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
            userPromptCount: 1,
            assistantTurnCount: 1,
            subagentCount: 0,
          },
        ];
      }
      return [];
    });

    await withTempConfig(
      JSON.stringify({
        projects: [
          { name: "Gamma", path: "/tmp/gamma" },
          { name: "Alpha", path: "/tmp/alpha" },
          { name: "Beta", path: "/tmp/beta" },
        ],
      }),
      async () => {
        const cards = await getProjectCards();
        expect(cards.map((card) => card.name)).toEqual(["Beta", "Alpha", "Gamma"]);
      },
    );
  });

  it("returns detail with warnings when sources unavailable", async () => {
    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/non-existent-aipanel-project" }],
      }),
      async () => {
        const detail = await getProjectDetail("demo");
        expect(detail).not.toBeNull();
        expect(detail?.project.name).toBe("Demo");
        expect(Array.isArray(detail?.warnings)).toBe(true);
      },
    );
  });

  it("prefers mem title fields and falls back to session title", async () => {
    vi.spyOn(claudeCodeSource, "listSessionsForProject").mockResolvedValue([
      {
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
        userPromptCount: 1,
        assistantTurnCount: 1,
        subagentCount: 0,
      },
    ]);

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

  it("adds project metadata to project notifications", async () => {
    vi.spyOn(claudeCodeSource, "listNotificationsForProject").mockResolvedValue([
      {
        id: "n-1",
        sessionId: "s-1",
        sessionLabel: "session · s-1",
        createdAt: "2026-04-20T12:00:00.000Z",
        kind: "permission",
        title: "Run command",
        details: "Bash",
      },
    ]);

    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/demo" }],
      }),
      async () => {
        const notifications = await getProjectNotifications("demo");
        expect(notifications).toEqual([
          {
            id: "n-1",
            sessionId: "s-1",
            sessionLabel: "session · s-1",
            projectSlug: "demo",
            projectLabel: "Demo",
            createdAt: "2026-04-20T12:00:00.000Z",
            kind: "permission",
            title: "Run command",
            details: "Bash",
          },
        ]);
      },
    );
  });

  it("returns null observations when session does not belong to project", async () => {
    vi.spyOn(claudeMemSource, "isSessionInProject").mockResolvedValue(false);

    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/demo" }],
      }),
      async () => {
        const observations = await getProjectSessionObservations("demo", "mem-1");
        expect(observations).toBeNull();
      },
    );
  });

  it("returns observations when session belongs to project", async () => {
    vi.spyOn(claudeMemSource, "isSessionInProject").mockResolvedValue(true);
    vi.spyOn(claudeMemSource, "getSessionObservations").mockResolvedValue([
      {
        id: 1,
        type: "feature",
        title: "Observed change",
        subtitle: null,
        narrative: null,
        facts: null,
        concepts: null,
        filesRead: null,
        filesModified: null,
        promptNumber: 1,
        createdAt: "2026-04-20T12:00:00.000Z",
      },
    ]);

    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/demo" }],
      }),
      async () => {
        const observations = await getProjectSessionObservations("demo", "mem-1");
        expect(observations).toEqual([
          {
            id: 1,
            type: "feature",
            title: "Observed change",
            subtitle: null,
            narrative: null,
            facts: null,
            concepts: null,
            filesRead: null,
            filesModified: null,
            promptNumber: 1,
            createdAt: "2026-04-20T12:00:00.000Z",
          },
        ]);
      },
    );
  });
});
