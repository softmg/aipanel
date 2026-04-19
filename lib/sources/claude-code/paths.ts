import path from "node:path";
import { toEncodedPath } from "@/lib/config/loader";

export function getClaudeProjectsRoot(): string {
  return path.resolve(process.env.HOME ?? "", ".claude", "projects");
}

export function getClaudeProjectDir(projectPath: string): string {
  return path.resolve(getClaudeProjectsRoot(), toEncodedPath(projectPath));
}
