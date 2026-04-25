import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { notificationSettingsSchema } from "@/lib/notifications/schema";
import { loadNotificationSettings, saveNotificationSettings } from "@/lib/notifications/settings";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  return NextResponse.json(await loadNotificationSettings());
}

export async function PUT(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = notificationSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid notification settings");
  }

  try {
    await saveNotificationSettings(parsed.data);
  } catch (error) {
    if (error instanceof ZodError) {
      return badRequest("Invalid notification settings");
    }

    return NextResponse.json({ error: "Unable to save notification settings" }, { status: 500 });
  }

  return NextResponse.json(parsed.data);
}
