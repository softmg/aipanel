import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

const execFileAsync = promisify(execFile);

const ELLIPSIS = "…";
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 512;
const MAX_DETAIL_LENGTH = 220;

const SECRET_PATTERNS: RegExp[] = [
  /\bTOKEN\s*=\s*[^\s]+/gi,
  /\bAPI_KEY\s*=\s*[^\s]+/gi,
  /\bpassword\s*=\s*[^\s]+/gi,
  /\bAuthorization\s*:\s*[^\n\r]+/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
];

const TOKEN_LIKE_PATTERN = /\b\d{5,}:[A-Za-z0-9_-]{5,}\b/g;
const BOT_PATH_PATTERN = /\/bot[A-Za-z0-9:_-]+\//g;
const CHAT_ID_PATTERN = /\bchat[_-]?id\s*[:=]\s*[^\s,]+/gi;
const ABSOLUTE_PATH_PATTERN = /(?:\/[\w.-]+)+/g;

const APPLE_SCRIPT = [
  "on run argv",
  "  set notificationBody to item 1 of argv",
  "  set notificationTitle to item 2 of argv",
  "  display notification notificationBody with title notificationTitle",
  "end run",
].join("\n");

export type MacOSNotificationMode = "disabled" | "script";

export type MacOSNotificationConfig = {
  enabled: boolean;
  mode?: MacOSNotificationMode;
  dryRun?: boolean;
};

export type MacOSNotificationResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: "disabled" | "unsupported-os" | "dry-run" | "unavailable" }
  | { ok: false; skipped?: false; error: string };

export type MacOSNotificationPayload = {
  title: string;
  body: string;
};

type MacOSRunner = (command: string, args: string[]) => Promise<void>;

export type MacOSSendOptions = {
  platform?: NodeJS.Platform;
  runner?: MacOSRunner;
};

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - ELLIPSIS.length))}${ELLIPSIS}`;
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getTitle(notification: ClaudeNotification): string {
  if (notification.kind === "question") {
    return "Claude asks a question";
  }

  return "Task ready for review";
}

function safeDetail(notification: ClaudeNotification): string | undefined {
  const details = normalizeNonEmpty(notification.details);
  const title = normalizeNonEmpty(notification.title);

  if (!details) {
    return title;
  }

  if (title && details.toLowerCase() === title.toLowerCase()) {
    return title;
  }

  return `${title ?? ""}${title ? " — " : ""}${details}`;
}

function defaultRunner(command: string, args: string[]): Promise<void> {
  return execFileAsync(command, args, { timeout: 5000 }).then(() => undefined);
}

export function sanitizeMacOSNotificationText(value: string): string {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[redacted]"), value).trim();
}

export function sanitizeMacOSNotificationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unable to send macOS notification.";

  return raw
    .replace(BOT_PATH_PATTERN, "/bot[redacted]/")
    .replace(TOKEN_LIKE_PATTERN, "[redacted-token]")
    .replace(CHAT_ID_PATTERN, "chat_id=[redacted]")
    .replace(ABSOLUTE_PATH_PATTERN, "[path]")
    .slice(0, 1200);
}

export function formatMacOSNotification(notification: ClaudeNotification): MacOSNotificationPayload {
  const title = truncate(sanitizeMacOSNotificationText(getTitle(notification)), MAX_TITLE_LENGTH);

  const segments: string[] = [];
  const project = normalizeNonEmpty(notification.projectLabel) ?? normalizeNonEmpty(notification.projectSlug);
  if (project) {
    segments.push(`Project: ${project}`);
  }

  const session = normalizeNonEmpty(notification.sessionLabel);
  if (session) {
    segments.push(`Session: ${session}`);
  }

  const detail = safeDetail(notification);
  if (detail) {
    segments.push(truncate(detail, MAX_DETAIL_LENGTH));
  }

  const body = truncate(
    sanitizeMacOSNotificationText(segments.join("\n") || normalizeNonEmpty(notification.title) || "Human intervention needed"),
    MAX_BODY_LENGTH,
  );

  return { title, body };
}

export function isMacOSNativeNotificationAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

export async function sendMacOSNativeNotification(
  notification: ClaudeNotification,
  config: MacOSNotificationConfig,
  options: MacOSSendOptions = {},
): Promise<MacOSNotificationResult> {
  if (!config.enabled || config.mode === "disabled") {
    return { ok: false, skipped: true, reason: "disabled" };
  }

  const platform = options.platform ?? process.platform;
  if (!isMacOSNativeNotificationAvailable(platform)) {
    return { ok: false, skipped: true, reason: "unsupported-os" };
  }

  if (config.dryRun) {
    return { ok: false, skipped: true, reason: "dry-run" };
  }

  const payload = formatMacOSNotification(notification);
  const runner = options.runner ?? defaultRunner;

  try {
    await runner("osascript", ["-e", APPLE_SCRIPT, payload.body, payload.title]);
    return { ok: true };
  } catch (error) {
    const sanitized = sanitizeMacOSNotificationError(error);
    if (/\b(?:not found|ENOENT|No such file)\b/i.test(sanitized)) {
      return { ok: false, skipped: true, reason: "unavailable" };
    }

    return { ok: false, error: sanitized };
  }
}
