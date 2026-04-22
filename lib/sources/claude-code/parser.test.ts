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

  it("uses real prompt text from mixed hook and command content", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const filePath = path.join(tempRoot, "session-mixed-content.jsonl");

    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-21T10:00:00.000Z",
        message: {
          content:
            '<system-reminder>SessionStart:clear hook success</system-reminder>\n<local-command-caveat>Ignore command output</local-command-caveat>\n<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>\n<local-command-stdout></local-command-stdout>\nдо сих пор поподаются сессии без названия, нужно сделать чтобы сессии были названы по краткому содержанию первого промпта в сессиии [Image #4]',
        },
      }),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(filePath);
      expect(summary.title).toContain("до сих пор поподаются сессии без названия");
      expect(summary.title).not.toContain("system-reminder");
      expect(summary.title).not.toContain("command-name");
      expect(summary.title).not.toContain("Image");
      expect(summary.title?.length).toBeLessThanOrEqual(120);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses slash command args as title content", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const filePath = path.join(tempRoot, "session-slash-command-args.jsonl");

    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-21T10:00:00.000Z",
        message: {
          content:
            "<command-name>/agent-teams-sm:team-feature</command-name>\n<command-message>agent-teams-sm:team-feature</command-message>\n<command-args>если сессия запущена больше 1 минуты и у неё нет название, добавить название сессии</command-args>",
        },
      }),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(filePath);
      expect(summary.title).toContain("если сессия запущена больше 1 минуты");
      expect(summary.title).not.toContain("command-name");
      expect(summary.title).not.toContain("agent-teams-sm:team-feature");
      expect(summary.usageSplit).toEqual({
        main: { inputTokens: 0, outputTokens: 0 },
        agents: { inputTokens: 0, outputTokens: 0 },
        total: { inputTokens: 0, outputTokens: 0 },
      });
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
      expect(summary.usageSplit).toEqual({
        main: { inputTokens: 0, outputTokens: 0 },
        agents: { inputTokens: 11, outputTokens: 22 },
        total: { inputTokens: 11, outputTokens: 22 },
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

  it("uses parent Agent description for subagent display names when logs only contain ids", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const sessionPath = path.join(tempRoot, "session-5.jsonl");
    const subagentsDir = path.join(tempRoot, "session-5", "subagents");
    const subagentPath = path.join(subagentsDir, "agent-a789.jsonl");

    await fs.mkdir(subagentsDir, { recursive: true });
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "assistant",
          uuid: "parent-1",
          timestamp: "2026-04-21T10:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "call-agent-1",
                name: "Agent",
                input: {
                  description: "Review team popover",
                  prompt: "Review the UI change.",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          uuid: "parent-2",
          timestamp: "2026-04-21T10:00:01.000Z",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-agent-1",
                content:
                  "Async agent launched successfully. agentId: a789 (internal ID - do not mention to user.)",
              },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      subagentPath,
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-04-21T10:00:02.000Z",
          agentId: "a789",
          message: {
            usage: {
              input_tokens: 5,
              output_tokens: 6,
              cache_read_input_tokens: 7,
              cache_creation_input_tokens: 8,
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(sessionPath);
      expect(summary.subagents?.[0]).toMatchObject({
        agentId: "a789",
        agentName: "Review team popover",
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not replace explicit subagent display names with generic prompt roles", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const sessionPath = path.join(tempRoot, "session-6.jsonl");
    const subagentsDir = path.join(tempRoot, "session-6", "subagents");
    const subagentPath = path.join(subagentsDir, "agent-a999.jsonl");

    await fs.mkdir(subagentsDir, { recursive: true });
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-04-21T10:00:00.000Z",
          message: {
            content: [
              {
                type: "tool_use",
                id: "call-agent-2",
                name: "Agent",
                input: {
                  description: "Implement token split feature",
                  name: "coder-token-split",
                  prompt: "You are coder-1. Claim task #1 and implement token split.",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:01.000Z",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-agent-2",
                content: "Async agent launched successfully. agentId: a999",
              },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      subagentPath,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:02.000Z",
          agentId: "a999",
          message: { content: "You are coder-1. Claim task #1 and implement token split." },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-04-21T10:00:03.000Z",
          agentId: "a999",
          message: { usage: { input_tokens: 10, output_tokens: 20 } },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(sessionPath);
      expect(summary.subagents?.[0]).toMatchObject({
        agentId: "a999",
        agentName: "coder-token-split",
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("includes launched team agents that do not have subagent log files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const sessionPath = path.join(tempRoot, "session-7.jsonl");

    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-04-21T10:00:00.000Z",
          message: {
            content: [
              {
                type: "tool_use",
                id: "call-agent-3",
                name: "Agent",
                input: {
                  description: "Implement token split feature",
                  name: "coder-token-split",
                  prompt: "Implement the feature.",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-04-21T10:00:01.000Z",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-agent-3",
                content: [
                  {
                    type: "text",
                    text: "Spawned successfully.\nagent_id: coder-token-split@token-split-feature\nname: coder-token-split",
                  },
                ],
              },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(sessionPath);
      expect(summary.subagents).toEqual([
        {
          agentId: "coder-token-split@token-split-feature",
          agentName: "coder-token-split",
          turns: 0,
          lastActivityAt: null,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          },
        },
      ]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("includes team lead from team config for lead sessions", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-parser-"));
    const home = path.join(tempRoot, "home");
    const projectRoot = path.join(tempRoot, "project");
    const teamsDir = path.join(home, ".claude", "teams", "token-split-feature");
    const sessionPath = path.join(projectRoot, "lead-session.jsonl");
    const previousHome = process.env.HOME;

    await fs.mkdir(teamsDir, { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    process.env.HOME = home;
    clearClaudeCodeCache();

    await fs.writeFile(
      path.join(teamsDir, "config.json"),
      JSON.stringify({
        name: "token-split-feature",
        leadSessionId: "lead-session",
        members: [
          { agentId: "team-lead@token-split-feature", name: "team-lead" },
          { agentId: "coder-token-split@token-split-feature", name: "coder-token-split" },
        ],
      }),
      "utf8",
    );
    await fs.writeFile(
      sessionPath,
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-21T10:00:00.000Z",
        teamName: "token-split-feature",
        message: { content: "Implement token split" },
      }),
      "utf8",
    );

    try {
      const summary = await parseSessionFile(sessionPath);
      expect(summary.subagents?.map((agent) => agent.agentName)).toEqual(["team-lead", "coder-token-split"]);
    } finally {
      if (previousHome) {
        process.env.HOME = previousHome;
      } else {
        delete process.env.HOME;
      }
      clearClaudeCodeCache();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
