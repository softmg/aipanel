import { NextResponse } from "next/server";
import { clearAggregatorCache } from "@/lib/services/aggregator";

export async function POST() {
  clearAggregatorCache();
  return NextResponse.json({ refreshedAt: new Date().toISOString() });
}
