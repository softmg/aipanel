import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/refresh/route";

describe("POST /api/refresh", () => {
  it("returns refreshed timestamp", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.refreshedAt).toBe("string");
    expect(Number.isNaN(new Date(body.refreshedAt).valueOf())).toBe(false);
  });
});
