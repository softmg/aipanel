import { z } from "zod";

const projectSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const appConfigSchema = z.object({
  projects: z.array(projectSchema).default([]),
});

export type AppConfigSchema = z.infer<typeof appConfigSchema>;
