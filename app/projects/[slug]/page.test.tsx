import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("server/client split", () => {
  it("keeps project route page as server component", async () => {
    const filePath = path.resolve(process.cwd(), "app/projects/[slug]/page.tsx");
    const source = await fs.readFile(filePath, "utf8");
    expect(source.startsWith('"use client"')).toBe(false);
  });

  it("keeps home page as server component", async () => {
    const filePath = path.resolve(process.cwd(), "app/page.tsx");
    const source = await fs.readFile(filePath, "utf8");
    expect(source.startsWith('"use client"')).toBe(false);
  });
});
