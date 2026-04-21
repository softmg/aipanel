import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { ClaudeSessionSummary, ClaudeSubagentSummary, TokenUsage } from "@/lib/sources/claude-code/types";

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type RawContentItem = {
  type?: string;
  id?: string;
  text?: string;
  name?: string;
  tool_use_id?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  input?: {
    description?: unknown;
    prompt?: unknown;
  };
};

type RawEvent = {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  agentId?: string;
  agentName?: string;
  message?: {
    usage?: RawUsage;
    content?: string | RawContentItem[];
  };
};

type RawSubagentAggregate = {
  turns: number;
  lastActivityAt: string | null;
  agentId: string;
  agentName: string;
  usage: TokenUsage;
};

function parseSubagentName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "").replace(/^agent-/, "");
}

const PROMPT_AGENT_NAME_PATTERN =
  /\b(coder-\d+|tech-lead|security-reviewer|logic-reviewer|quality-reviewer|unified-reviewer|architect-(?:frontend|backend|systems)|browser-verifier|ci-verifier|spec-verifier|risk-tester|codebase-researcher|reference-researcher)\b/i;
const AGENT_RESULT_ID_PATTERN = /agentId:\s*([\w-]+)/;

function extractTextContent(content: NonNullable<RawEvent["message"]>["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item.text === "string") {
        return item.text;
      }
      if (typeof item.content === "string") {
        return item.content;
      }
      if (Array.isArray(item.content)) {
        return item.content.map((nested) => nested.text ?? "").join(" ");
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function parseAgentNameFromPrompt(content: NonNullable<RawEvent["message"]>["content"]): string | null {
  const text = extractTextContent(content);
  if (!text) {
    return null;
  }

  const match = text.match(PROMPT_AGENT_NAME_PATTERN);
  return match?.[1]?.toLowerCase() ?? null;
}

function getBetterAgentName(current: string, candidate: string | undefined): string {
  if (!candidate) {
    return current;
  }
  return current === "" || /^[a-f0-9]{12,}$/i.test(current) ? candidate : current;
}

function parseAgentDescriptionByIdFromEvent(
  event: RawEvent,
  pendingAgentDescriptions: Map<string, string>,
): Map<string, string> {
  const descriptions = new Map<string, string>();
  const content = Array.isArray(event.message?.content) ? event.message.content : [];

  for (const item of content) {
    if (item.type === "tool_use" && item.name === "Agent" && typeof item.input?.description === "string") {
      pendingAgentDescriptions.set(item.id ?? "", item.input.description);
      continue;
    }

    if (item.type !== "tool_result" || !item.tool_use_id) {
      continue;
    }

    const description = pendingAgentDescriptions.get(item.tool_use_id);
    if (!description) {
      continue;
    }

    const text = extractTextContent([item]);
    const agentId = text.match(AGENT_RESULT_ID_PATTERN)?.[1];
    if (agentId) {
      descriptions.set(agentId, description);
    }
    pendingAgentDescriptions.delete(item.tool_use_id);
  }

  return descriptions;
}

const teamMemberNamesPromise = loadTeamMemberNames();

async function loadTeamMemberNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const teamsDir = path.join(os.homedir(), ".claude", "teams");

  let teamDirs: string[] = [];
  try {
    teamDirs = await fs.readdir(teamsDir);
  } catch {
    return names;
  }

  await Promise.all(
    teamDirs.map(async (teamDir) => {
      const configPath = path.join(teamsDir, teamDir, "config.json");
      let raw: string;
      try {
        raw = await fs.readFile(configPath, "utf8");
      } catch {
        return;
      }

      let parsed: { members?: Array<{ agentId?: string; name?: string }> };
      try {
        parsed = JSON.parse(raw) as { members?: Array<{ agentId?: string; name?: string }> };
      } catch {
        return;
      }

      for (const member of parsed.members ?? []) {
        if (!member.agentId || !member.name) {
          continue;
        }
        names.set(member.agentId, member.name);
      }
    }),
  );

  return names;
}

async function parseSubagentFile(
  filePath: string,
  fileName: string,
  parentAgentNames: Map<string, string>,
): Promise<ClaudeSubagentSummary> {
  let turns = 0;
  let lastActivityAt: string | null = null;
  let agentId = parseSubagentName(fileName);
  let agentName = parentAgentNames.get(agentId) ?? agentId;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const teamMemberNames = await teamMemberNamesPromise;

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
      const usage = parseUsage(event);
      inputTokens += usage.input_tokens ?? 0;
      outputTokens += usage.output_tokens ?? 0;
      cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    }

    const eventTime = asIso(event.timestamp);
    if (eventTime) {
      lastActivityAt = eventTime;
    }

    if (typeof event.agentId === "string" && event.agentId.trim()) {
      agentId = event.agentId;
      agentName = getBetterAgentName(agentName, teamMemberNames.get(agentId) ?? parentAgentNames.get(agentId));
    }

    if (typeof event.agentName === "string" && event.agentName.trim()) {
      agentName = event.agentName;
      continue;
    }

    if (event.type === "user") {
      const promptAgentName = parseAgentNameFromPrompt(event.message?.content);
      if (promptAgentName) {
        agentName = promptAgentName;
      }
    }
  }

  return {
    agentId,
    agentName,
    turns,
    lastActivityAt,
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    },
  };
}

