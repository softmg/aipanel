import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearAggregatorCache, getProjectCards, getProjectDetail } from "@/lib/services/aggregator";

const originalEnv = process.env.AIPANEL_CONFIG;

async function withTempConfig(content: string, run: () => Promise<void>) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-aggregator-test-"));
  const configPath = path.join(tempRoot, "projects.json");
  await fs.writeFile(configPath, content, "utf8");
  process.env.AIPANEL_CONFIG = configPath;

  try {
    await run();
  } finally {
    clearAggregatorCache();
    if (originalEnv) {
      process.env.AIPANEL_CONFIG = originalEnv;
    } else {
      delete process.env.AIPANEL_CONFIG;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

beforeEach(() => {
  clearAggregatorCache();
});

describe("aggregator", () => {
  it("returns empty cards list when config path points to missing file", async () => {
    process.env.AIPANEL_CONFIG = "/tmp/definitely-missing-aipanel-config.json";
    const cards = await getProjectCards();
    expect(cards).toEqual([]);
  });

  it("returns detail with warnings when sources unavailable", async () => {
    await withTempConfig(
      JSON.stringify({
        projects: [{ name: "Demo", path: "/tmp/non-existent-aipanel-project" }],
      }),
      async () => {
        const detail = await getProjectDetail("demo");
        expect(detail).not.toBeNull();
        expect(detail?.project.name).toBe("Demo");
        expect(Array.isArray(detail?.warnings)).toBe(true);
      },
    );
  });
});
