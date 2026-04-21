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

  it("extracts known subagent name and usage from subagent logs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const sessionPath = path.join(tempRoot, "session-3.jsonl");
    const subagentsDir = path.join(tempRoot, "session-3", "subagents");
    const subagentPath = path.join(subagentsDir, "agent-a123.jsonl");

    await fs.mkdir(subagentsDir, { recursive: true });
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:00.000Z",
          message: { content: "Main session prompt" },
        }),
      ].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      subagentPath,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:01.000Z",
          agentId: "a123",
          message: { content: "You are coder-1. Claim task #3 from the task list and implement it." },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-04-21T10:00:02.000Z",
          agentId: "a123",
          message: {
            usage: {
              input_tokens: 11,
              output_tokens: 22,
              cache_read_input_tokens: 33,
              cache_creation_input_tokens: 44,
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(sessionPath);
      expect(summary.subagentCount).toBe(1);
      expect(summary.subagents).toHaveLength(1);
      expect(summary.subagents?.[0]).toMatchObject({
        agentId: "a123",
        agentName: "coder-1",
        turns: 1,
        usage: {
          inputTokens: 11,
          outputTokens: 22,
          cacheReadTokens: 33,
          cacheCreationTokens: 44,
        },
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not infer arbitrary words as agent names", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const sessionPath = path.join(tempRoot, "session-4.jsonl");
    const subagentsDir = path.join(tempRoot, "session-4", "subagents");
    const subagentPath = path.join(subagentsDir, "agent-a456.jsonl");

    await fs.mkdir(subagentsDir, { recursive: true });
    await fs.writeFile(sessionPath, JSON.stringify({ type: "user", timestamp: "2026-04-21T10:00:00.000Z" }), "utf8");
    await fs.writeFile(
      subagentPath,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:01.000Z",
          agentId: "a456",
          message: { content: "Review this planning document and report issues." },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(sessionPath);
      expect(summary.subagents?.[0]?.agentName).toBe("a456");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
