import type { BeadTask, BeadTaskDetail } from "@/lib/sources/beads/types";
import { runBeadsList, runBeadsShow } from "@/lib/sources/beads/runner";

export async function listTasksForProject(projectPath: string): Promise<BeadTask[]> {
  return runBeadsList(projectPath);
}

export async function getTaskDetailForProject(
  projectPath: string,
  taskId: string,
): Promise<BeadTaskDetail | null> {
  return runBeadsShow(projectPath, taskId);
}
