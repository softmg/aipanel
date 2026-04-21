import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ClaudeSessionSummary, ClaudeSubagentSummary } from "@/lib/sources/claude-code/types";

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
  agentId?: string;
  agentName?: string;
  message?: {
    usage?: RawUsage;
  };
};

type RawSubagentAggregate = {
  turns: number;
  lastActivityAt: string | null;
  agentId: string;
  agentName: string;
};

function parseSubagentName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "").replace(/^agent-/, "");
}

async function parseSubagentFile(filePath: string, fileName: string): Promise<ClaudeSubagentSummary> {
  let turns = 0;
  let lastActivityAt: string | null = null;
  let agentId = parseSubagentName(fileName);
  let agentName = agentId;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      continue;
    }

    if (event.type === "assistant") {
      turns += 1;
    }

    const eventTime = asIso(event.timestamp);
    if (eventTime) {
      lastActivityAt = eventTime;
    }

    if (typeof event.agentId === "string" && event.agentId.trim()) {
      agentId = event.agentId;
    }

    if (typeof event.agentName === "string" && event.agentName.trim()) {
      agentName = event.agentName;
    }
  }

  return { agentId, agentName, turns, lastActivityAt };
}

async function parseSubagents(subagentsDir: string): Promise<ClaudeSubagentSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(subagentsDir);
  } catch {
    return [];
  }

  const subagentFiles = entries.filter((entry) => entry.endsWith(".jsonl"));
  if (subagentFiles.length === 0) {
    return [];
  }

  const rows = await Promise.all(
    subagentFiles.map((entry) => parseSubagentFile(path.resolve(subagentsDir, entry), entry)),
  );

  const aggregates = new Map<string, RawSubagentAggregate>();

  for (const row of rows) {
    const key = row.agentId || row.agentName;
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        turns: row.turns,
        lastActivityAt: row.lastActivityAt,
        agentId: row.agentId,
        agentName: row.agentName,
      });
      continue;
    }

    existing.turns += row.turns;
    const existingTs = existing.lastActivityAt ? new Date(existing.lastActivityAt).valueOf() : -Infinity;
    const nextTs = row.lastActivityAt ? new Date(row.lastActivityAt).valueOf() : -Infinity;
    if (nextTs > existingTs) {
      existing.lastActivityAt = row.lastActivityAt;
    }

    if (!existing.agentName && row.agentName) {
      existing.agentName = row.agentName;
    }
  }

  return Array.from(aggregates.values())
    .map((row) => ({
      agentId: row.agentId,
      agentName: row.agentName || row.agentId,
      turns: row.turns,
      lastActivityAt: row.lastActivityAt,
    }))
    .sort((left, right) => {
      const leftTs = left.lastActivityAt ? new Date(left.lastActivityAt).valueOf() : -Infinity;
      const rightTs = right.lastActivityAt ? new Date(right.lastActivityAt).valueOf() : -Infinity;
      if (leftTs !== rightTs) {
        return rightTs - leftTs;
      }
      return right.turns - left.turns;
    });
}

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
  const subagents = await parseSubagents(subagentsDir);
  const subagentCount = subagents.length;

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
    subagents,
  };

  cache.set(filePath, { mtimeMs: stat.mtimeMs, value: summary });
  return summary;
}

export function clearClaudeCodeCache(): void {
  cache.clear();
}
