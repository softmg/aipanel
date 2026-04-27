import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_CONFIG_DIR_NAME = ".aipanel";
const CONFIG_DIR_ENV = "AIPANEL_CONFIG_DIR";
const DELIVERY_LOG_FILE_NAME = "notification-delivery-log.sqlite";
const DEFAULT_RULE_ID = "task-completion";

const TOKEN_LIKE_PATTERN = /\b\d{5,}:[A-Za-z0-9_-]{5,}\b/g;
const BOT_PATH_PATTERN = /\/bot[A-Za-z0-9:_-]+\//g;
const CHAT_ID_PATTERN = /\bchat[_-]?id\s*[:=]\s*[^\s,]+/gi;
const ABSOLUTE_PATH_PATTERN = /(?:\/[\w.-]+)+/g;

export type DeliveryChannel = "telegram" | "macos";

export type DeliveryLogOptions = {
  configDir?: string;
};

export type DeliveryLogRecordInput = {
  channel: DeliveryChannel;
  notificationId: string;
  projectSlug?: string;
  sessionId?: string;
  ruleId?: string;
  now?: Date;
};

export function getNotificationDeliveryLogPath(options: DeliveryLogOptions = {}): string {
  const configDir = options.configDir ?? process.env[CONFIG_DIR_ENV] ?? path.join(os.homedir(), DEFAULT_CONFIG_DIR_NAME);
  return path.join(configDir, DELIVERY_LOG_FILE_NAME);
}

function toKeyPart(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "-";
}

export function makeDeliveryKey(input: DeliveryLogRecordInput): string {
  return [
    "v1",
    input.channel,
    toKeyPart(input.notificationId),
    toKeyPart(input.projectSlug),
    toKeyPart(input.sessionId),
    toKeyPart(input.ruleId ?? DEFAULT_RULE_ID),
  ].join("|");
}

function toIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export function sanitizeDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown delivery error.";

  return raw
    .replace(BOT_PATH_PATTERN, "/bot[redacted]/")
    .replace(TOKEN_LIKE_PATTERN, "[redacted-token]")
    .replace(CHAT_ID_PATTERN, "chat_id=[redacted]")
    .replace(ABSOLUTE_PATH_PATTERN, "[path]")
    .slice(0, 1200);
}

const INIT_SQL = `
create table if not exists notification_delivery_log (
  id text primary key,
  notification_id text not null,
  project_slug text,
  session_id text,
  channel text not null,
  rule_id text,
  created_at text not null,
  status text not null,
  error text
);
`;

function getDb(options: DeliveryLogOptions = {}): Database.Database {
  const dbPath = getNotificationDeliveryLogPath(options);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(INIT_SQL);
  return db;
}

export function hasSuccessfulDelivery(input: DeliveryLogRecordInput, options: DeliveryLogOptions = {}): boolean {
  const db = getDb(options);

  try {
    const key = makeDeliveryKey(input);
    const row = db
      .prepare("select status from notification_delivery_log where id = ? limit 1")
      .get(key) as { status?: string } | undefined;
    return row?.status === "success";
  } finally {
    db.close();
  }
}

export function recordDeliveryAttempt(input: DeliveryLogRecordInput, options: DeliveryLogOptions = {}): void {
  const db = getDb(options);

  try {
    db
      .prepare(
        `
          insert into notification_delivery_log
            (id, notification_id, project_slug, session_id, channel, rule_id, created_at, status, error)
          values (?, ?, ?, ?, ?, ?, ?, ?, null)
          on conflict(id) do update set
            notification_id = excluded.notification_id,
            project_slug = excluded.project_slug,
            session_id = excluded.session_id,
            channel = excluded.channel,
            rule_id = excluded.rule_id,
            created_at = excluded.created_at,
            status = excluded.status,
            error = null
        `,
      )
      .run(
        makeDeliveryKey(input),
        input.notificationId,
        input.projectSlug ?? null,
        input.sessionId ?? null,
        input.channel,
        input.ruleId ?? DEFAULT_RULE_ID,
        toIso(input.now),
        "attempt",
      );
  } finally {
    db.close();
  }
}

export function recordDeliverySuccess(input: DeliveryLogRecordInput, options: DeliveryLogOptions = {}): void {
  const db = getDb(options);

  try {
    db
      .prepare(
        `
          update notification_delivery_log
          set status = 'success',
              error = null,
              created_at = ?
          where id = ?
        `,
      )
      .run(toIso(input.now), makeDeliveryKey(input));
  } finally {
    db.close();
  }
}

export function recordDeliveryFailure(
  input: DeliveryLogRecordInput,
  error: unknown,
  options: DeliveryLogOptions = {},
): void {
  const db = getDb(options);

  try {
    db
      .prepare(
        `
          update notification_delivery_log
          set status = 'failed',
              error = ?,
              created_at = ?
          where id = ?
        `,
      )
      .run(sanitizeDeliveryError(error), toIso(input.now), makeDeliveryKey(input));
  } finally {
    db.close();
  }
}
