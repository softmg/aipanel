import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createNotifierDaemonState,
  formatNotifierStartupSummary,
  getNotifierStartupStatus,
  runNotifierDaemon,
  scanNotifierProjects,
  type NotifierDependencies,
  type NotifierLogger,
} from "@/lib/notifications/notifier-daemon";
import { dispatchTelegramHumanInterventionNotifications } from "@/lib/notifications/telegram-human-intervention-dispatcher";
import { saveNotificationSecrets } from "@/lib/notifications/secrets";
import { getDefaultNotificationSettings, saveNotificationSettings } from "@/lib/notifications/settings";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

type ProjectInput = {
  slug: string;
  name: string;
};

type DispatchSummary = {
  considered: number;
  eligible: number;
  sent: number;
  skipped: number;
  failed: number;
};

type MutableHarness = {
  projects: ProjectInput[];
  notificationsByProject: Map<string, ClaudeNotification[]>;
  failingProjects: Set<string>;
  dispatchError: Error | null;
  dispatchSummary: DispatchSummary | null;
  dispatchSpy: (items: ClaudeNotification[]) => void;
};

function createNotification(overrides: Partial<ClaudeNotification> = {}): ClaudeNotification {
  return {
    id: "notification-1",
    sessionId: "session-1",
    sessionLabel: "session · session-1",
    projectSlug: "aipanel",
    projectLabel: "aipanel",
    createdAt: "2026-04-27T08:00:00.000Z",
    kind: "task",
    title: "Build finished",
    status: "completed",
    details: "Status: completed",
    source: "log",
    ...overrides,
  };
}

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-notifier-daemon-"));

  try {
    await run(configDir);
  } finally {
    await fs.rm(configDir, { recursive: true, force: true });
  }
}

async function setupEnabledTelegram(configDir: string): Promise<void> {
  const settings = getDefaultNotificationSettings();
  settings.enabled = true;
  settings.channels.telegram = true;
  settings.rules[0]!.channels.telegram = true;
  await saveNotificationSettings(settings, { configDir });
  await saveNotificationSecrets({ telegramBotToken: "123456:ABCtoken", telegramChatId: "-100123456789" }, { configDir });
}

function createHarness(initial: {
  projects: ProjectInput[];
  notificationsByProject?: Map<string, ClaudeNotification[]>;
  dispatchSummary?: DispatchSummary;
}): { deps: NotifierDependencies; mutable: MutableHarness } {
  const mutable: MutableHarness = {
    projects: [...initial.projects],
    notificationsByProject: new Map(initial.notificationsByProject ?? []),
    failingProjects: new Set<string>(),
    dispatchError: null,
    dispatchSummary: initial.dispatchSummary ?? null,
    dispatchSpy: () => undefined,
  };

  const deps: NotifierDependencies = {
    loadProjects: vi.fn(async () => (
      mutable.projects.map((project) => ({
        ...project,
        absolutePath: `/tmp/${project.slug}`,
        encodedPath: project.slug,
      }))
    )),
    getProjectNotifications: vi.fn(async (slug: string) => {
      if (mutable.failingProjects.has(slug)) {
        throw new Error(`boom ${slug}`);
      }
      return mutable.notificationsByProject.get(slug) ?? [];
    }),
    dispatchTelegram: vi.fn(async (items: ClaudeNotification[]) => {
      mutable.dispatchSpy(items);
      if (mutable.dispatchError) {
        throw mutable.dispatchError;
      }

      return mutable.dispatchSummary ?? {
        considered: items.length,
        eligible: items.length,
        sent: items.length,
        skipped: 0,
        failed: 0,
      };
    }),
    loadSettings: vi.fn(async () => {
      const settings = getDefaultNotificationSettings();
      settings.enabled = true;
      settings.channels.telegram = true;
      settings.rules[0]!.channels.telegram = true;
      return settings;
    }),
    loadSecrets: vi.fn(async () => ({ telegramBotToken: "123456:ABCtoken", telegramChatId: "-100123456789" })),
  };

  return { deps, mutable };
}

