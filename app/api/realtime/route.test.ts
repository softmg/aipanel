import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/realtime/route";

vi.mock("@/lib/services/aggregator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/aggregator")>("@/lib/services/aggregator");
  return {
    ...actual,
    getProjectNotifications: vi.fn().mockResolvedValue([]),
  };
});

describe("GET /api/realtime", () => {
  it("returns 400 for invalid active slug", async () => {
    const response = await GET(new Request("http://localhost/api/realtime?activeSlug=bad_slug"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid params" });
  });

  it("returns SSE stream headers for valid request", async () => {
    const response = await GET(new Request("http://localhost/api/realtime?activeSlug=aipanel"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
    await response.body?.cancel();
  });
});
