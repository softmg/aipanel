import { NextResponse } from "next/server";
import { z } from "zod";
import { getProjectSessionObservations } from "@/lib/services/aggregator";

const paramsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  memorySessionId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
});

type Context = {
  params: Promise<{ slug: string; memorySessionId: string }>;
};

export async function GET(_request: Request, context: Context) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const observations = await getProjectSessionObservations(parsed.data.slug, parsed.data.memorySessionId);
  if (!observations) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(observations);
}
