import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { saveRunMeta, saveScenario } from "@/lib/supermemory";
import type { ScenarioInput, Run } from "@/lib/types";
import { DEFAULT_SOURCES } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title,
      policyChange,
      description = "",
      presetId,
      roundCount = 3,
      personaCount = 10,
      searchLimit = 2,
      sources = DEFAULT_SOURCES,
    } = body as Partial<ScenarioInput> & { title: string; policyChange: string };

    if (!title || !policyChange) {
      return NextResponse.json({ error: "title and policyChange are required" }, { status: 400 });
    }

    const runId = randomUUID();
    const now = new Date().toISOString();

    const scenario: ScenarioInput = {
      presetId,
      title,
      description,
      policyChange,
      roundCount,
      personaCount,
      searchLimit,
      sources,
    };

    const run: Run = {
      runId,
      title,
      status: "created",
      scenario,
      createdAt: now,
      updatedAt: now,
    };

    // Persist to Super Memory
    await saveRunMeta(runId, { ...run });
    await saveScenario(runId, scenario);

    return NextResponse.json({ runId, run }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/runs]", err);
    return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
  }
}
