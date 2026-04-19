import { describe, expect, it } from "vitest";
import { getTaskDetailForProject, listTasksForProject } from "@/lib/sources/beads";

describe("beads adapter", () => {
  it("returns array even when project has no beads issues", async () => {
    const tasks = await listTasksForProject("/tmp/non-existent-project-for-aipanel");
    expect(Array.isArray(tasks)).toBe(true);
  });

  it("returns null for malformed task id", async () => {
    const detail = await getTaskDetailForProject(process.cwd(), "not a real id");
    expect(detail).toBeNull();
  });

  it("returns null for missing project path", async () => {
    const detail = await getTaskDetailForProject(
      "/tmp/non-existent-project-for-aipanel",
      "aipanel-000",
    );
    expect(detail).toBeNull();
  });
});
