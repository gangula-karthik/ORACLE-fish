import { NextRequest, NextResponse } from "next/server";
import { generatePersonas } from "@/lib/openai-client";
import { savePersona, saveRunMeta, searchSources } from "@/lib/supermemory";
import type { ScenarioInput } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  try {
    const body = await req.json();
    const { scenario } = body as { scenario: ScenarioInput };

    if (!scenario) {
      return NextResponse.json({ error: "scenario is required" }, { status: 400 });
    }

    await saveRunMeta(runId, { status: "generating_personas", updatedAt: new Date().toISOString() });

    // Pull relevant scraped context for persona generation
    const sourceContext = await searchSources(runId, scenario.policyChange, 5);

    const personas = await generatePersonas(runId, scenario, sourceContext, scenario.personaCount);

    // Persist each persona to Super Memory
    for (const persona of personas) {
      await savePersona(runId, persona);
    }

    await saveRunMeta(runId, { status: "personas_ready", updatedAt: new Date().toISOString() });

    return NextResponse.json({ personas });
  } catch (err) {
    console.error("[POST /personas]", err);
    await saveRunMeta(runId, { status: "error", error: (err as Error).message, updatedAt: new Date().toISOString() });
    return NextResponse.json({ error: "Failed to generate personas" }, { status: 500 });
  }
}
