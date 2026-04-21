import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

async function read(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("architect addendum contracts", () => {
  it("keeps tab semantics, warning accessibility, and title refresh action in ProjectDetail", async () => {
    const source = await read("components/projects/ProjectDetail.tsx");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("Partial data loaded");
    expect(source).toContain("Update empty titles");
    expect(source).toContain("Update empty session titles");
  });

  it("keeps sidebar empty state, focus-visible styles, and incremental loading control", async () => {
    const source = await read("components/projects/ProjectSidebar.tsx");
    expect(source).toContain("No projects configured");
    expect(source).toContain("focus-visible:outline");
    expect(source).toContain("aria-current");
    expect(source).toContain("Загрузить ещё");
  });

  it("keeps kanban empty-column placeholder text", async () => {
    const source = await read("components/projects/ProjectDetail.tsx");
    expect(source).toContain("No tasks");
  });

  it("keeps ThemeToggle hydration-safe initial render", async () => {
    const source = await read("components/layout/ThemeToggle.tsx");
    expect(source).toContain('useState<Theme>("light")');
    expect(source).toContain("useEffect");
    expect(source).not.toContain("useState<Theme>(getInitialTheme)");
  });
});