async function parseSubagents(
  subagentsDir: string,
  parentAgentNames: Map<string, string>,
): Promise<ClaudeSubagentSummary[]> {
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
    subagentFiles.map((entry) => parseSubagentFile(path.resolve(subagentsDir, entry), entry, parentAgentNames)),
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
        usage: row.usage,
      });
      continue;
    }

    existing.turns += row.turns;
    existing.usage.inputTokens += row.usage.inputTokens;
    existing.usage.outputTokens += row.usage.outputTokens;
    existing.usage.cacheReadTokens += row.usage.cacheReadTokens;
    existing.usage.cacheCreationTokens += row.usage.cacheCreationTokens;
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
      usage: row.usage,
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

const MAX_TITLE_LENGTH = 120;
const TITLE_REFRESH_SESSION_AGE_MS = 60_000;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateTitle(value: string): string {
  if (value.length <= MAX_TITLE_LENGTH) {
    return value;
  }

  const truncated = value.slice(0, MAX_TITLE_LENGTH - 1).trimEnd();
  return `${truncated}…`;
}

function stripTitleNoise(value: string): string {
  return value
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, " ")
    .replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/gi, " ")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, " ")
    .replace(/\[Image #\d+\]/gi, " ");
}

function titleFromText(value: string): string | null {
  const normalized = collapseWhitespace(stripTitleNoise(value));
  if (!normalized) {
    return null;
  }
  return truncateTitle(normalized);
}

function parseTitleFromUserContent(content: NonNullable<RawEvent["message"]>["content"]): string | null {
  if (typeof content === "string") {
    return titleFromText(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ");

  return titleFromText(text);
}

function needsTitleRefresh(title: string | undefined, startedAt: string | null, now = Date.now()): boolean {
  if (title || !startedAt) {
    return false;
  }

  const startedAtMs = new Date(startedAt).valueOf();
  return !Number.isNaN(startedAtMs) && now - startedAtMs > TITLE_REFRESH_SESSION_AGE_MS;
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
  let title: string | undefined;
  let userPromptCount = 0;
  let assistantTurnCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const pendingAgentDescriptions = new Map<string, string>();
  const parentAgentNames = new Map<string, string>();

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

    const resolvedAgentNames = parseAgentDescriptionByIdFromEvent(event, pendingAgentDescriptions);
    for (const [resolvedAgentId, resolvedAgentName] of resolvedAgentNames) {
      parentAgentNames.set(resolvedAgentId, resolvedAgentName);
    }

    if (event.type === "user") {
      userPromptCount += 1;
      if (!title) {
        const candidateTitle = parseTitleFromUserContent(event.message?.content);
        if (candidateTitle) {
          title = candidateTitle;
        }
      }
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
  const subagents = await parseSubagents(subagentsDir, parentAgentNames);
  const subagentCount = subagents.length;

  const summary: ClaudeSessionSummary = {
    sessionId,
    title,
    needsTitleRefresh: needsTitleRefresh(title, startedAt),
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
