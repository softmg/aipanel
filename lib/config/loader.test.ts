import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProjectsConfig } from "@/lib/config/loader";

const originalCwd = process.cwd();
const originalEnv = process.env.AIPANEL_CONFIG;

async function withTempConfig(content: string, run: (configPath: string) => Promise<void>) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-loader-test-"));
  const configPath = path.join(tempRoot, "projects.json");
  await fs.writeFile(configPath, content, "utf8");
  process.env.AIPANEL_CONFIG = configPath;

  try {
    await run(configPath);
  } finally {
    delete process.env.AIPANEL_CONFIG;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

afterEach(() => {
  process.chdir(originalCwd);
  if (originalEnv) {
    process.env.AIPANEL_CONFIG = originalEnv;
  } else {
    delete process.env.AIPANEL_CONFIG;
  }
});

describe("loadProjectsConfig", () => {
  it("builds stable unique slugs when names collide", async () => {
    await withTempConfig(
      JSON.stringify({
        projects: [
          { name: "Demo", path: "/tmp/alpha" },
          { name: "Demo", path: "/tmp/beta" },
          { name: "Demo", path: "/tmp/gamma" },
          { name: "Demo", path: "/tmp/delta" },
        ],
      }),
      async () => {
        const projects = await loadProjectsConfig();

        expect(projects).toHaveLength(4);
        expect(new Set(projects.map((project) => project.slug)).size).toBe(4);
        expect(projects[0]?.slug).toBe("demo");
        expect(projects[1]?.slug).toBe("demo-beta");
      },
    );
  });

  it("deduplicates entries with the same resolved path", async () => {
    await withTempConfig(
      JSON.stringify({
        projects: [
          { name: "First", path: "/tmp/shared" },
          { name: "Second", path: "/tmp/shared" },
        ],
      }),
      async () => {
        const projects = await loadProjectsConfig();
        expect(projects).toHaveLength(1);
        expect(projects[0]?.name).toBe("First");
      },
    );
  });

  it("ignores disabled projects", async () => {
    await withTempConfig(
      JSON.stringify({
        projects: [
          { name: "Enabled", path: "/tmp/enabled" },
          { name: "Disabled", path: "/tmp/disabled", enabled: false },
        ],
      }),
      async () => {
        const projects = await loadProjectsConfig();
        expect(projects.map((project) => project.name)).toEqual(["Enabled"]);
      },
    );
  });
});
