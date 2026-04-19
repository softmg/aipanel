import { NextResponse } from "next/server";
import { getProjectCards } from "@/lib/services/aggregator";

export async function GET() {
  try {
    const projects = await getProjectCards();
    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}
