import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appConfigSchema } from "@/lib/config/schema";
import type { ProjectConfig } from "@/lib/config/types";

const DEFAULT_CONFIG_PATH = "projects.json";
const CONFIG_ENV = "AIPANEL_CONFIG";

export function toEncodedPath(absolutePath: string): string {
  return absolutePath.replaceAll("/", "-");
}

function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

function normalizePath(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.resolve(os.homedir(), inputPath.slice(2));
  }

  return path.resolve(inputPath);
}

function hashPath(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function toUniqueSlug(name: string, absolutePath: string, usedSlugs: Set<string>): string {
  const baseSlug = toSlug(name);
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.add(baseSlug);
    return baseSlug;
  }

  const pathSuffix = toSlug(path.basename(absolutePath));
  if (pathSuffix) {
    const candidate = `${baseSlug}-${pathSuffix}`;
    if (!usedSlugs.has(candidate)) {
      usedSlugs.add(candidate);
      return candidate;
    }
  }

  const hashSuffix = hashPath(absolutePath).slice(0, 6);
  let index = 1;
  let candidate = `${baseSlug}-${hashSuffix}`;

  while (usedSlugs.has(candidate)) {
    index += 1;
    candidate = `${baseSlug}-${hashSuffix}-${index}`;
  }

  usedSlugs.add(candidate);
  return candidate;
}

export async function loadProjectsConfig(): Promise<ProjectConfig[]> {
  const configPath = process.env[CONFIG_ENV]
    ? path.resolve(process.env[CONFIG_ENV] ?? DEFAULT_CONFIG_PATH)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_PATH);

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    return [];
  }

  const parsed = appConfigSchema.parse(JSON.parse(raw));
  const usedSlugs = new Set<string>();

  const seenPaths = new Set<string>();

  return parsed.projects
    .filter((project) => project.enabled !== false)
    .reduce<ProjectConfig[]>((acc, project) => {
      const absolutePath = normalizePath(project.path);
      if (seenPaths.has(absolutePath)) {
        return acc;
      }
      seenPaths.add(absolutePath);
      const inferredName = project.name ?? path.basename(absolutePath);
      acc.push({
        name: inferredName,
        absolutePath,
        slug: toUniqueSlug(inferredName, absolutePath, usedSlugs),
        encodedPath: toEncodedPath(absolutePath),
      });
      return acc;
    }, []);
}
