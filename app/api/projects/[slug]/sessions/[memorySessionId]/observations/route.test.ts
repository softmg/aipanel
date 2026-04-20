import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/projects/[slug]/sessions/[memorySessionId]/observations/route";

vi.mock("@/lib/services/aggregator", () => ({
  getProjectSessionObservations: vi.fn(),
}));

describe("GET /api/projects/[slug]/sessions/[memorySessionId]/observations", () => {
  it("returns 400 for invalid params", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/Bad_Slug/sessions/mem_1/observations"),
      {
        params: Promise.resolve({ slug: "Bad_Slug", memorySessionId: "mem_1" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid params" });
  });

  it("returns 404 when session is missing or not in project", async () => {
    const { getProjectSessionObservations } = await import("@/lib/services/aggregator");
    vi.mocked(getProjectSessionObservations).mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/projects/demo/sessions/mem_1/observations"),
      {
        params: Promise.resolve({ slug: "demo", memorySessionId: "mem_1" }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });
  });

  it("returns observations for valid project session", async () => {
    const { getProjectSessionObservations } = await import("@/lib/services/aggregator");
    vi.mocked(getProjectSessionObservations).mockResolvedValue([
      {
        id: 1,
        type: "feature",
        title: "Added API",
        subtitle: null,
        narrative: null,
        facts: null,
        concepts: null,
        filesRead: null,
        filesModified: null,
        promptNumber: 1,
        createdAt: "2026-04-20T12:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/projects/demo/sessions/mem_1/observations"),
      {
        params: Promise.resolve({ slug: "demo", memorySessionId: "mem_1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: 1,
        type: "feature",
        title: "Added API",
        subtitle: null,
        narrative: null,
        facts: null,
        concepts: null,
        filesRead: null,
        filesModified: null,
        promptNumber: 1,
        createdAt: "2026-04-20T12:00:00.000Z",
      },
    ]);
  });
});
