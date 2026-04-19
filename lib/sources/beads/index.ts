import type { BeadTask } from "@/lib/sources/beads/types";
import { runBeadsList } from "@/lib/sources/beads/runner";

export async function listTasksForProject(projectPath: string): Promise<BeadTask[]> {
  return runBeadsList(projectPath);
}
