import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/projects/[slug]/tasks/[taskId]/route";

describe("GET /api/projects/[slug]/tasks/[taskId]", () => {
  it("returns 400 for invalid slug", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/Bad_Slug/tasks/aipanel-3ou"),
      {
        params: Promise.resolve({ slug: "Bad_Slug", taskId: "aipanel-3ou" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid params" });
  });

  it("returns 400 for invalid task id", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/valid/tasks/not%20a%20task"),
      {
        params: Promise.resolve({ slug: "valid", taskId: "not a task" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid params" });
  });

  it("returns 404 when project/task is missing", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/missing/tasks/aipanel-000"),
      {
        params: Promise.resolve({ slug: "missing", taskId: "aipanel-000" }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Task not found" });
  });
});
