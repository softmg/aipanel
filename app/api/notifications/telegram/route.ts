import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import {
  getTelegramSafeStatus,
  loadNotificationSecrets,
  saveNotificationSecrets,
} from "@/lib/notifications/secrets";

const putTelegramSchema = z
  .object({
    botToken: z.string().trim().min(1),
    chatId: z.string().trim().min(1),
  })
  .strict();

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function internalError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const secrets = await loadNotificationSecrets();
    return NextResponse.json(getTelegramSafeStatus(secrets));
  } catch {
    return internalError("Unable to load Telegram settings");
  }
}

export async function PUT(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = putTelegramSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid Telegram settings");
  }

  try {
    await saveNotificationSecrets({
      telegramBotToken: parsed.data.botToken,
      telegramChatId: parsed.data.chatId,
    });
    const secrets = await loadNotificationSecrets();
    return NextResponse.json(getTelegramSafeStatus(secrets));
  } catch (error) {
    if (error instanceof ZodError) {
      return badRequest("Invalid Telegram settings");
    }

    return internalError("Unable to save Telegram settings");
  }
}
