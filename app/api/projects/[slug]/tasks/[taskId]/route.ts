import { NextResponse } from "next/server";
import { z } from "zod";
import { getTaskDetail } from "@/lib/services/aggregator";

const paramsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  taskId: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i),
});

type Context = {
  params: Promise<{ slug: string; taskId: string }>;
};

export async function GET(_request: Request, context: Context) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const detail = await getTaskDetail(parsed.data.slug, parsed.data.taskId);
  if (!detail) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
