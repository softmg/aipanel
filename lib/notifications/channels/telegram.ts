import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

const DEFAULT_TELEGRAM_BASE_URL = "https://api.telegram.org";
const MAX_TELEGRAM_MESSAGE_LENGTH = 3500;
const MAX_DETAILS_LENGTH = 1800;
const ELLIPSIS = "…";

const SECRET_PATTERNS: RegExp[] = [
  /\bTOKEN\s*=\s*[^\s]+/gi,
  /\bAPI_KEY\s*=\s*[^\s]+/gi,
  /\bpassword\s*=\s*[^\s]+/gi,
  /\bAuthorization\s*:\s*[^\n\r]+/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
];

export type TelegramNotificationConfig = {
  botToken: string;
  chatId: string;
  baseUrl?: string;
};

export type TelegramNotificationFormatOptions = {
  localhostUrl?: string;
};

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - ELLIPSIS.length))}${ELLIPSIS}`;
}

function getProjectValue(notification: ClaudeNotification): string | undefined {
  return normalizeNonEmpty(notification.projectLabel) ?? normalizeNonEmpty(notification.projectSlug);
}

function sanitizeTelegramError(value: string): string {
  let sanitized = value;

  sanitized = sanitized.replace(/\/bot[A-Za-z0-9:_-]+\//g, "/bot[redacted]/");
  sanitized = sanitized.replace(/\bbot\d{5,}:[A-Za-z0-9_-]{5,}\b/gi, "bot[redacted]");
  sanitized = sanitized.replace(/\b\d{5,}:[A-Za-z0-9_-]{5,}\b/g, "[redacted-token]");
  sanitized = sanitized.replace(/\bchat[_-]?id\s*[:=]\s*[^\s,]+/gi, "chat_id=[redacted]");

  return sanitized;
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function redactTelegramNotificationText(value: string): string {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[redacted]"), value);
}

export function formatTelegramNotification(
  notification: ClaudeNotification,
  options: TelegramNotificationFormatOptions = {},
): string {
  const lines: string[] = [];

  lines.push("<b>aipanel</b>");
  lines.push(escapeTelegramHtml(redactTelegramNotificationText(notification.title)));
  lines.push("");

  const project = getProjectValue(notification);
  if (project) {
    lines.push(`Project: ${escapeTelegramHtml(redactTelegramNotificationText(project))}`);
  }

  lines.push(`Session: ${escapeTelegramHtml(redactTelegramNotificationText(notification.sessionLabel))}`);
  lines.push(`Kind: ${escapeTelegramHtml(redactTelegramNotificationText(notification.kind))}`);

  const details = normalizeNonEmpty(notification.details);
  if (details) {
    lines.push("");
    lines.push(escapeTelegramHtml(redactTelegramNotificationText(truncate(details, MAX_DETAILS_LENGTH))));
  }

  const localhostUrl = normalizeNonEmpty(options.localhostUrl);
  if (localhostUrl) {
    lines.push("");
    lines.push(`Open: ${escapeTelegramHtml(localhostUrl)}`);
  }

  return truncate(lines.join("\n"), MAX_TELEGRAM_MESSAGE_LENGTH);
}

function createTelegramRequestBody(
  notification: ClaudeNotification,
  config: TelegramNotificationConfig,
): Record<string, unknown> {
  return {
    chat_id: config.chatId,
    text: formatTelegramNotification(notification, {
      localhostUrl: notification.projectSlug
        ? `http://localhost:3000/projects/${encodeURIComponent(notification.projectSlug)}`
        : "http://localhost:3000",
    }),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
}

export async function sendTelegramNotification(
  notification: ClaudeNotification,
  config: TelegramNotificationConfig,
): Promise<void> {
  const baseUrl = normalizeNonEmpty(config.baseUrl) ?? DEFAULT_TELEGRAM_BASE_URL;
  const endpoint = `${baseUrl.replace(/\/$/, "")}/bot${config.botToken}/sendMessage`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTelegramRequestBody(notification, config)),
    });
  } catch {
    throw new Error("Unable to send Telegram notification.");
  }

  if (!response.ok) {
    let details = "";

    try {
      details = sanitizeTelegramError(await response.text());
    } catch {
      details = "";
    }

    if (details) {
      throw new Error(`Telegram notification request failed (${response.status}): ${details}`);
    }

    throw new Error(`Telegram notification request failed (${response.status}).`);
  }
}
