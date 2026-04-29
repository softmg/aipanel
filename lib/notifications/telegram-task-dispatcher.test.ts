import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { dispatchTelegramTaskCompletionNotifications } from "@/lib/notifications/telegram-task-dispatcher";
import { getNotificationDeliveryLogPath } from "@/lib/notifications/delivery-log";
import { saveNotificationSecrets } from "@/lib/notifications/secrets";
import { getDefaultNotificationSettings, saveNotificationSettings } from "@/lib/notifications/settings";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-telegram-dispatcher-"));

  try {
    await run(configDir);
  } finally {
    await fs.rm(configDir, { recursive: true, force: true });
  }
}

function createNotification(overrides: Partial<ClaudeNotification> = {}): ClaudeNotification {
  return {
    id: "notification-1",
    sessionId: "session-1",
    sessionLabel: "session · session-1",
    projectSlug: "aipanel",
    projectLabel: "aipanel",
    createdAt: "2026-04-26T12:00:00.000Z",
    kind: "task",
    title: "Build finished",
    status: "completed",
    details: "Status: completed",
    source: "log",
    ...overrides,
  };
}

async function setupEnabledTelegram(configDir: string): Promise<void> {
  const settings = getDefaultNotificationSettings();
  settings.enabled = true;
  settings.channels.telegram = true;
  settings.rules[0]!.channels.telegram = true;
  await saveNotificationSettings(settings, { configDir });
  await saveNotificationSecrets({ telegramBotToken: "123456:ABCtoken", telegramChatId: "-100123456789" }, { configDir });
}

