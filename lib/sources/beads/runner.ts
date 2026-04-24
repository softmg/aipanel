import fs from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BeadTask, BeadTaskDetail } from "@/lib/sources/beads/types";

const execFileAsync = promisify(execFile);

const BEADS_LIST_TTL_MS = 30_000;
type CachedBeads = { promise: Promise<BeadTask[]>; createdAt: number };
const beadsListCache = new Map<string, CachedBeads>();

export async function runBeadsList(projectPath: string): Promise<BeadTask[]> {
  const resolvedPath = path.resolve(projectPath);
  const beadsDir = path.resolve(resolvedPath, ".beads");
  if (!fs.existsSync(beadsDir)) {
    return [];
  }

  const cached = beadsListCache.get(resolvedPath);
  const now = Date.now();

  if (cached && now - cached.createdAt < BEADS_LIST_TTL_MS) {
    return cached.promise;
  }

  const previousDataPromise = cached?.promise ?? Promise.resolve([] as BeadTask[]);
  const promise = execFileAsync("bd", ["list", "--all", "--format", "json"], {
    cwd: resolvedPath,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  })
    .then(({ stdout }) => {
      const parsed = JSON.parse(stdout);
      return Array.isArray(parsed) ? (parsed as BeadTask[]) : [];
    })
    .catch(() => previousDataPromise);

  beadsListCache.set(resolvedPath, { promise, createdAt: now });
  return promise;
}

const taskIdPattern = /^[a-z0-9][a-z0-9_-]*$/i;

export async function runBeadsShow(
  projectPath: string,
  taskId: string,
): Promise<BeadTaskDetail | null> {
  if (!taskIdPattern.test(taskId)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("bd", ["show", taskId, "--json", "--long"], {
      cwd: path.resolve(projectPath),
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });

    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    const raw = parsed[0] as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.title !== "string" || typeof raw.status !== "string") {
      return null;
    }

    return {
      id: raw.id,
      title: raw.title,
      status: raw.status,
      priority: typeof raw.priority === "number" ? raw.priority : undefined,
      type: typeof raw.issue_type === "string" ? raw.issue_type : undefined,
      assignee: typeof raw.assignee === "string" ? raw.assignee : undefined,
      created_at: typeof raw.created_at === "string" ? raw.created_at : undefined,
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : undefined,
      closed_at: typeof raw.closed_at === "string" ? raw.closed_at : undefined,
      close_reason: typeof raw.close_reason === "string" ? raw.close_reason : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      design: typeof raw.design === "string" ? raw.design : undefined,
      acceptance_criteria:
        typeof raw.acceptance_criteria === "string" ? raw.acceptance_criteria : undefined,
      notes: typeof raw.notes === "string" ? raw.notes : undefined,
    };
  } catch {
    return null;
  }
}
