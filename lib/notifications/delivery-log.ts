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

const CREATE_TABLE_SQL = `
create table if not exists notification_delivery_log (
  id text primary key,
  notification_id text not null,
  project_slug text,
  session_id text,
  channel text not null,
  rule_id text,
  semantic_key text,
  created_at text not null,
  status text not null,
  error text
);
`;

const CREATE_SEMANTIC_INDEX_SQL = `
create index if not exists idx_notification_delivery_log_semantic_success
on notification_delivery_log (semantic_key, status, created_at);
`;

export const EXTERNAL_NOTIFICATION_DEDUPE_WINDOW_MS = 5_000;

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
  semanticKey?: string;
  now?: Date;
};

export type DeliveryLogSemanticInput = {
  channel: DeliveryChannel;
  projectSlug?: string;
  sessionId?: string;
  kind?: string;
  status?: string;
  title?: string;
  details?: string;
};

export type DeliveryLogSemanticCheckInput = {
  semanticKey: string;
  now?: Date;
  windowMs: number;
};

export function getNotificationDeliveryLogPath(options: DeliveryLogOptions = {}): string {
  const configDir = options.configDir ?? process.env[CONFIG_DIR_ENV] ?? path.join(os.homedir(), DEFAULT_CONFIG_DIR_NAME);
  return path.join(configDir, DELIVERY_LOG_FILE_NAME);
}

function toKeyPart(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "-";
}

function toSemanticPart(value: string | undefined): string {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
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

export function makeSemanticDeliveryKey(input: DeliveryLogSemanticInput): string {
  return [
    "v1",
    input.channel,
    toSemanticPart(input.projectSlug),
    toSemanticPart(input.sessionId),
    toSemanticPart(input.kind),
    toSemanticPart(input.status),
    toSemanticPart(input.title),
    toSemanticPart(input.details),
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

function ensureSchema(db: Database.Database): void {
  db.exec(CREATE_TABLE_SQL);

  const columns = db.prepare("pragma table_info(notification_delivery_log)").all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === "semantic_key")) {
    db.exec("alter table notification_delivery_log add column semantic_key text");
  }

  db.exec(CREATE_SEMANTIC_INDEX_SQL);
}

function getDb(options: DeliveryLogOptions = {}): Database.Database {
  const dbPath = getNotificationDeliveryLogPath(options);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  ensureSchema(db);
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

export function hasRecentSuccessfulSemanticDelivery(
  input: DeliveryLogSemanticCheckInput,
  options: DeliveryLogOptions = {},
): boolean {
  if (!input.semanticKey || input.windowMs <= 0) {
    return false;
  }

  const db = getDb(options);

  try {
    const cutoff = new Date((input.now ?? new Date()).getTime() - input.windowMs).toISOString();
    const row = db
      .prepare(
        `
          select 1
          from notification_delivery_log
          where semantic_key = ?
            and status = 'success'
            and created_at >= ?
          limit 1
        `,
      )
      .get(input.semanticKey, cutoff) as { 1?: number } | undefined;

    return Boolean(row);
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
            (id, notification_id, project_slug, session_id, channel, rule_id, semantic_key, created_at, status, error)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)
          on conflict(id) do update set
            notification_id = excluded.notification_id,
            project_slug = excluded.project_slug,
            session_id = excluded.session_id,
            channel = excluded.channel,
            rule_id = excluded.rule_id,
            semantic_key = excluded.semantic_key,
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
        input.semanticKey ?? null,
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
              semantic_key = ?,
              error = null,
              created_at = ?
          where id = ?
        `,
      )
      .run(input.semanticKey ?? null, toIso(input.now), makeDeliveryKey(input));
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
              semantic_key = ?,
              error = ?,
              created_at = ?
          where id = ?
        `,
      )
      .run(input.semanticKey ?? null, sanitizeDeliveryError(error), toIso(input.now), makeDeliveryKey(input));
  } finally {
    db.close();
  }
}
