import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/realtime/route";
import {
  advanceNotificationCursor,
  compareNotificationCursor,
  getNotificationCursor,
  isNotificationNewerThanCursor,
  parseRealtimeSinceParam,
} from "@/app/api/realtime/notification-cursor";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

vi.mock("@/lib/services/aggregator", () => ({
  getProjectCards: vi.fn(),
  getProjectDetail: vi.fn(),
  getProjectNotifications: vi.fn(),
}));

vi.mock("@/lib/notifications/telegram-task-dispatcher", () => ({
  dispatchTelegramTaskCompletionNotifications: vi.fn().mockResolvedValue({
    considered: 0,
    eligible: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  }),
}));

const aggregator = vi.mocked(await import("@/lib/services/aggregator"));
const telegramDispatcher = vi.mocked(await import("@/lib/notifications/telegram-task-dispatcher"));

type SseEvent = {
  event: string;
  data: unknown;
};

function createNotification(id: string, createdAt: string): ClaudeNotification {
  return {
    id,
    sessionId: "session-1",
    sessionLabel: "session · session-1",
    projectSlug: "aipanel",
    projectLabel: "aipanel",
    createdAt,
    kind: "permission",
    title: `Notification ${id}`,
  };
}

function setupRealtimeMocks(notificationBatches: ClaudeNotification[][]) {
  let batchIndex = 0;
  aggregator.getProjectCards.mockResolvedValue([]);
  aggregator.getProjectDetail.mockResolvedValue(null);
  aggregator.getProjectNotifications.mockImplementation(async () => {
    const batch = notificationBatches[Math.min(batchIndex, notificationBatches.length - 1)] ?? [];
    batchIndex += 1;
    return batch;
  });
}

async function openRealtime(url: string) {
  const abortController = new AbortController();
  const response = await GET(new Request(url, { signal: abortController.signal }));
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("missing response body");
  }
  const decoder = new TextDecoder();

  return {
    response,
    abortController,
    async readChunk() {
      const result = await reader.read();
      return result.done ? "" : decoder.decode(result.value);
    },
    async close() {
      abortController.abort();
      await reader.cancel().catch(() => undefined);
    },
  };
}

function parseSseEvents(chunk: string): SseEvent[] {
  return chunk
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("event:"))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
      const data = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim();
      return {
        event: event ?? "",
        data: data ? JSON.parse(data) : null,
      };
    });
}

async function readEvents(stream: Awaited<ReturnType<typeof openRealtime>>): Promise<SseEvent[]> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const events = parseSseEvents(await stream.readChunk());
    if (events.length > 0) {
      return events;
    }
  }

  return [];
}

