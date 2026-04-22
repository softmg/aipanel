import { z } from "zod";
import { getProjectCards, getProjectDetail, getProjectNotifications } from "@/lib/services/aggregator";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  activeSlug: z.string().regex(/^[a-z0-9-]+$/).optional(),
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

function emitNewNotifications(
  payload: RealtimeNotificationPayload[],
  knownIds: Set<string>,
  write: (chunk: string) => void,
): Set<string> {
  const currentIds = new Set(payload.map((item) => item.id));

  if (knownIds.size > 0) {
    const newItems = payload.filter((item) => !knownIds.has(item.id));
    if (newItems.length > 0) {
      write(`event: notification\ndata: ${JSON.stringify({ items: newItems })}\n\n`);
    }
  }

  return currentIds;
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
  });

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid params" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const activeSlug = parsed.data.activeSlug;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let inFlight = false;
      let lastSignature = "";
      let lastNotificationIds = new Set<string>();

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
            lastNotificationIds = emitNewNotifications(notificationPayload, lastNotificationIds, write);
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
