import { describe, expect, it } from "vitest";
import { listTasksForProject } from "@/lib/sources/beads";

describe("beads adapter", () => {
  it("returns array even when project has no beads issues", async () => {
    const tasks = await listTasksForProject("/tmp/non-existent-project-for-aipanel");
    expect(Array.isArray(tasks)).toBe(true);
  });
});
