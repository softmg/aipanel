import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

async function read(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("architect addendum contracts", () => {
  it("keeps tab semantics and warning accessibility in ProjectDetail", async () => {
    const source = await read("components/projects/ProjectDetail.tsx");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("Partial data loaded");
  });

  it("keeps sidebar empty state and focus-visible styles", async () => {
    const source = await read("components/projects/ProjectSidebar.tsx");
    expect(source).toContain("No projects configured");
    expect(source).toContain("focus-visible:outline");
    expect(source).toContain("aria-current");
  });

  it("keeps kanban empty-column placeholder text", async () => {
    const source = await read("components/projects/ProjectDetail.tsx");
    expect(source).toContain("No tasks");
  });
});
