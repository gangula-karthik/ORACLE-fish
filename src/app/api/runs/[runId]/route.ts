import { NextRequest, NextResponse } from "next/server";
import { getRunMeta } from "@/lib/supermemory";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  try {
    const run = await getRunMeta(runId);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json({ run });
  } catch (err) {
    console.error("[GET /api/runs/[runId]]", err);
    return NextResponse.json({ error: "Failed to retrieve run" }, { status: 500 });
  }
}
