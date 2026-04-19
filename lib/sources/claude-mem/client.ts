import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getClaudeMemDbPath(): string {
  return path.resolve(process.env.HOME ?? "", ".claude-mem", "claude-mem.db");
}

export function getClaudeMemDb(): Database.Database | null {
  const dbPath = getClaudeMemDbPath();
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  if (!db) {
    db = new Database(dbPath, { readonly: true, fileMustExist: false });
  }

  return db;
}
