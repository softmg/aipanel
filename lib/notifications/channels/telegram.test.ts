import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";
import {
  escapeTelegramHtml,
  formatTelegramNotification,
  redactTelegramNotificationText,
  sendTelegramNotification,
} from "@/lib/notifications/channels/telegram";

function createNotification(overrides: Partial<ClaudeNotification> = {}): ClaudeNotification {
  return {
    id: "notification-1",
    sessionId: "session-1",
    sessionLabel: "Refactor notifications",
    projectSlug: "aipanel",
    projectLabel: "aipanel",
    createdAt: "2026-04-26T12:00:00.000Z",
    kind: "permission",
    title: "Permission request",
    details: "Claude wants permission to run a tool.",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("telegram formatter helpers", () => {
  it("escapes HTML-sensitive characters", () => {
    expect(escapeTelegramHtml("<tag> & \"quotes\" 'single'"))
      .toBe("&lt;tag&gt; &amp; &quot;quotes&quot; &#39;single&#39;");
  });

  it("redacts secret-like text", () => {
    const input = "TOKEN=abcd API_KEY=qwerty password=secret Authorization: Bearer token sk-abc1234567890";
    const redacted = redactTelegramNotificationText(input);

    expect(redacted).not.toContain("TOKEN=abcd");
    expect(redacted).not.toContain("API_KEY=qwerty");
    expect(redacted).not.toContain("password=secret");
    expect(redacted).not.toContain("Authorization: Bearer token");
    expect(redacted).not.toContain("sk-abc1234567890");
    expect(redacted).toContain("[redacted]");
  });

  it("includes heading, kind, project, session, title, details and link", () => {
    const message = formatTelegramNotification(createNotification(), {
      localhostUrl: "http://localhost:3000/projects/aipanel",
    });

    expect(message).toContain("<b>aipanel</b>");
    expect(message).toContain("Permission request");
    expect(message).toContain("Project: aipanel");
    expect(message).toContain("Session: Refactor notifications");
    expect(message).toContain("Kind: permission");
    expect(message).toContain("Claude wants permission to run a tool.");
    expect(message).toContain("Open: http://localhost:3000/projects/aipanel");
  });

  it("handles missing optional fields without crashing", () => {
    const message = formatTelegramNotification(
      createNotification({ projectLabel: undefined, projectSlug: undefined, details: undefined }),
    );

    expect(message).toContain("<b>aipanel</b>");
    expect(message).toContain("Session: Refactor notifications");
    expect(message).toContain("Kind: permission");
    expect(message).not.toContain("Project:");
  });

  it("truncates long details and appends ellipsis", () => {
    const message = formatTelegramNotification(
      createNotification({ details: `secret ${"x".repeat(5000)}` }),
    );

    expect(message.length).toBeLessThanOrEqual(3500);
    expect(message).toContain("…");
  });
});

describe("sendTelegramNotification", () => {
  it("calls fetch with expected endpoint and body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await sendTelegramNotification(createNotification(), {
      botToken: "123456:ABCtoken",
      chatId: "-100123456789",
      baseUrl: "https://api.telegram.org",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.telegram.org/bot123456:ABCtoken/sendMessage");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      chat_id: "-100123456789",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    expect(typeof body.text).toBe("string");
    expect(body.text).toContain("<b>aipanel</b>");
  });

  it("throws sanitized error without token on non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad token 123456:ABCtoken /bot123456:ABCtoken/sendMessage", { status: 401 }),
    );

    await expect(
      sendTelegramNotification(createNotification(), {
        botToken: "123456:ABCtoken",
        chatId: "-100123456789",
      }),
    ).rejects.toThrow(/Telegram notification request failed \(401\)/);

    await sendTelegramNotification(createNotification(), {
      botToken: "123456:ABCtoken",
      chatId: "-100123456789",
    }).catch((error) => {
      expect(String(error)).not.toContain("123456:ABCtoken");
      expect(String(error)).not.toContain("/bot123456:ABCtoken/");
    });
  });

  it("resolves on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(
      sendTelegramNotification(createNotification(), {
        botToken: "123456:ABCtoken",
        chatId: "-100123456789",
      }),
    ).resolves.toBeUndefined();
  });
});
