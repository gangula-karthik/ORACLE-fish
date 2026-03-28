import { NextRequest } from "next/server";
import { TinyFish, EventType, RunStatus, BrowserProfile } from "@tiny-fish/sdk";
import { randomUUID } from "crypto";

import { getFallbackDocuments } from "@/lib/fallback-documents";
import { createSSEStream } from "@/lib/sse";
import { saveSourceDocument, saveRunMeta } from "@/lib/supermemory";
import type { PresetScenarioId, SourceDocument } from "@/lib/types";

const PARLIAMENT_SOURCES = [
  {
    url: "https://www.parliament.gov.sg/news/topics/gst",
    label: "Parliament - GST Debates",
  },
  {
    url: "https://www.mof.gov.sg/singaporebudget/budget-2024/budget-at-a-glance",
    label: "MOF Budget 2024",
  },
  {
    url: "https://www.parliament.gov.sg/news/topics/goods-and-services-tax",
    label: "Parliament - GST Overview",
  },
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const { send, close, response } = createSSEStream();
  let aborted = false;

  req.signal.addEventListener("abort", () => {
    aborted = true;
  });

  (async () => {
    const client = new TinyFish({ timeout: 60_000 });
    let totalDocs = 0;
    const scenarioQuery = req.nextUrl.searchParams.get("policyChange") ?? "GST increase Singapore";
    const scenarioTitle = req.nextUrl.searchParams.get("title") ?? "Policy scenario";
    const presetId = (req.nextUrl.searchParams.get("presetId") ?? undefined) as PresetScenarioId | undefined;

    async function persistFallbackDocuments(reason: string) {
      const fallbackDocs = getFallbackDocuments({
        runId,
        presetId,
        title: scenarioTitle,
        policyChange: scenarioQuery,
      });

      send({ type: "progress", url: "fallback://prepared-documents", message: reason });

      for (const doc of fallbackDocs) {
        await saveSourceDocument(runId, doc);
        send({ type: "document", document: doc });
      }

      totalDocs += fallbackDocs.length;
      await saveRunMeta(runId, {
        status: "scrape_complete",
        updatedAt: new Date().toISOString(),
        usedFallbackDocuments: true,
      });
      send({ type: "complete", totalDocs });
    }

    try {
      const requestedLimit = Number(req.nextUrl.searchParams.get("searchLimit") ?? PARLIAMENT_SOURCES.length);
      const searchLimit = Number.isFinite(requestedLimit)
        ? Math.min(PARLIAMENT_SOURCES.length, Math.max(1, Math.floor(requestedLimit)))
        : PARLIAMENT_SOURCES.length;
      const sources = PARLIAMENT_SOURCES.slice(0, searchLimit);

      await saveRunMeta(runId, { status: "scraping", updatedAt: new Date().toISOString() });
      send({ type: "started", totalSources: sources.length });

      for (const source of sources) {
        if (aborted) break;
        send({ type: "source_started", url: source.url, label: source.label });

        try {
          const goal = `Extract all relevant content about: "${scenarioQuery}"
from this Singapore government page. Return a JSON object with:
- title: page title
- publisher: organization name
- publishDate: date if visible
- excerpts: array of relevant text passages (up to 5, each 100-300 words)
- relevanceTags: keywords that describe the content (e.g. GST, tax relief, Assurance Package)

Focus on policy details, parliamentary speeches, minister statements, and impact assessments.`;

          send({ type: "progress", url: source.url, message: "Navigating page..." });

          const stream = await client.agent.stream({
            url: source.url,
            goal,
            browser_profile: BrowserProfile.STEALTH,
          });

          let resultData: Record<string, unknown> = {};

          for await (const event of stream) {
            if (aborted) break;

            if (event.type === EventType.PROGRESS) {
              send({ type: "progress", url: source.url, message: event.purpose ?? "Processing..." });
            } else if (event.type === EventType.COMPLETE) {
              if (event.status === RunStatus.COMPLETED) {
                try {
                  const raw = typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? "{}");
                  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
                  resultData = JSON.parse(cleaned);
                } catch {
                  resultData = {
                    title: source.label,
                    publisher: source.label,
                    excerpts: [String(event.result ?? "")],
                    relevanceTags: [],
                  };
                }
              } else {
                send({ type: "progress", url: source.url, message: `Scrape incomplete: ${event.error?.message ?? "unknown error"}` });
              }
            }
          }

          const excerpts: string[] = Array.isArray(resultData.excerpts)
            ? (resultData.excerpts as string[])
            : [String(resultData.excerpts ?? "")];

          if (aborted) break;

          let docCount = 0;
          for (const excerpt of excerpts.filter(Boolean)) {
            if (aborted) break;

            const doc: SourceDocument = {
              id: randomUUID(),
              runId,
              url: source.url,
              publisher: String(resultData.publisher ?? source.label),
              title: String(resultData.title ?? source.label),
              publishDate: resultData.publishDate ? String(resultData.publishDate) : undefined,
              excerpt,
              relevanceTags: Array.isArray(resultData.relevanceTags)
                ? (resultData.relevanceTags as string[])
                : [],
              scrapedAt: new Date().toISOString(),
            };

            await saveSourceDocument(runId, doc);
            send({ type: "document", document: doc });
            docCount++;
            totalDocs++;
          }

          if (aborted) break;
          send({ type: "source_complete", url: source.url, docCount });
        } catch (sourceErr) {
          if (aborted) break;
          console.error(`[scrape] Error scraping ${source.url}:`, sourceErr);
          send({ type: "progress", url: source.url, message: `Error: ${(sourceErr as Error).message}` });
          send({ type: "source_complete", url: source.url, docCount: 0 });
        }
      }

      if (aborted) {
        await saveRunMeta(runId, { status: "created", updatedAt: new Date().toISOString() });
        return;
      }

      if (totalDocs === 0) {
        await persistFallbackDocuments("Scraping returned no usable excerpts. Using prepared fallback documents instead.");
        return;
      }

      await saveRunMeta(runId, { status: "scrape_complete", updatedAt: new Date().toISOString() });
      send({ type: "complete", totalDocs });
    } catch (err) {
      if (aborted) return;
      console.error("[scrape/stream]", err);
      await persistFallbackDocuments(`Scraping failed: ${(err as Error).message}. Using prepared fallback documents instead.`);
    } finally {
      close();
    }
  })();

  return response;
}