describe("GET /api/realtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    telegramDispatcher.dispatchTelegramTaskCompletionNotifications.mockResolvedValue({
      considered: 0,
      eligible: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("returns 400 for invalid active slug", async () => {
    const response = await GET(new Request("http://localhost/api/realtime?activeSlug=bad_slug"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid params" });
  });

  it("returns SSE stream headers for valid request", async () => {
    setupRealtimeMocks([[]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel");

    try {
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get("Content-Type")).toContain("text/event-stream");
      expect(stream.response.headers.get("Cache-Control")).toContain("no-cache");
    } finally {
      await stream.close();
    }
  });

  it("does not emit first-tick notification spam when since is absent", async () => {
    setupRealtimeMocks([[createNotification("old", "2026-04-25T10:00:00.000Z")]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel");

    try {
      const events = await readEvents(stream);
      expect(events.map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).not.toHaveBeenCalled();
    } finally {
      await stream.close();
    }
  });

  it("treats invalid since like absent since", async () => {
    setupRealtimeMocks([[createNotification("old", "2026-04-25T10:00:00.000Z")]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel&since=not-a-date");

    try {
      const events = await readEvents(stream);
      expect(events.map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).not.toHaveBeenCalled();
    } finally {
      await stream.close();
    }
  });

  it("emits first-tick notifications newer than a valid since timestamp", async () => {
    setupRealtimeMocks([
      [
        createNotification("new", "2026-04-25T10:00:01.000Z"),
        createNotification("old", "2026-04-25T09:59:59.000Z"),
      ],
    ]);
    const stream = await openRealtime(
      "http://localhost/api/realtime?activeSlug=aipanel&since=2026-04-25T10:00:00.000Z",
    );

    try {
      const notificationEvents = await readEvents(stream);
      const readyEvents = await readEvents(stream);
      expect(notificationEvents.map((event) => event.event)).toEqual(["notification"]);
      expect(readyEvents.map((event) => event.event)).toEqual(["ready"]);
      expect(notificationEvents[0]?.data).toEqual({
        items: [
          {
            id: "new",
            kind: "permission",
            title: "Notification new",
            createdAt: "2026-04-25T10:00:01.000Z",
            projectSlug: "aipanel",
            projectLabel: "aipanel",
            sessionLabel: "session · session-1",
          },
        ],
      });
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledTimes(1);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledWith([
        expect.objectContaining({ id: "new" }),
      ]);
    } finally {
      await stream.close();
    }
  });

  it("suppresses first-tick notifications older than or equal to a valid since timestamp", async () => {
    setupRealtimeMocks([
      [
        createNotification("equal", "2026-04-25T10:00:00.000Z"),
        createNotification("old", "2026-04-25T09:59:59.000Z"),
      ],
    ]);
    const stream = await openRealtime(
      "http://localhost/api/realtime?activeSlug=aipanel&since=2026-04-25T10:00:00.000Z",
    );

    try {
      const events = await readEvents(stream);
      expect(events.map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).not.toHaveBeenCalled();
    } finally {
      await stream.close();
    }
  });

  it("emits newer notifications on subsequent ticks", async () => {
    vi.useFakeTimers();
    setupRealtimeMocks([
      [createNotification("old", "2026-04-25T10:00:00.000Z")],
      [
        createNotification("new", "2026-04-25T10:00:01.000Z"),
        createNotification("old", "2026-04-25T10:00:00.000Z"),
      ],
    ]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel");

    try {
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["ready"]);
      await vi.advanceTimersByTimeAsync(3000);
      const notificationEvents = await readEvents(stream);
      const updateEvents = await readEvents(stream);
      expect(notificationEvents.map((event) => event.event)).toEqual(["notification"]);
      expect(updateEvents.map((event) => event.event)).toEqual(["update"]);
      expect(notificationEvents[0]?.data).toMatchObject({ items: [{ id: "new" }] });
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledTimes(1);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledWith([
        expect.objectContaining({ id: "new" }),
      ]);
    } finally {
      await stream.close();
      vi.useRealTimers();
    }
  });

  it("does not re-emit older or reordered notifications on subsequent ticks", async () => {
    vi.useFakeTimers();
    setupRealtimeMocks([
      [createNotification("newest", "2026-04-25T10:00:02.000Z")],
      [
        createNotification("older", "2026-04-25T10:00:01.000Z"),
        createNotification("newest", "2026-04-25T10:00:02.000Z"),
      ],
    ]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel");

    try {
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["ready"]);
      await vi.advanceTimersByTimeAsync(3000);
      const events = await readEvents(stream);
      expect(events.map((event) => event.event)).toEqual(["update"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).not.toHaveBeenCalled();
    } finally {
      await stream.close();
      vi.useRealTimers();
    }
  });

  it("invokes Telegram dispatcher for new task-completion notifications", async () => {
    const taskNotification = createNotification("task-complete", "2026-04-25T10:00:01.000Z");
    taskNotification.kind = "task";
    taskNotification.status = "completed";
    taskNotification.title = "Build finished";

    setupRealtimeMocks([[taskNotification]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel&since=2026-04-25T10:00:00.000Z");

    try {
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["notification"]);
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledTimes(1);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledWith([
        expect.objectContaining({ id: "task-complete", kind: "task", status: "completed" }),
      ]);
    } finally {
      await stream.close();
    }
  });

  it("does not dispatch Telegram for permission notification when no new items are emitted", async () => {
    setupRealtimeMocks([[createNotification("permission-old", "2026-04-25T10:00:00.000Z")]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel&since=2026-04-25T10:00:00.000Z");

    try {
      const events = await readEvents(stream);
      expect(events.map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).not.toHaveBeenCalled();
    } finally {
      await stream.close();
    }
  });

  it("keeps SSE notification events when Telegram dispatcher fails", async () => {
    telegramDispatcher.dispatchTelegramTaskCompletionNotifications.mockRejectedValueOnce(new Error("dispatch failed"));

    setupRealtimeMocks([[createNotification("new", "2026-04-25T10:00:01.000Z")]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel&since=2026-04-25T10:00:00.000Z");

    try {
      const notificationEvents = await readEvents(stream);
      const readyEvents = await readEvents(stream);
      expect(notificationEvents.map((event) => event.event)).toEqual(["notification"]);
      expect(readyEvents.map((event) => event.event)).toEqual(["ready"]);
      expect(notificationEvents[0]?.data).toMatchObject({ items: [{ id: "new" }] });
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledTimes(1);
    } finally {
      await stream.close();
    }
  });

  it("dispatches only notifications newer than valid since baseline", async () => {
    setupRealtimeMocks([
      [
        createNotification("new-1", "2026-04-25T10:00:02.000Z"),
        createNotification("old-1", "2026-04-25T09:59:59.000Z"),
      ],
    ]);

    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel&since=2026-04-25T10:00:00.000Z");

    try {
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["notification"]);
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledTimes(1);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).toHaveBeenCalledWith([
        expect.objectContaining({ id: "new-1" }),
      ]);
    } finally {
      await stream.close();
    }
  });

  it("does not dispatch historical notifications on first load when since is invalid", async () => {
    setupRealtimeMocks([[createNotification("historical", "2026-04-25T10:00:00.000Z")]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel&since=invalid");

    try {
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).not.toHaveBeenCalled();
    } finally {
      await stream.close();
    }
  });

  it("does not dispatch historical notifications on first load when since is absent", async () => {
    setupRealtimeMocks([[createNotification("historical", "2026-04-25T10:00:00.000Z")]]);
    const stream = await openRealtime("http://localhost/api/realtime?activeSlug=aipanel");

    try {
      expect((await readEvents(stream)).map((event) => event.event)).toEqual(["ready"]);
      expect(telegramDispatcher.dispatchTelegramTaskCompletionNotifications).not.toHaveBeenCalled();
    } finally {
      await stream.close();
    }
  });

});

describe("realtime notification cursor helpers", () => {
  it("parses ISO timestamps and epoch milliseconds", () => {
    expect(parseRealtimeSinceParam("2026-04-25T10:00:00.000Z")).toBe(
      new Date("2026-04-25T10:00:00.000Z").valueOf(),
    );
    expect(parseRealtimeSinceParam("1777111200000")).toBe(1777111200000);
    expect(parseRealtimeSinceParam("not-a-date")).toBeNull();
  });

  it("orders notifications with createdAt and id tie-breakers", () => {
    const left = getNotificationCursor(createNotification("a", "2026-04-25T10:00:00.000Z"));
    const right = getNotificationCursor(createNotification("b", "2026-04-25T10:00:00.000Z"));

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(compareNotificationCursor(left!, right!)).toBeLessThan(0);
    expect(isNotificationNewerThanCursor(createNotification("b", "2026-04-25T10:00:00.000Z"), left!)).toBe(
      true,
    );
  });

  it("does not treat the same notification cursor as new after advancing", () => {
    const notification = createNotification("same", "2026-04-25T10:00:01.000Z");
    const cursor = advanceNotificationCursor(null, [notification]);

    expect(cursor).not.toBeNull();
    expect(isNotificationNewerThanCursor(notification, cursor!)).toBe(false);
  });
});
