import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearClaudeCodeCache, parseSessionFile } from "@/lib/sources/claude-code/parser";

afterEach(() => {
  clearClaudeCodeCache();
});

describe("claude-code parser", () => {
  it("derives title from first meaningful user string content and truncates long text", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const filePath = path.join(tempRoot, "session-1.jsonl");

    const veryLong = "Please help me investigate why this dashboard keeps showing stale deployment status after cache invalidation and webhook retries complete successfully";

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:00.000Z",
          message: {
            content: "   \n\t",
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:01:00.000Z",
          message: {
            content: `  ${veryLong}  `,
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(filePath);
      expect(summary.title).toBeDefined();
      expect(summary.title?.length).toBeLessThanOrEqual(120);
      expect(summary.title?.endsWith("…")).toBe(true);
      expect(summary.userPromptCount).toBe(2);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("derives title from first meaningful text block array and skips system reminder content", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const filePath = path.join(tempRoot, "session-2.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:00.000Z",
          message: {
            content: [
              {
                type: "text",
                text: "<system-reminder>PreToolUse:Read hook additional context</system-reminder>",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:02:00.000Z",
          message: {
            content: [
              { type: "image", text: "ignored" },
              { type: "text", text: "  Add fallback title from first user message for empty sessions  " },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(filePath);
      expect(summary.title).toBe("Add fallback title from first user message for empty sessions");
      expect(summary.userPromptCount).toBe(2);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
