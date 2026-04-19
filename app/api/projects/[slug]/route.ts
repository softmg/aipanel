import { NextResponse } from "next/server";
import { z } from "zod";
import { getProjectDetail } from "@/lib/services/aggregator";

const paramsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
});

type Context = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: Context) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const detail = await getProjectDetail(parsed.data.slug);
  if (!detail) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
