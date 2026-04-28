import { NextResponse } from "next/server";
import { sendTelegramNotification } from "@/lib/notifications/channels/telegram";
import { loadNotificationSecrets } from "@/lib/notifications/secrets";
import { guardLocalWrite } from "@/lib/api/local-write-guard";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isSanitizedErrorMessage(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Telegram notification request failed") ||
    error.message.includes("Unable to send Telegram notification.");
}

function createTestNotification(): ClaudeNotification {
  return {
    id: `telegram-test-${Date.now()}`,
    sessionId: "telegram-test-session",
    sessionLabel: "Telegram setup test",
    projectSlug: "aipanel",
    projectLabel: "aipanel",
    createdAt: new Date().toISOString(),
    kind: "permission",
    title: "Permission request",
    details: "Claude wants permission to run a tool.",
    status: "test",
    source: "derived",
  };
}

export async function POST(request: Request) {
  const denied = guardLocalWrite(request);
  if (denied) {
    return denied;
  }

  let secrets: Awaited<ReturnType<typeof loadNotificationSecrets>>;

  try {
    secrets = await loadNotificationSecrets();
  } catch {
    return NextResponse.json({ error: "Unable to send Telegram test message" }, { status: 500 });
  }

  const botToken = secrets.telegramBotToken?.trim();
  const chatId = secrets.telegramChatId?.trim();

  if (!botToken || !chatId) {
    return badRequest("Telegram is not configured");
  }

  try {
    await sendTelegramNotification(createTestNotification(), {
      botToken,
      chatId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isSanitizedErrorMessage(error)) {
      return NextResponse.json({ error: "Unable to send Telegram test message" }, { status: 502 });
    }

    return NextResponse.json({ error: "Unable to send Telegram test message" }, { status: 500 });
  }
}
