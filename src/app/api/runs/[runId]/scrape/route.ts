import { NextRequest } from "next/server";
import { TinyFish, EventType, RunStatus, BrowserProfile } from "@tiny-fish/sdk";
import { randomUUID } from "crypto";

import { getFallbackDocuments } from "@/lib/fallback-documents";
import { createSSEStream } from "@/lib/sse";
import { saveSourceDocument, saveRunMeta } from "@/lib/supermemory";
import type { PresetScenarioId, SourceDocument, SourceConfig } from "@/lib/types";

const DEFAULT_SCRAPE_TIMEOUT_MS = 120_000;
const parsedScrapeTimeoutMs = Number(process.env.TINYFISH_SCRAPE_TIMEOUT_MS);
const SCRAPE_TIMEOUT_MS =
  Number.isFinite(parsedScrapeTimeoutMs) && parsedScrapeTimeoutMs >= 30_000
    ? Math.floor(parsedScrapeTimeoutMs)
    : DEFAULT_SCRAPE_TIMEOUT_MS;

// Keep the route duration slightly above the upstream SDK timeout.
export const maxDuration = Math.ceil(SCRAPE_TIMEOUT_MS / 1000) + 15;

const BASE_POLICY_SOURCES = [
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
  {
    url: "https://www.reach.gov.sg",
    label: "REACH Singapore",
  },
  {
    url: "https://www.mof.gov.sg",
    label: "Ministry of Finance",
  },
  {
    url: "https://www.data.gov.sg",
    label: "Data.gov.sg",
  },
  {
    url: "https://www.gov.sg",
    label: "Gov.sg",
  },
];

const PRESET_SOURCE_MAP: Partial<Record<PresetScenarioId, Array<{ url: string; label: string }>>> = {
  gst_9_to_10: [
    { url: "https://www.parliament.gov.sg/news/topics/gst", label: "Parliament - GST Debates" },
    { url: "https://www.mof.gov.sg/singaporebudget", label: "MOF - Singapore Budget" },
    { url: "https://www.reach.gov.sg", label: "REACH Singapore" },
    { url: "https://www.gov.sg", label: "Gov.sg" },
    { url: "https://www.data.gov.sg", label: "Data.gov.sg" },
  ],
  transport_fare_hike: [
    { url: "https://www.ptc.gov.sg", label: "Public Transport Council" },
    { url: "https://www.mot.gov.sg", label: "Ministry of Transport" },
    { url: "https://www.lta.gov.sg", label: "Land Transport Authority" },
    { url: "https://www.data.gov.sg", label: "Data.gov.sg" },
    { url: "https://www.reach.gov.sg", label: "REACH Singapore" },
  ],
  hdb_policy: [
    { url: "https://www.hdb.gov.sg", label: "Housing & Development Board" },
    { url: "https://www.mnd.gov.sg", label: "Ministry of National Development" },
    { url: "https://www.parliament.gov.sg/news/topics/housing", label: "Parliament - Housing" },
    { url: "https://www.data.gov.sg", label: "Data.gov.sg" },
    { url: "https://www.reach.gov.sg", label: "REACH Singapore" },
  ],
  cpf_changes: [
    { url: "https://www.cpf.gov.sg", label: "CPF Board" },
    { url: "https://www.mof.gov.sg", label: "Ministry of Finance" },
    { url: "https://www.mom.gov.sg", label: "Ministry of Manpower" },
    { url: "https://www.parliament.gov.sg/news/topics/central-provident-fund", label: "Parliament - CPF" },
    { url: "https://www.reach.gov.sg", label: "REACH Singapore" },
  ],
};

function buildSourceList(
  presetId: PresetScenarioId | undefined,
  searchLimit: number,
  configuredSources: SourceConfig[]
) {
  const preferred = presetId ? PRESET_SOURCE_MAP[presetId] ?? [] : [];
  const custom = configuredSources.map((source) => ({ url: source.url, label: source.label }));
  const merged = [...custom, ...preferred, ...BASE_POLICY_SOURCES].filter(
    (source, index, list) => list.findIndex((item) => item.url === source.url) === index
  );
  return merged.slice(0, Math.max(1, searchLimit));
}

