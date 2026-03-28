import { NextRequest } from "next/server";
import { generateReportOutline, generateReportSection } from "@/lib/openai-client";
import { saveReportSection, saveRunMeta, searchSources } from "@/lib/supermemory";
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

      // Pull all simulation context
      const allContext = await searchSources(runId, scenario.policyChange, 10);

      for (let i = 0; i < outline.length; i++) {
        const { id, title } = outline[i];
        send({ type: "section_started", sectionId: id, title });

        const section = await generateReportSection(id, title, i + 1, scenario, allContext);

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
