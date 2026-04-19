import fs from "node:fs/promises";
import path from "node:path";
import { appConfigSchema } from "@/lib/config/schema";

export async function loadProjectsConfigFrom(configPath: string) {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = appConfigSchema.parse(JSON.parse(raw));

  return parsed.projects
    .filter((project) => project.enabled !== false)
    .map((project) => ({
      name: project.name ?? path.basename(project.path),
      path: path.resolve(project.path),
    }));
}
