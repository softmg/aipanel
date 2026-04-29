import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_NOTIFICATION_DEDUPE_WINDOW_MS,
  getNotificationDeliveryLogPath,
  hasRecentSuccessfulSemanticDelivery,
  hasSuccessfulDelivery,
  makeDeliveryKey,
  makeSemanticDeliveryKey,
  recordDeliveryAttempt,
  recordDeliveryFailure,
  recordDeliverySuccess,
} from "@/lib/notifications/delivery-log";

type DeliveryInput = {
  channel: "telegram" | "macos";
  notificationId: string;
  projectSlug?: string;
  sessionId?: string;
  ruleId?: string;
  semanticKey?: string;
  now?: Date;
};

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-delivery-log-"));

  try {
    await run(configDir);
  } finally {
    await fs.rm(configDir, { recursive: true, force: true });
  }
}

function baseInput(overrides: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    channel: "telegram",
    notificationId: "notification-1",
    projectSlug: "aipanel",
    sessionId: "session-1",
    ruleId: "task-completion",
    semanticKey: makeSemanticDeliveryKey({
      channel: "telegram",
      projectSlug: "aipanel",
      sessionId: "session-1",
      kind: "task",
      status: "completed",
      title: "Build finished",
      details: "Status: completed",
    }),
    ...overrides,
  };
}

describe("notification delivery log", () => {
  it("initializes database in temp config dir", async () => {
    await withTempConfigDir(async (configDir) => {
      const input = baseInput();
      recordDeliveryAttempt(input, { configDir });

      const dbPath = getNotificationDeliveryLogPath({ configDir });
      expect(await fs.stat(dbPath)).toBeTruthy();

      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db
          .prepare("select name from sqlite_master where type = 'table' and name = 'notification_delivery_log'")
          .get() as { name?: string } | undefined;
        expect(row?.name).toBe("notification_delivery_log");
      } finally {
        db.close();
      }
    });
  });

  it("success makes hasSuccessfulDelivery true", async () => {
    await withTempConfigDir(async (configDir) => {
      const input = baseInput();
      recordDeliveryAttempt(input, { configDir });
      recordDeliverySuccess(input, { configDir });

      expect(hasSuccessfulDelivery(input, { configDir })).toBe(true);
    });
  });

  it("failure does not count as success", async () => {
    await withTempConfigDir(async (configDir) => {
      const input = baseInput();
      recordDeliveryAttempt(input, { configDir });
      recordDeliveryFailure(input, new Error("network failure"), { configDir });

      expect(hasSuccessfulDelivery(input, { configDir })).toBe(false);
    });
  });

  it("delivery key is stable", () => {
    const input = baseInput();
    expect(makeDeliveryKey(input)).toBe(makeDeliveryKey(input));
  });

  it("different notification/session/channel creates different key", () => {
    const base = makeDeliveryKey(baseInput());
    expect(makeDeliveryKey(baseInput({ notificationId: "notification-2" }))).not.toBe(base);
    expect(makeDeliveryKey(baseInput({ sessionId: "session-2" }))).not.toBe(base);
    expect(makeDeliveryKey(baseInput({ channel: "macos" }))).not.toBe(base);
    expect(makeDeliveryKey(baseInput({ ruleId: "other-rule" }))).not.toBe(base);
  });

  it("recent semantic success is detected within the 5-second window", async () => {
    await withTempConfigDir(async (configDir) => {
      const now = new Date("2026-04-29T16:00:00.000Z");
      const input = baseInput({ now });
      recordDeliveryAttempt(input, { configDir });
      recordDeliverySuccess(input, { configDir });

      expect(
        hasRecentSuccessfulSemanticDelivery(
          {
            semanticKey: input.semanticKey ?? "",
            now: new Date(now.getTime() + EXTERNAL_NOTIFICATION_DEDUPE_WINDOW_MS - 1),
            windowMs: EXTERNAL_NOTIFICATION_DEDUPE_WINDOW_MS,
          },
          { configDir },
        ),
      ).toBe(true);
    });
  });

  it("recent semantic success expires after the 5-second window", async () => {
    await withTempConfigDir(async (configDir) => {
      const now = new Date("2026-04-29T16:00:00.000Z");
      const input = baseInput({ now });
      recordDeliveryAttempt(input, { configDir });
      recordDeliverySuccess(input, { configDir });

      expect(
        hasRecentSuccessfulSemanticDelivery(
          {
            semanticKey: input.semanticKey ?? "",
            now: new Date(now.getTime() + EXTERNAL_NOTIFICATION_DEDUPE_WINDOW_MS + 1),
            windowMs: EXTERNAL_NOTIFICATION_DEDUPE_WINDOW_MS,
          },
          { configDir },
        ),
      ).toBe(false);
    });
  });

  it("stored error is sanitized and does not store token", async () => {
    await withTempConfigDir(async (configDir) => {
      const input = baseInput();
      recordDeliveryAttempt(input, { configDir });
      recordDeliveryFailure(
        input,
        new Error("Telegram notification request failed (401): bad token 123456:ABCtoken /bot123456:ABCtoken/sendMessage"),
        { configDir },
      );

      const db = new Database(getNotificationDeliveryLogPath({ configDir }), { readonly: true });
      try {
        const row = db
          .prepare("select error from notification_delivery_log where id = ?")
          .get(makeDeliveryKey(input)) as { error?: string } | undefined;

        expect(row?.error).toBeTruthy();
        expect(row?.error).not.toContain("123456:ABCtoken");
        expect(row?.error).not.toContain("/bot123456:ABCtoken/");
      } finally {
        db.close();
      }
    });
  });
});
