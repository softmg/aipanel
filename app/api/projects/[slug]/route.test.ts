import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/projects/[slug]/route";

describe("GET /api/projects/[slug]", () => {
  it("returns 400 for invalid slug", async () => {
    const response = await GET(new Request("http://localhost/api/projects/invalid_slug"), {
      params: Promise.resolve({ slug: "invalid_slug" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid slug" });
  });

  it("returns 404 when project is missing", async () => {
    const response = await GET(new Request("http://localhost/api/projects/missing"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Project not found" });
  });
});
