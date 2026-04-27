import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { makeDeliveryKey, getNotificationDeliveryLogPath } from "@/lib/notifications/delivery-log";
import { saveNotificationSecrets } from "@/lib/notifications/secrets";
import { getDefaultNotificationSettings, saveNotificationSettings } from "@/lib/notifications/settings";
import { dispatchTelegramHumanInterventionNotifications } from "@/lib/notifications/telegram-human-intervention-dispatcher";
import { dispatchTelegramTaskCompletionNotifications } from "@/lib/notifications/telegram-task-dispatcher";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-telegram-human-intervention-"));

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
    createdAt: "2026-04-27T08:00:00.000Z",
    kind: "task",
    title: "Task ready for review",
    status: "completed",
    details: "Assistant finished responding: pong",
    source: "derived",
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

describe("dispatchTelegramHumanInterventionNotifications", () => {
  it("sends question and task-ready-for-review notifications", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const summary = await dispatchTelegramHumanInterventionNotifications(
        [
          createNotification({ id: "question", kind: "question", title: "Which option should we use?" }),
          createNotification({ id: "ready", kind: "task", status: "completed", source: "derived" }),
        ],
        { configDir, sender },
      );

      expect(sender).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({ considered: 2, eligible: 2, sent: 2, skipped: 0, failed: 0 });
    });
  });

  it("skips permission requests, context alerts, and running tasks", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);

      const summary = await dispatchTelegramHumanInterventionNotifications(
        [
          createNotification({ id: "permission", kind: "permission", title: "Run git status", details: "Bash" }),
          createNotification({ id: "alert", kind: "alert", title: "Context threshold reached", status: "warning" }),
          createNotification({ id: "running", kind: "task", title: "Task running", status: "running" }),
        ],
        { configDir, sender },
      );

      expect(sender).not.toHaveBeenCalled();
      expect(summary).toEqual({ considered: 3, eligible: 0, sent: 0, skipped: 3, failed: 0 });
    });
  });

  it("does not resend the same ping-pong completion after a successful delivery", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);
      const notification = createNotification({ id: "session-1-ready-for-review-1777271796753-f8b88b" });

      const first = await dispatchTelegramHumanInterventionNotifications([notification], { configDir, sender });
      const second = await dispatchTelegramHumanInterventionNotifications([notification], { configDir, sender });

      expect(sender).toHaveBeenCalledTimes(1);
      expect(first.sent).toBe(1);
      expect(second.sent).toBe(0);
      expect(second.skipped).toBe(1);
    });
  });

  it("dedupes existing legacy task-completion delivery log rows", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);
      const notification = createNotification({ id: "legacy-task" });

      const legacy = await dispatchTelegramTaskCompletionNotifications([notification], { configDir, sender });
      const next = await dispatchTelegramHumanInterventionNotifications([notification], { configDir, sender });

      expect(legacy.sent).toBe(1);
      expect(next.sent).toBe(0);
      expect(next.skipped).toBe(1);
      expect(sender).toHaveBeenCalledTimes(1);
    });
  });

  it("records new human-intervention delivery rows with the human-intervention rule", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi.fn().mockResolvedValue(undefined);
      const notification = createNotification({ id: "ready" });

      await dispatchTelegramHumanInterventionNotifications([notification], { configDir, sender });

      const db = new Database(getNotificationDeliveryLogPath({ configDir }), { readonly: true });
      try {
        const key = makeDeliveryKey({
          channel: "telegram",
          notificationId: "ready",
          projectSlug: "aipanel",
          sessionId: "session-1",
          ruleId: "human-intervention",
        });
        const row = db.prepare("select id, status, rule_id from notification_delivery_log where id = ?").get(key) as
          | { id: string; status: string; rule_id: string }
          | undefined;

        expect(row).toEqual({ id: key, status: "success", rule_id: "human-intervention" });
      } finally {
        db.close();
      }
    });
  });

  it("continues after sanitized sender errors", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledTelegram(configDir);
      const sender = vi
        .fn()
        .mockRejectedValueOnce(new Error("Telegram failed /bot123456:ABCtoken/sendMessage chat_id=-100123456789"))
        .mockResolvedValueOnce(undefined);

      const summary = await dispatchTelegramHumanInterventionNotifications(
        [
          createNotification({ id: "fail" }),
          createNotification({ id: "pass", sessionId: "session-2" }),
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

        expect(rows[0]?.notification_id).toBe("fail");
        expect(rows[0]?.status).toBe("failed");
        expect(rows[0]?.error ?? "").not.toContain("123456:ABCtoken");
        expect(rows[0]?.error ?? "").not.toContain("-100123456789");
        expect(rows[1]?.notification_id).toBe("pass");
        expect(rows[1]?.status).toBe("success");
      } finally {
        db.close();
      }
    });
  });
});
