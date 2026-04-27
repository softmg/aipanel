import { z } from "zod";
import {
  MAX_NOTIFICATION_CURSOR_ID,
  advanceNotificationCursor,
  isNotificationNewerThanCursor,
  parseRealtimeSinceParam,
  type NotificationCursor,
} from "@/lib/notifications/notification-cursor";
import { isHumanInterventionNotification } from "@/lib/notifications/human-intervention";
import { dispatchTelegramHumanInterventionNotifications } from "@/lib/notifications/telegram-human-intervention-dispatcher";
import { getProjectCards, getProjectDetail, getProjectNotifications } from "@/lib/services/aggregator";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  activeSlug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  since: z.string().optional(),
});

type RealtimeNotificationPayload = Pick<
  ClaudeNotification,
  "id" | "kind" | "title" | "createdAt" | "projectSlug" | "projectLabel" | "sessionLabel" | "status"
>;

function toRealtimeNotificationPayload(notification: ClaudeNotification): RealtimeNotificationPayload {
  return {
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    createdAt: notification.createdAt,
    projectSlug: notification.projectSlug,
    projectLabel: notification.projectLabel,
    sessionLabel: notification.sessionLabel,
    status: notification.status,
  };
}

function emitNotifications(payload: RealtimeNotificationPayload[], write: (chunk: string) => void): void {
  if (payload.length > 0) {
    write(`event: notification\ndata: ${JSON.stringify({ items: payload })}\n\n`);
  }
}

function buildSignature(
  cards: Awaited<ReturnType<typeof getProjectCards>>,
  detail: Awaited<ReturnType<typeof getProjectDetail>>,
): string {
  return JSON.stringify({
    cards: cards.map((project) => ({
      slug: project.slug,
      lastActivityAt: project.lastActivityAt,
      sessionCount: project.sessionCount,
      totalInputTokens: project.totalInputTokens,
      totalOutputTokens: project.totalOutputTokens,
      totalCacheReadTokens: project.totalCacheReadTokens,
      usageSplit: project.usageSplit,
      beadsCounts: project.beadsCounts,
    })),
    detail: detail
      ? {
          slug: detail.project.slug,
          warnings: detail.warnings,
          sessions: detail.sessions.map((session) => ({
            id: session.sessionId,
            lastActivityAt: session.lastActivityAt,
            title: session.title,
            usageSplit: session.usageSplit,
            cacheReadTokens: session.usage.cacheReadTokens,
            userPromptCount: session.userPromptCount,
          })),
          beads: detail.beads.map((task) => ({
            id: task.id,
            status: task.status,
            title: task.title,
            priority: task.priority,
            type: task.type,
            updatedAt: task.updated_at,
          })),
        }
      : null,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = searchSchema.safeParse({
    activeSlug: url.searchParams.get("activeSlug") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
  });

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid params" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const activeSlug = parsed.data.activeSlug;
  const sinceMs = parseRealtimeSinceParam(parsed.data.since ?? null);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let inFlight = false;
      let lastSignature = "";
      let notificationCursor: NotificationCursor | null =
        sinceMs === null ? null : { createdAtMs: sinceMs, id: MAX_NOTIFICATION_CURSOR_ID };
      let notificationCursorSeeded = sinceMs !== null;

      const write = (chunk: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(chunk));
        }
      };

      const tick = async () => {
        if (closed || inFlight) {
          return;
        }

        inFlight = true;
        try {
          const [cards, detail, notifications] = await Promise.all([
            getProjectCards({ includeBeads: true }),
            activeSlug ? getProjectDetail(activeSlug) : Promise.resolve(null),
            activeSlug ? getProjectNotifications(activeSlug) : Promise.resolve([]),
          ]);

          const notificationPayload = notifications.map(toRealtimeNotificationPayload);
          const signature = buildSignature(cards, detail) + JSON.stringify(notificationPayload);

          if (activeSlug) {
            const newNotifications = notificationCursorSeeded && notificationCursor
              ? notifications.filter((notification) =>
                isNotificationNewerThanCursor(notification, notificationCursor as NotificationCursor),
              )
              : [];

            emitNotifications(newNotifications.map(toRealtimeNotificationPayload), write);

            const humanInterventionNotifications = newNotifications.filter(isHumanInterventionNotification);
            if (humanInterventionNotifications.length > 0) {
              void dispatchTelegramHumanInterventionNotifications(humanInterventionNotifications).catch(() => undefined);
            }

            notificationCursor = advanceNotificationCursor(notificationCursor, notifications);
            notificationCursorSeeded = true;
          }

          if (lastSignature && signature !== lastSignature) {
            write(`event: update\ndata: ${JSON.stringify({ updatedAt: new Date().toISOString() })}\n\n`);
          } else if (!lastSignature) {
            write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
          }

          lastSignature = signature;
        } catch {
          write(`event: error\ndata: ${JSON.stringify({ message: "realtime-check-failed" })}\n\n`);
        } finally {
          inFlight = false;
        }
      };

      const interval = setInterval(() => {
        void tick();
      }, 3000);

      write(": connected\n\n");
      void tick();

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
