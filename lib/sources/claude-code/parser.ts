import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ClaudeSessionSummary } from "@/lib/sources/claude-code/types";

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type RawEvent = {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    usage?: RawUsage;
  };
};

const cache = new Map<string, { mtimeMs: number; value: ClaudeSessionSummary }>();

function parseUsage(event: RawEvent): RawUsage {
  return event.message?.usage ?? {};
}

function asIso(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export async function parseSessionFile(filePath: string): Promise<ClaudeSessionSummary> {
  const stat = await fs.stat(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value;
  }

  const sessionId = path.basename(filePath, ".jsonl");
  let startedAt: string | null = null;
  let lastActivityAt: string | null = null;
  let userPromptCount = 0;
  let assistantTurnCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      continue;
    }

    const eventTime = asIso(event.timestamp);
    if (eventTime && !startedAt) {
      startedAt = eventTime;
    }
    if (eventTime) {
      lastActivityAt = eventTime;
    }

    if (event.type === "user") {
      userPromptCount += 1;
    }

    if (event.type === "assistant") {
      assistantTurnCount += 1;
      const usage = parseUsage(event);
      inputTokens += usage.input_tokens ?? 0;
      outputTokens += usage.output_tokens ?? 0;
      cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    }
  }

  const subagentsDir = path.resolve(path.dirname(filePath), sessionId, "subagents");
  let subagentCount = 0;
  try {
    const entries = await fs.readdir(subagentsDir);
    subagentCount = entries.filter((entry) => entry.endsWith(".jsonl")).length;
  } catch {
    subagentCount = 0;
  }

  const summary: ClaudeSessionSummary = {
    sessionId,
    startedAt,
    lastActivityAt: lastActivityAt ?? stat.mtime.toISOString(),
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    },
    userPromptCount,
    assistantTurnCount,
    subagentCount,
  };

  cache.set(filePath, { mtimeMs: stat.mtimeMs, value: summary });
  return summary;
}

export function clearClaudeCodeCache(): void {
  cache.clear();
}
