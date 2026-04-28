import { afterEach, describe, expect, it } from "vitest";
import { guardLocalWrite } from "@/lib/api/local-write-guard";

const originalAllowedOrigins = process.env.AIPANEL_ALLOWED_DEV_ORIGINS;
const originalWriteToken = process.env.AIPANEL_WRITE_TOKEN;

afterEach(() => {
  if (originalAllowedOrigins === undefined) {
    delete process.env.AIPANEL_ALLOWED_DEV_ORIGINS;
  } else {
    process.env.AIPANEL_ALLOWED_DEV_ORIGINS = originalAllowedOrigins;
  }

  if (originalWriteToken === undefined) {
    delete process.env.AIPANEL_WRITE_TOKEN;
  } else {
    process.env.AIPANEL_WRITE_TOKEN = originalWriteToken;
  }
});

function createRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  return new Request(url, {
    method: init.method ?? "PUT",
    body: init.body,
    headers,
  });
}

describe("guardLocalWrite", () => {
  it("allows non-mutating methods", () => {
    const request = createRequest("http://localhost/api/notification-settings", {
      method: "GET",
    });

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });

  it("allows same-origin localhost", () => {
    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: { origin: "http://localhost:3000" },
    });

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });

  it("allows same-origin 127.0.0.1", () => {
    const request = createRequest("http://127.0.0.1:3107/api/notification-settings", {
      headers: { origin: "http://127.0.0.1:3107" },
    });

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });

  it("allows same-origin ::1", () => {
    const request = createRequest("http://[::1]:3000/api/notification-settings", {
      headers: { origin: "http://[::1]:3000" },
    });

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });

  it("allows configured dev origin", () => {
    process.env.AIPANEL_ALLOWED_DEV_ORIGINS = "https://trusted.dev.local,100.89.42.77";

    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: { origin: "https://trusted.dev.local" },
    });

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });

  it("rejects unknown cross-origin", async () => {
    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: { origin: "https://evil.example" },
    });

    const denied = guardLocalWrite(request);
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects cross-site sec-fetch-site", async () => {
    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: {
        origin: "http://localhost:3000",
        "sec-fetch-site": "cross-site",
      },
    });

    const denied = guardLocalWrite(request);
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("allows same-origin sec-fetch-site", () => {
    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: {
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      },
    });

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });

  it("allows missing origin for localhost host", () => {
    const request = createRequest("http://localhost:3000/api/notification-settings");

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });

  it("rejects missing origin for non-local host", async () => {
    const request = createRequest("http://example.com/api/notification-settings");

    const denied = guardLocalWrite(request);
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("requires application/json when route opts in", async () => {
    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({ enabled: true }),
    });

    const denied = guardLocalWrite(request, { requireJson: true });
    expect(denied?.status).toBe(415);
    await expect(denied?.json()).resolves.toEqual({ error: "Unsupported Media Type" });
  });

  it("accepts application/json with charset when required", () => {
    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ enabled: true }),
    });

    const denied = guardLocalWrite(request, { requireJson: true });
    expect(denied).toBeNull();
  });

  it("requires write token when configured and rejects missing token", async () => {
    process.env.AIPANEL_WRITE_TOKEN = "very-secret-write-token";

    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: { origin: "http://localhost:3000" },
    });

    const denied = guardLocalWrite(request);
    expect(denied?.status).toBe(401);
    const body = await denied?.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(JSON.stringify(body)).not.toContain("very-secret-write-token");
  });

  it("rejects wrong write token", async () => {
    process.env.AIPANEL_WRITE_TOKEN = "very-secret-write-token";

    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: {
        origin: "http://localhost:3000",
        "x-aipanel-write-token": "wrong-token",
      },
    });

    const denied = guardLocalWrite(request);
    expect(denied?.status).toBe(401);
    const body = await denied?.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(JSON.stringify(body)).not.toContain("very-secret-write-token");
  });

  it("allows correct write token", () => {
    process.env.AIPANEL_WRITE_TOKEN = "very-secret-write-token";

    const request = createRequest("http://localhost:3000/api/notification-settings", {
      headers: {
        origin: "http://localhost:3000",
        "x-aipanel-write-token": "very-secret-write-token",
      },
    });

    const denied = guardLocalWrite(request);
    expect(denied).toBeNull();
  });
});
