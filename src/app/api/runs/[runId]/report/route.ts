import { NextRequest } from "next/server";
import { buildSectionQuery, generateReportOutline, generateReportSection } from "@/lib/openai-client";
import { gatherReportEvidence, getInteractionContext, getRoundContext, saveReportSection, saveRunMeta, searchPersonas, searchSources } from "@/lib/supermemory";
import { createSSEStream } from "@/lib/sse";
import type { ScenarioInput } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const { send, close, response } = createSSEStream();

  (async () => {
    try {
      const scenarioParam = req.nextUrl.searchParams.get("scenario");
      if (!scenarioParam) {
        send({ type: "error", message: "scenario query param is required" });
        close();
        return;
      }

      const scenario: ScenarioInput = JSON.parse(decodeURIComponent(scenarioParam));

      await saveRunMeta(runId, { status: "generating_report", updatedAt: new Date().toISOString() });

      const outline = await generateReportOutline(scenario);
      send({ type: "outline", sections: outline });

      for (let i = 0; i < outline.length; i++) {
        const { id, title } = outline[i];
        send({ type: "section_started", sectionId: id, title });

        const query = buildSectionQuery(id, scenario);
        const evidence = await gatherReportEvidence(runId, query, 4);
        send({ type: "section_evidence", sectionId: id, evidence });
        const allContext = [
          await searchSources(runId, query, 6),
          await getRoundContext(runId, query, 5),
          await getInteractionContext(runId, query, 5),
          await searchPersonas(runId, query, 4),
        ].filter(Boolean).join("\n\n---\n\n");

        const section = await generateReportSection(id, title, i + 1, scenario, evidence, allContext);

        await saveReportSection(runId, section);
        send({ type: "section_complete", section });
      }

      await saveRunMeta(runId, { status: "complete", updatedAt: new Date().toISOString() });
      send({ type: "complete", reportId: runId });
    } catch (err) {
      console.error("[report/stream]", err);
      send({ type: "error", message: (err as Error).message });
      await saveRunMeta(runId, { status: "error", error: (err as Error).message, updatedAt: new Date().toISOString() });
    } finally {
      close();
    }
  })();

  return response;
}
