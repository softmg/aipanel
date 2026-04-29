import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { makeDeliveryKey, getNotificationDeliveryLogPath } from "@/lib/notifications/delivery-log";
import { getDefaultNotificationSettings, saveNotificationSettings } from "@/lib/notifications/settings";
import { dispatchMacOSHumanInterventionNotifications } from "@/lib/notifications/macos-human-intervention-dispatcher";
import { dispatchTelegramHumanInterventionNotifications } from "@/lib/notifications/telegram-human-intervention-dispatcher";
import { saveNotificationSecrets } from "@/lib/notifications/secrets";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-macos-human-intervention-"));

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

async function setupEnabledMacOS(configDir: string): Promise<void> {
  const settings = getDefaultNotificationSettings();
  settings.enabled = true;
  settings.channels.macos = true;
  settings.rules[0]!.channels.macos = true;
  await saveNotificationSettings(settings, { configDir });
}

describe("dispatchMacOSHumanInterventionNotifications", () => {
  it("macOS disabled means no send", async () => {
    await withTempConfigDir(async (configDir) => {
      const sender = vi.fn().mockResolvedValue({ ok: true });

      const summary = await dispatchMacOSHumanInterventionNotifications(
        [createNotification({ id: "question", kind: "question", status: undefined })],
        { configDir, sender },
      );

      expect(summary).toEqual({ considered: 1, eligible: 0, sent: 0, skipped: 1, failed: 0 });
      expect(sender).not.toHaveBeenCalled();
    });
  });

  it("sends question and ready-for-review notifications when enabled", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledMacOS(configDir);
      const sender = vi.fn().mockResolvedValue({ ok: true });

      const summary = await dispatchMacOSHumanInterventionNotifications(
        [
          createNotification({ id: "question", kind: "question", title: "Which option should we use?", status: undefined }),
          createNotification({ id: "ready", kind: "task", status: "completed", source: "derived" }),
        ],
        { configDir, sender },
      );

      expect(sender).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({ considered: 2, eligible: 2, sent: 2, skipped: 0, failed: 0 });
    });
  });

  it("sends permission/tool and skips context alerts", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledMacOS(configDir);
      const sender = vi.fn().mockResolvedValue({ ok: true });

      const summary = await dispatchMacOSHumanInterventionNotifications(
        [
          createNotification({ id: "permission", kind: "permission", title: "Run git status", details: "Bash" }),
          createNotification({ id: "alert", kind: "alert", title: "Context threshold reached", status: "warning" }),
        ],
        { configDir, sender },
      );

      expect(sender).toHaveBeenCalledTimes(1);
      expect(summary).toEqual({ considered: 2, eligible: 1, sent: 1, skipped: 1, failed: 0 });
    });
  });

  it("dedupes successful macOS delivery", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledMacOS(configDir);
      const sender = vi.fn().mockResolvedValue({ ok: true });
      const notification = createNotification({ id: "ready" });

      const first = await dispatchMacOSHumanInterventionNotifications([notification], { configDir, sender });
      const second = await dispatchMacOSHumanInterventionNotifications([notification], { configDir, sender });

      expect(first.sent).toBe(1);
      expect(second.sent).toBe(0);
      expect(second.skipped).toBe(1);
      expect(sender).toHaveBeenCalledTimes(1);
    });
  });

  it("dedupes semantically identical notifications with different ids within 5 seconds", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledMacOS(configDir);
      const sender = vi.fn().mockResolvedValue({ ok: true });

      const first = createNotification({
        id: "ready-1",
        createdAt: "2026-04-29T16:00:00.000Z",
        title: "Task ready for review",
        details: "Assistant finished responding: pong",
      });
      const second = createNotification({
        id: "ready-2",
        createdAt: "2026-04-29T16:00:04.000Z",
        title: "Task ready for review",
        details: "Assistant finished responding: pong",
      });

      const firstSummary = await dispatchMacOSHumanInterventionNotifications([first], {
        configDir,
        sender,
        now: new Date("2026-04-29T16:00:00.000Z"),
      });
      const secondSummary = await dispatchMacOSHumanInterventionNotifications([second], {
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

  it("keeps Telegram and macOS dedupe keys independent", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledMacOS(configDir);

      const settings = getDefaultNotificationSettings();
      settings.enabled = true;
      settings.channels.telegram = true;
      settings.rules[0]!.channels.telegram = true;
      settings.channels.macos = true;
      settings.rules[0]!.channels.macos = true;
      await saveNotificationSettings(settings, { configDir });
      await saveNotificationSecrets({ telegramBotToken: "123456:ABCtoken", telegramChatId: "-100123456789" }, { configDir });

      const telegramSender = vi.fn().mockResolvedValue(undefined);
      const macSender = vi.fn().mockResolvedValue({ ok: true });
      const notification = createNotification({ id: "same-id" });

      const telegramSummary = await dispatchTelegramHumanInterventionNotifications([notification], {
        configDir,
        sender: telegramSender,
      });

      const macSummary = await dispatchMacOSHumanInterventionNotifications([notification], {
        configDir,
        sender: macSender,
      });

      expect(telegramSummary.sent).toBe(1);
      expect(macSummary.sent).toBe(1);
      expect(telegramSender).toHaveBeenCalledTimes(1);
      expect(macSender).toHaveBeenCalledTimes(1);

      const db = new Database(getNotificationDeliveryLogPath({ configDir }), { readonly: true });
      try {
        const telegramKey = makeDeliveryKey({
          channel: "telegram",
          notificationId: "same-id",
          projectSlug: "aipanel",
          sessionId: "session-1",
          ruleId: "human-intervention",
        });
        const macosKey = makeDeliveryKey({
          channel: "macos",
          notificationId: "same-id",
          projectSlug: "aipanel",
          sessionId: "session-1",
          ruleId: "human-intervention",
        });

        expect(telegramKey).not.toBe(macosKey);

        const rows = db.prepare("select id, channel, status from notification_delivery_log where id in (?, ?)").all(telegramKey, macosKey) as Array<{ id: string; channel: string; status: string }>;
        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.id === telegramKey)?.channel).toBe("telegram");
        expect(rows.find((row) => row.id === macosKey)?.channel).toBe("macos");
      } finally {
        db.close();
      }
    });
  });

  it("continues after one sender failure", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledMacOS(configDir);
      const sender = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: "send failed /tmp/secret/path" })
        .mockResolvedValueOnce({ ok: true });

      const summary = await dispatchMacOSHumanInterventionNotifications(
        [createNotification({ id: "fail" }), createNotification({ id: "pass", sessionId: "session-2" })],
        { configDir, sender },
      );

      expect(sender).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({ considered: 2, eligible: 2, sent: 1, skipped: 0, failed: 1 });
    });
  });

  it("treats sender skipped results as skipped", async () => {
    await withTempConfigDir(async (configDir) => {
      await setupEnabledMacOS(configDir);
      const sender = vi.fn().mockResolvedValue({ ok: false, skipped: true, reason: "unsupported-os" });

      const summary = await dispatchMacOSHumanInterventionNotifications([createNotification({ id: "q", kind: "question", status: undefined })], {
        configDir,
        sender,
      });

      expect(summary).toEqual({ considered: 1, eligible: 1, sent: 0, skipped: 1, failed: 0 });
    });
  });
});