function buildScrapeGoal(sourceLabel: string, scenarioTitle: string, scenarioQuery: string) {
  return `You are an expert Singapore public-policy researcher using this page as a primary source for a policy planning brief.

Study the page in depth and return a JSON object with:
- title: page title
- publisher: organization name
- publishDate: date if visible
- policySummary: 1-2 paragraphs on what this source says the policy is
- officialRationale: array of reasons, justifications, or policy objectives
- implementationDetails: array of operational details, eligibility rules, timing, exemptions, or rollout mechanics
- affectedGroups: array of concrete stakeholder groups mentioned or strongly implied
- supportMeasures: array of offsets, subsidies, grants, communications measures, or implementation mitigations
- risksAndCriticisms: array of downside risks, criticisms, tradeoffs, or likely pain points
- evidencePoints: array of factual datapoints, figures, or institutional claims
- narrativeSignals: array of likely public narratives, misunderstandings, or politically salient framings
- excerpts: array of objects with:
  - section: one of policy_summary|rationale|implementation|stakeholders|support|risk|evidence|narrative
  - text: a highly relevant passage of 80-220 words
  - tags: array of descriptive tags

Requirements:
- Focus on content useful to a policy planner, not generic website description.
- Capture both first-order effects and second-order implications.
- Prefer concrete facts, thresholds, dates, affected segments, and delivery constraints.
- If the page is broad, prioritize details relevant to "${scenarioTitle}" and "${scenarioQuery}".
- Do not invent missing facts.`;
}

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
    const client = new TinyFish({ timeout: SCRAPE_TIMEOUT_MS });
    let totalDocs = 0;
    const scenarioQuery = req.nextUrl.searchParams.get("policyChange") ?? "GST increase Singapore";
    const scenarioTitle = req.nextUrl.searchParams.get("title") ?? "Policy scenario";
    const presetId = (req.nextUrl.searchParams.get("presetId") ?? undefined) as PresetScenarioId | undefined;
    const configuredSources = (() => {
      const raw = req.nextUrl.searchParams.get("sources");
      if (!raw) return [] as SourceConfig[];
      try {
        const parsed = JSON.parse(raw) as SourceConfig[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [] as SourceConfig[];
      }
    })();

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
      const requestedLimit = Number(req.nextUrl.searchParams.get("searchLimit") ?? BASE_POLICY_SOURCES.length);
      const searchLimit = Number.isFinite(requestedLimit)
        ? Math.min(8, Math.max(1, Math.floor(requestedLimit)))
        : BASE_POLICY_SOURCES.length;
      const sources = buildSourceList(presetId, searchLimit, configuredSources);

      await saveRunMeta(runId, { status: "scraping", updatedAt: new Date().toISOString() });
      send({ type: "started", totalSources: sources.length });

      for (const source of sources) {
        if (aborted) break;
        send({ type: "source_started", url: source.url, label: source.label });

        try {
          const goal = buildScrapeGoal(source.label, scenarioTitle, scenarioQuery);

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

          const structuredExcerpts = Array.isArray(resultData.excerpts)
            ? (resultData.excerpts as Array<{ section?: string; text?: string; tags?: string[] }>)
            : [];

          const summaryBlocks = [
            resultData.policySummary ? {
              section: "policy_summary",
              text: String(resultData.policySummary),
              tags: ["policy summary"],
            } : null,
            Array.isArray(resultData.officialRationale) && (resultData.officialRationale as unknown[]).length > 0 ? {
              section: "rationale",
              text: `Official rationale:\n- ${(resultData.officialRationale as string[]).join("\n- ")}`,
              tags: ["rationale"],
            } : null,
            Array.isArray(resultData.implementationDetails) && (resultData.implementationDetails as unknown[]).length > 0 ? {
              section: "implementation",
              text: `Implementation details:\n- ${(resultData.implementationDetails as string[]).join("\n- ")}`,
              tags: ["implementation"],
            } : null,
            Array.isArray(resultData.affectedGroups) && (resultData.affectedGroups as unknown[]).length > 0 ? {
              section: "stakeholders",
              text: `Affected groups:\n- ${(resultData.affectedGroups as string[]).join("\n- ")}`,
              tags: ["stakeholders"],
            } : null,
            Array.isArray(resultData.supportMeasures) && (resultData.supportMeasures as unknown[]).length > 0 ? {
              section: "support",
              text: `Support and mitigation measures:\n- ${(resultData.supportMeasures as string[]).join("\n- ")}`,
              tags: ["support measures"],
            } : null,
            Array.isArray(resultData.risksAndCriticisms) && (resultData.risksAndCriticisms as unknown[]).length > 0 ? {
              section: "risk",
              text: `Risks and criticisms:\n- ${(resultData.risksAndCriticisms as string[]).join("\n- ")}`,
              tags: ["risk signals"],
            } : null,
            Array.isArray(resultData.evidencePoints) && (resultData.evidencePoints as unknown[]).length > 0 ? {
              section: "evidence",
              text: `Evidence points:\n- ${(resultData.evidencePoints as string[]).join("\n- ")}`,
              tags: ["evidence"],
            } : null,
            Array.isArray(resultData.narrativeSignals) && (resultData.narrativeSignals as unknown[]).length > 0 ? {
              section: "narrative",
              text: `Narrative signals:\n- ${(resultData.narrativeSignals as string[]).join("\n- ")}`,
              tags: ["narrative"],
            } : null,
          ].filter(Boolean) as Array<{ section: string; text: string; tags: string[] }>;

          const excerpts = [
            ...summaryBlocks,
            ...structuredExcerpts
              .filter((item) => item && typeof item.text === "string" && item.text.trim().length > 0)
              .map((item) => ({
                section: item.section ?? "evidence",
                text: item.text!.trim(),
                tags: Array.isArray(item.tags) ? item.tags : [],
              })),
          ];

          if (aborted) break;

          let docCount = 0;
          for (const excerpt of excerpts) {
            if (aborted) break;

            const doc: SourceDocument = {
              id: randomUUID(),
              runId,
              url: source.url,
              publisher: String(resultData.publisher ?? source.label),
              title: `${String(resultData.title ?? source.label)}${excerpt.section ? ` [${excerpt.section}]` : ""}`,
              publishDate: resultData.publishDate ? String(resultData.publishDate) : undefined,
              excerpt: excerpt.text,
              relevanceTags: Array.from(
                new Set([
                  excerpt.section,
                  ...(excerpt.tags ?? []),
                  ...(Array.isArray(resultData.affectedGroups) ? (resultData.affectedGroups as string[]).slice(0, 3) : []),
                  ...(Array.isArray(resultData.narrativeSignals) ? (resultData.narrativeSignals as string[]).slice(0, 2) : []),
                ].filter(Boolean))
              ),
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
