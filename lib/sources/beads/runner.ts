import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BeadTask } from "@/lib/sources/beads/types";

const execFileAsync = promisify(execFile);

export async function runBeadsList(projectPath: string): Promise<BeadTask[]> {
  try {
    const { stdout } = await execFileAsync("bd", ["list", "--all", "--format", "json"], {
      cwd: path.resolve(projectPath),
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });

    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as BeadTask[];
  } catch {
    return [];
  }
}