describe("scanNotifierProjects", () => {
  it("first scan establishes baseline and sends nothing", async () => {
    const state = createNotifierDaemonState();
    const { deps } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        [
          "aipanel",
          [
            createNotification({
              id: "historical-ready-for-review",
              source: "derived",
              details: "Assistant finished responding: pong",
            }),
          ],
        ],
      ]),
    });

    const summary = await scanNotifierProjects(state, { catchUp: false }, deps);

    expect(summary.baselineEstablished).toBe(true);
    expect(summary.newSinceCursor).toBe(0);
    expect(summary.sent).toBe(0);
    expect(deps.dispatchTelegram).not.toHaveBeenCalled();
  });

  it("second scan sends new task-ready-for-review notification", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "old", createdAt: "2026-04-27T08:00:00.000Z" })]],
      ]),
    });

    await scanNotifierProjects(state, {}, deps);

    mutable.notificationsByProject.set("aipanel", [
      createNotification({ id: "old", createdAt: "2026-04-27T08:00:00.000Z" }),
      createNotification({ id: "new", createdAt: "2026-04-27T08:00:01.000Z" }),
    ]);

    const summary = await scanNotifierProjects(state, {}, deps);

    expect(summary.newSinceCursor).toBe(1);
    expect(summary.sent).toBe(1);
    expect(deps.dispatchTelegram).toHaveBeenCalledTimes(1);
    const items = (deps.dispatchTelegram as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ClaudeNotification[];
    expect(items.map((item) => item.id)).toEqual(["new"]);
  });

  it("second scan sends new ping-pong ready-for-review notification", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);

      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        createNotification({
          id: "session-1-ready-for-review-1777271796753-f8b88b",
          createdAt: "2026-04-27T08:00:01.000Z",
          kind: "task",
          status: "completed",
          source: "derived",
          title: "Task ready for review",
          details: "Assistant finished responding: pong",
        }),
      ]);

      const summary = await scanNotifierProjects(state, { configDir }, deps);

      expect(summary.newSinceCursor).toBe(1);
      expect(summary.eligible).toBe(1);
      expect(summary.sent).toBe(1);
      expect(sender).toHaveBeenCalledTimes(1);
    });
  });

  it("permission notification is not sent", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);

      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        createNotification({
          id: "permission",
          kind: "permission",
          title: "Run git status",
          createdAt: "2026-04-27T08:00:01.000Z",
        }),
      ]);

      const summary = await scanNotifierProjects(state, { configDir }, deps);

      expect(summary.newSinceCursor).toBe(1);
      expect(summary.considered).toBe(1);
      expect(summary.eligible).toBe(0);
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(sender).not.toHaveBeenCalled();
    });
  });

  it("question notification is sent", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);

      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        createNotification({ id: "question", kind: "question", title: "Which option should we use?", status: undefined, createdAt: "2026-04-27T08:00:02.000Z" }),
      ]);

      const summary = await scanNotifierProjects(state, { configDir }, deps);

      expect(summary.newSinceCursor).toBe(1);
      expect(summary.eligible).toBe(1);
      expect(summary.sent).toBe(1);
      expect(summary.skipped).toBe(0);
      expect(sender).toHaveBeenCalledTimes(1);
    });
  });

  it("alert notification is not sent", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);

      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        createNotification({ id: "alert", kind: "alert", createdAt: "2026-04-27T08:00:02.000Z" }),
      ]);

      const summary = await scanNotifierProjects(state, { configDir }, deps);

      expect(summary.newSinceCursor).toBe(1);
      expect(summary.eligible).toBe(0);
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(sender).not.toHaveBeenCalled();
    });
  });

  it("older/reordered notification is not sent", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "newest", createdAt: "2026-04-27T08:00:02.000Z" })]],
      ]),
    });

    await scanNotifierProjects(state, {}, deps);

    mutable.notificationsByProject.set("aipanel", [
      createNotification({ id: "older", createdAt: "2026-04-27T08:00:01.000Z" }),
      createNotification({ id: "newest", createdAt: "2026-04-27T08:00:02.000Z" }),
    ]);

    const summary = await scanNotifierProjects(state, {}, deps);

    expect(summary.newSinceCursor).toBe(0);
    expect(summary.sent).toBe(0);
    expect(deps.dispatchTelegram).not.toHaveBeenCalled();
  });

  it("same createdAt with lower/equal id is not sent", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "b", createdAt: "2026-04-27T08:00:02.000Z" })]],
      ]),
    });

    await scanNotifierProjects(state, {}, deps);

    mutable.notificationsByProject.set("aipanel", [
      createNotification({ id: "a", createdAt: "2026-04-27T08:00:02.000Z" }),
      createNotification({ id: "b", createdAt: "2026-04-27T08:00:02.000Z" }),
    ]);

    const summary = await scanNotifierProjects(state, {}, deps);

    expect(summary.newSinceCursor).toBe(0);
    expect(deps.dispatchTelegram).not.toHaveBeenCalled();
  });

  it("same createdAt with greater id is handled deterministically", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "a", createdAt: "2026-04-27T08:00:02.000Z" })]],
      ]),
    });

    await scanNotifierProjects(state, {}, deps);

    mutable.notificationsByProject.set("aipanel", [
      createNotification({ id: "a", createdAt: "2026-04-27T08:00:02.000Z" }),
      createNotification({ id: "b", createdAt: "2026-04-27T08:00:02.000Z" }),
    ]);

    const summary = await scanNotifierProjects(state, {}, deps);

    expect(summary.newSinceCursor).toBe(1);
    expect(summary.sent).toBe(1);
    const items = (deps.dispatchTelegram as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ClaudeNotification[];
    expect(items.map((item) => item.id)).toEqual(["b"]);
  });

  it("already delivered notification is not resent because delivery log handles it", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);

      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      const delivered = createNotification({ id: "task-once", createdAt: "2026-04-27T08:00:01.000Z" });
      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        delivered,
      ]);

      const first = await scanNotifierProjects(state, { configDir }, deps);

      state.cursorByProjectSlug.set("aipanel", { createdAtMs: new Date("2026-04-27T08:00:00.000Z").valueOf(), id: "base" });
      state.seededProjects.add("aipanel");
      const second = await scanNotifierProjects(state, { configDir }, deps);

      expect(first.sent).toBe(1);
      expect(second.sent).toBe(0);
      expect(second.skipped).toBe(1);
      expect(sender).toHaveBeenCalledTimes(1);
    });
  });

  it("global notifications disabled means no send", async () => {
    await withTempConfigDir(async (configDir) => {
      const settings = getDefaultNotificationSettings();
      settings.enabled = false;
      settings.channels.telegram = true;
      settings.rules[0]!.channels.telegram = true;
      await saveNotificationSettings(settings, { configDir });
      await saveNotificationSecrets({ telegramBotToken: "123456:ABCtoken", telegramChatId: "-100123456789" }, { configDir });

      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);
      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        createNotification({ id: "new", createdAt: "2026-04-27T08:00:01.000Z" }),
      ]);

      const summary = await scanNotifierProjects(state, { configDir }, deps);

      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(sender).not.toHaveBeenCalled();
    });
  });

  it("Telegram channel disabled means no send", async () => {
    await withTempConfigDir(async (configDir) => {
      const settings = getDefaultNotificationSettings();
      settings.enabled = true;
      settings.channels.telegram = false;
      settings.rules[0]!.channels.telegram = false;
      await saveNotificationSettings(settings, { configDir });
      await saveNotificationSecrets({ telegramBotToken: "123456:ABCtoken", telegramChatId: "-100123456789" }, { configDir });

      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);
      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        createNotification({ id: "new", createdAt: "2026-04-27T08:00:01.000Z" }),
      ]);

      const summary = await scanNotifierProjects(state, { configDir }, deps);

      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(sender).not.toHaveBeenCalled();
    });
  });

  it("Telegram not configured means no send", async () => {
    await withTempConfigDir(async (configDir) => {
      const settings = getDefaultNotificationSettings();
      settings.enabled = true;
      settings.channels.telegram = true;
      settings.rules[0]!.channels.telegram = true;
      await saveNotificationSettings(settings, { configDir });

      const state = createNotifierDaemonState();
      const sender = vi.fn().mockResolvedValue(undefined);
      const { deps, mutable } = createHarness({
        projects: [{ slug: "aipanel", name: "aipanel" }],
        notificationsByProject: new Map([
          ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
        ]),
      });

      deps.dispatchTelegram = vi.fn(async (notifications: ClaudeNotification[]) => {
        return dispatchTelegramHumanInterventionNotifications(notifications, { configDir, sender });
      });

      await scanNotifierProjects(state, { configDir }, deps);

      mutable.notificationsByProject.set("aipanel", [
        createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
        createNotification({ id: "new", createdAt: "2026-04-27T08:00:01.000Z" }),
      ]);

      const summary = await scanNotifierProjects(state, { configDir }, deps);

      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(sender).not.toHaveBeenCalled();
    });
  });

  it("one project failure does not crash the whole daemon scan", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [
        { slug: "good", name: "good" },
        { slug: "bad", name: "bad" },
      ],
      notificationsByProject: new Map([
        ["good", [createNotification({ id: "good-base", projectSlug: "good", projectLabel: "good" })]],
      ]),
    });
    mutable.failingProjects.add("bad");

    const summary = await scanNotifierProjects(state, {}, deps);

    expect(summary.projectsSucceeded).toBe(1);
    expect(summary.projectsFailed).toBe(1);
    expect(summary.projectSummaries.find((item) => item.projectSlug === "bad")?.error).toContain("boom bad");
  });

  it("summary counts are correct", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
      ]),
      dispatchSummary: { considered: 2, eligible: 1, sent: 1, skipped: 1, failed: 0 },
    });

    await scanNotifierProjects(state, {}, deps);

    mutable.notificationsByProject.set("aipanel", [
      createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
      createNotification({ id: "task", createdAt: "2026-04-27T08:00:01.000Z" }),
      createNotification({ id: "perm", kind: "permission", createdAt: "2026-04-27T08:00:02.000Z" }),
    ]);

    const summary = await scanNotifierProjects(state, {}, deps);

    expect(summary).toMatchObject({
      projectsWatched: 1,
      projectsSucceeded: 1,
      projectsFailed: 0,
      fetched: 3,
      newSinceCursor: 2,
      considered: 2,
      eligible: 1,
      sent: 1,
      skipped: 1,
      failed: 0,
    });
  });

  it("errors are sanitized and do not include bot token", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
      ]),
    });

    await scanNotifierProjects(state, {}, deps);

    mutable.notificationsByProject.set("aipanel", [
      createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
      createNotification({ id: "new", createdAt: "2026-04-27T08:00:01.000Z" }),
    ]);
    mutable.dispatchError = new Error("Telegram failed 123456:ABCtoken /bot123456:ABCtoken/sendMessage");

    const summary = await scanNotifierProjects(state, {}, deps);
    const error = summary.projectSummaries[0]?.error ?? "";

    expect(error).toContain("[redacted-token]");
    expect(error).toContain("[path]");
    expect(error).not.toContain("123456:ABCtoken");
    expect(error).not.toContain("/bot123456:ABCtoken/");
  });
});

