import Supermemory from "supermemory";
import type { PersonaProfile, RoundSummary, SourceDocument, ReportSection, ScenarioInput } from "./types";

// Lazy-initialize so the client is only created during request handling, not at build time
let _client: Supermemory | null = null;
function getClient(): Supermemory {
  if (!_client) {
    _client = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY });
  }
  return _client;
}

// Container tag format: sg_run_{runId}_{category}
function tag(runId: string, category: string) {
  return `sgrun_${runId}_${category}`.replace(/-/g, "_");
}

// ─── Run metadata ────────────────────────────────────────────────────────────

export async function saveRunMeta(runId: string, data: Record<string, unknown>) {
  await getClient().add({
    content: JSON.stringify(data),
    containerTag: tag(runId, "meta"),
    metadata: {
      runId,
      type: "run_meta",
      title: typeof data.title === "string" ? data.title : "",
      status: typeof data.status === "string" ? data.status : "",
    },
  });
}

export async function getRunMeta(runId: string): Promise<Record<string, unknown> | null> {
  const res = await getClient().search.documents({
    q: "run metadata status",
    containerTags: [tag(runId, "meta")],
    limit: 1,
  });
  const doc = res.results?.[0];
  if (!doc) return null;
  try {
    return JSON.parse(doc.content ?? "{}");
  } catch {
    return null;
  }
}

// ─── Scenario ────────────────────────────────────────────────────────────────

export async function saveScenario(runId: string, scenario: ScenarioInput) {
  await getClient().add({
    content: `Policy scenario: ${scenario.title}\n\n${scenario.policyChange}`,
    containerTag: tag(runId, "scenario"),
    metadata: { runId, type: "scenario", title: scenario.title },
  });
}

// ─── Source Documents ────────────────────────────────────────────────────────

export async function saveSourceDocument(runId: string, doc: SourceDocument) {
  await getClient().add({
    content: `[${doc.publisher}] ${doc.title}\n${doc.url}\n\n${doc.excerpt}`,
    containerTag: tag(runId, "sources"),
    metadata: {
      runId,
      type: "source",
      docId: doc.id,
      url: doc.url,
      publisher: doc.publisher,
      title: doc.title,
      tags: doc.relevanceTags.join(","),
    },
  });
}

export async function searchSources(runId: string, query: string, limit = 5): Promise<string> {
  const res = await getClient().search.documents({
    q: query,
    containerTags: [tag(runId, "sources")],
    limit,
    chunkThreshold: 0.3,
  });
  return (res.results ?? []).map((r) => r.content ?? "").join("\n\n---\n\n");
}

// ─── Personas ────────────────────────────────────────────────────────────────

export async function savePersona(runId: string, persona: PersonaProfile) {
  await getClient().add({
    content: `Persona: ${persona.name} (${persona.archetype})\n${persona.bio}\nConcerns: ${persona.topConcerns.join(", ")}\nStance: ${persona.initialStance}`,
    containerTag: tag(runId, "personas"),
    metadata: {
      runId,
      type: "persona",
      personaId: persona.id,
      archetype: persona.archetype,
      name: persona.name,
    },
  });
}

export async function getPersonaMemory(runId: string, personaId: string, query: string): Promise<string> {
  const res = await getClient().search.documents({
    q: query,
    containerTags: [tag(runId, "rounds")],
    limit: 3,
    chunkThreshold: 0.3,
  });
  return (res.results ?? []).map((r) => r.content ?? "").join("\n\n");
}

// ─── Rounds ──────────────────────────────────────────────────────────────────

export async function saveAgentTurn(runId: string, round: number, personaId: string, personaName: string, reaction: string) {
  await getClient().add({
    content: `Round ${round} - ${personaName}: ${reaction}`,
    containerTag: tag(runId, "rounds"),
    metadata: { runId, type: "agent_turn", round: String(round), personaId, personaName },
  });
}

export async function saveRoundSummary(runId: string, summary: RoundSummary) {
  await getClient().add({
    content: `Round ${summary.round} Summary: ${summary.summary}\nSentiment: ${summary.overallSentiment.toFixed(2)}\nTop concerns: ${summary.topConcerns.join(", ")}`,
    containerTag: tag(runId, "rounds"),
    metadata: { runId, type: "round_summary", round: String(summary.round) },
  });
}

// ─── Report ──────────────────────────────────────────────────────────────────

export async function saveReportSection(runId: string, section: ReportSection) {
  await getClient().add({
    content: `## ${section.title}\n\n${section.content}`,
    containerTag: tag(runId, "report"),
    metadata: { runId, type: "report_section", sectionId: section.id, title: section.title, order: String(section.order) },
  });
}

export async function getFullReport(runId: string): Promise<string> {
  const res = await getClient().search.documents({
    q: "report section policy impact",
    containerTags: [tag(runId, "report")],
    limit: 20,
  });
  return (res.results ?? [])
    .sort((a, b) => {
      const ao = Number((a as { metadata?: { order?: string } }).metadata?.order ?? 0);
      const bo = Number((b as { metadata?: { order?: string } }).metadata?.order ?? 0);
      return ao - bo;
    })
    .map((r) => r.content ?? "")
    .join("\n\n");
}