describe("dispatchTelegramTaskCompletionNotifications", () => {
  it("sends only task-completion notifications", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const summary = await dispatchTelegramTaskCompletionNotifications(
        [
          createNotification({ id: "task-complete", kind: "task", status: "completed" }),
          createNotification({ id: "task-running", kind: "task", status: "running" }),
        ],
        { configDir, sender },
      );

      expect(sender).toHaveBeenCalledTimes(1);
      expect(summary).toEqual({ considered: 2, eligible: 1, sent: 1, skipped: 1, failed: 0 });
    });
  });

  it("skips permission notifications even when Telegram is enabled", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const summary = await dispatchTelegramTaskCompletionNotifications(
        [createNotification({ kind: "permission", title: "Run git status" })],
        { configDir, sender },
      );

      expect(sender).not.toHaveBeenCalled();
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });
  });

  it("skips question notifications", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const summary = await dispatchTelegramTaskCompletionNotifications(
        [createNotification({ kind: "question", title: "Which panel should we use?" })],
        { configDir, sender },
      );

      expect(sender).not.toHaveBeenCalled();
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });
  });

  it("skips alert notifications", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const summary = await dispatchTelegramTaskCompletionNotifications(
        [createNotification({ kind: "alert", title: "Context threshold reached" })],
        { configDir, sender },
      );

      expect(sender).not.toHaveBeenCalled();
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });
  });

  it("skips when Telegram is not configured", async () => {
    await withTempConfigDir(async (configDir) => {
      const settings = getDefaultNotificationSettings();
      settings.enabled = true;
      settings.channels.telegram = true;
      settings.rules[0]!.channels.telegram = true;
      await saveNotificationSettings(settings, { configDir });

      const sender = vi.fn().mockResolvedValue(undefined);
      const summary = await dispatchTelegramTaskCompletionNotifications([createNotification()], { configDir, sender });

      expect(sender).not.toHaveBeenCalled();
      expect(summary).toEqual({ considered: 1, eligible: 0, sent: 0, skipped: 1, failed: 0 });
    });
  });

  it("skips when global settings are disabled", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const settings = getDefaultNotificationSettings();
      settings.enabled = false;
      settings.channels.telegram = true;
      settings.rules[0]!.channels.telegram = true;
      await saveNotificationSettings(settings, { configDir });

      const sender = vi.fn().mockResolvedValue(undefined);
      const summary = await dispatchTelegramTaskCompletionNotifications([createNotification()], { configDir, sender });

      expect(sender).not.toHaveBeenCalled();
      expect(summary).toEqual({ considered: 1, eligible: 0, sent: 0, skipped: 1, failed: 0 });
    });
  });

  it("skips when Telegram channel is disabled", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const settings = getDefaultNotificationSettings();
      settings.enabled = true;
      settings.channels.telegram = false;
      settings.rules[0]!.channels.telegram = false;
      await saveNotificationSettings(settings, { configDir });

      const sender = vi.fn().mockResolvedValue(undefined);
      const summary = await dispatchTelegramTaskCompletionNotifications([createNotification()], { configDir, sender });

      expect(sender).not.toHaveBeenCalled();
      expect(summary).toEqual({ considered: 1, eligible: 0, sent: 0, skipped: 1, failed: 0 });
    });
  });

  it("does not resend already delivered notification", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const payload = [createNotification({ id: "task-once" })];
      const first = await dispatchTelegramTaskCompletionNotifications(payload, { configDir, sender });
      const second = await dispatchTelegramTaskCompletionNotifications(payload, { configDir, sender });

      expect(sender).toHaveBeenCalledTimes(1);
      expect(first.sent).toBe(1);
      expect(second.sent).toBe(0);
      expect(second.skipped).toBe(1);
    });
  });

  it("dedupes semantically identical task completions with different ids within 5 seconds", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const first = createNotification({ id: "task-1", createdAt: "2026-04-29T16:00:00.000Z" });
      const second = createNotification({ id: "task-2", createdAt: "2026-04-29T16:00:04.000Z" });

      const firstSummary = await dispatchTelegramTaskCompletionNotifications([first], {
        configDir,
        sender,
        now: new Date("2026-04-29T16:00:00.000Z"),
      });
      const secondSummary = await dispatchTelegramTaskCompletionNotifications([second], {
        configDir,
        sender,
        now: new Date("2026-04-29T16:00:04.000Z"),
      });

      expect(sender).toHaveBeenCalledTimes(1);
      expect(firstSummary.sent).toBe(1);
      expect(secondSummary.sent).toBe(0);
      expect(secondSummary.skipped).toBe(1);
    });
  });

  it("records failure and continues on sender error", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi
        .fn()
        .mockRejectedValueOnce(new Error("Telegram notification request failed (401): bad token 123456:ABCtoken"))
        .mockResolvedValueOnce(undefined);

      const summary = await dispatchTelegramTaskCompletionNotifications(
        [
          createNotification({ id: "task-fail" }),
          createNotification({ id: "task-pass", sessionId: "session-2", status: "completed" }),
        ],
        { configDir, sender },
      );

      expect(sender).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({ considered: 2, eligible: 2, sent: 1, skipped: 0, failed: 1 });

      const db = new Database(getNotificationDeliveryLogPath({ configDir }), { readonly: true });
      try {
        const rows = db
          .prepare("select notification_id, status, error from notification_delivery_log order by notification_id asc")
          .all() as Array<{ notification_id: string; status: string; error: string | null }>;

        expect(rows).toHaveLength(2);
        expect(rows[0]?.notification_id).toBe("task-fail");
        expect(rows[0]?.status).toBe("failed");
        expect(rows[0]?.error ?? "").not.toContain("123456:ABCtoken");
        expect(rows[1]?.notification_id).toBe("task-pass");
        expect(rows[1]?.status).toBe("success");
      } finally {
        db.close();
      }
    });
  });

  it("summary counts are correct for mixed batch", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const summary = await dispatchTelegramTaskCompletionNotifications(
        [
          createNotification({ id: "task-complete", status: "completed" }),
          createNotification({ id: "permission", kind: "permission" }),
          createNotification({ id: "question", kind: "question" }),
          createNotification({ id: "alert", kind: "alert" }),
          createNotification({ id: "task-running", kind: "task", status: "running" }),
        ],
        { configDir, sender },
      );

      expect(summary).toEqual({ considered: 5, eligible: 1, sent: 1, skipped: 4, failed: 0 });
    });
  });
});