describe("runNotifierDaemon", () => {
  it("--once mode establishes baseline and logs explicit message", async () => {
    const state = createNotifierDaemonState();
    const loggerMessages: string[] = [];
    const logger: NotifierLogger = {
      info: (message) => {
        loggerMessages.push(`INFO ${message}`);
      },
      error: (message) => {
        loggerMessages.push(`ERROR ${message}`);
      },
    };

    const { deps } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
      ]),
    });

    const result = await runNotifierDaemon({ once: true }, deps, logger, state);

    expect(result.lastScan?.projectsWatched).toBe(1);
    expect(result.baselineOnlyOnce).toBe(true);
    expect(loggerMessages.some((line) => line.includes("Baseline established. No historical notifications were sent."))).toBe(true);
  });

  it("dry-run does not dispatch and keeps deterministic counts", async () => {
    const state = createNotifierDaemonState();
    const { deps, mutable } = createHarness({
      projects: [{ slug: "aipanel", name: "aipanel" }],
      notificationsByProject: new Map([
        ["aipanel", [createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" })]],
      ]),
    });

    await scanNotifierProjects(state, {}, deps);

    mutable.notificationsByProject.set("aipanel", [
      createNotification({ id: "base", createdAt: "2026-04-27T08:00:00.000Z" }),
      createNotification({ id: "permission", kind: "permission", createdAt: "2026-04-27T08:00:01.000Z" }),
      createNotification({ id: "question", kind: "question", title: "Which option should we use?", status: undefined, createdAt: "2026-04-27T08:00:02.000Z" }),
      createNotification({ id: "task-complete", kind: "task", status: "completed", createdAt: "2026-04-27T08:00:03.000Z" }),
    ]);

    const summary = await scanNotifierProjects(state, { dryRun: true }, deps);

    expect(summary.newSinceCursor).toBe(3);
    expect(summary.considered).toBe(3);
    expect(summary.eligible).toBe(2);
    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(3);
    expect(deps.dispatchTelegram).not.toHaveBeenCalled();
  });

  it("formatNotifierStartupSummary outputs safe status flags", () => {
    const line = formatNotifierStartupSummary(
      {
        projectsWatched: 3,
        telegramConfigured: true,
        telegramChannelEnabled: false,
        notificationsEnabled: true,
      },
      3000,
    );

    expect(line).toContain("projects=3");
    expect(line).toContain("telegramConfigured=yes");
    expect(line).toContain("telegramChannelEnabled=no");
  });
});

describe("getNotifierStartupStatus", () => {
  it("reports telegram configured and enabled", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const { deps } = createHarness({ projects: [{ slug: "aipanel", name: "aipanel" }] });

      deps.loadSettings = vi.fn(async () => {
        const { loadNotificationSettings } = await import("@/lib/notifications/settings");
        return loadNotificationSettings({ configDir });
      });

      deps.loadSecrets = vi.fn(async () => {
        const { loadNotificationSecrets } = await import("@/lib/notifications/secrets");
        return loadNotificationSecrets({ configDir });
      });

      const status = await getNotifierStartupStatus({ configDir }, deps);

      expect(status).toEqual({
        projectsWatched: 1,
        telegramConfigured: true,
        telegramChannelEnabled: true,
        notificationsEnabled: true,
      });
    });
  });
});
