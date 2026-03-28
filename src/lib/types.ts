// ─── Run ─────────────────────────────────────────────────────────────────────

export type RunStatus =
  | "created"
  | "scraping"
  | "scrape_complete"
  | "generating_personas"
  | "personas_ready"
  | "simulating"
  | "simulation_complete"
  | "generating_report"
  | "complete"
  | "error";

export interface Run {
  runId: string;
  title: string;
  status: RunStatus;
  scenario: ScenarioInput;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

// ─── Scenario ────────────────────────────────────────────────────────────────

export type PresetScenarioId = "gst_9_to_10" | "transport_fare_hike" | "hdb_policy" | "cpf_changes";

export interface ScenarioInput {
  presetId?: PresetScenarioId;
  title: string;
  description: string;
  policyChange: string;
  roundCount: number;
  personaCount: number;
  searchLimit: number;
  sources: SourceConfig[];
}

export interface SourceConfig {
  url: string;
  label: string;
  enabled: boolean;
}

export const PRESET_SCENARIOS: Record<PresetScenarioId, Omit<ScenarioInput, "roundCount" | "personaCount" | "searchLimit" | "sources">> = {
  gst_9_to_10: {
    presetId: "gst_9_to_10",
    title: "GST Increase: 9% → 10%",
    description: "Singapore proposes raising the Goods and Services Tax from 9% to 10%.",
    policyChange:
      "The Singapore government is proposing to increase the Goods and Services Tax (GST) from the current rate of 9% to 10%, effective from 1 January 2026. This is in addition to the GST Voucher scheme enhancements and Assurance Package support measures.",
  },
  transport_fare_hike: {
    presetId: "transport_fare_hike",
    title: "Public Transport Fare Hike",
    description: "Bus and MRT fares proposed to increase by up to 8 cents.",
    policyChange:
      "The Public Transport Council has approved a fare adjustment of up to 8 cents per journey for bus and MRT services, effective from December 2025.",
  },
  hdb_policy: {
    presetId: "hdb_policy",
    title: "HDB BTO Eligibility Changes",
    description: "New income ceiling and eligibility rules for HDB BTO flats.",
    policyChange:
      "HDB announces revised income ceiling of $14,000 for BTO applications and new restrictions on second-timer priority schemes.",
  },
  cpf_changes: {
    presetId: "cpf_changes",
    title: "CPF Contribution Rate Changes",
    description: "CPF contribution rates for workers above 55 to be increased.",
    policyChange:
      "The CPF contribution rates for workers aged 55–60 will be raised by 1.5 percentage points, with employer contributions increasing by 1 percentage point.",
  },
};

export const DEFAULT_SOURCES: SourceConfig[] = [
  { url: "https://www.parliament.gov.sg/news/topics/gst", label: "Parliament.gov.sg", enabled: true },
  { url: "https://www.mof.gov.sg/singaporebudget", label: "MOF Budget", enabled: true },
  { url: "https://data.gov.sg", label: "Data.gov.sg", enabled: false },
];

// ─── Source Documents ─────────────────────────────────────────────────────────

export interface SourceDocument {
  id: string;
  runId: string;
  url: string;
  publisher: string;
  title: string;
  publishDate?: string;
  excerpt: string;
  relevanceTags: string[];
  scrapedAt: string;
}

// ─── Personas ────────────────────────────────────────────────────────────────

export type PersonaArchetype =
  | "hdb_family"
  | "hawker"
  | "pmet"
  | "retiree"
  | "student"
  | "sme_owner"
  | "gig_worker"
  | "civil_servant"
  | "landlord"
  | "lower_income";

export interface PersonaProfile {
  id: string;
  runId: string;
  archetype: PersonaArchetype;
  name: string;
  age: number;
  gender: string;
  ethnicity: string;
  occupation: string;
  housingType: string;
  monthlyIncome: string;
  familyStatus: string;
  topConcerns: string[];
  initialStance: "supportive" | "neutral" | "opposed" | "uncertain";
  bio: string;
}

// ─── Simulation ───────────────────────────────────────────────────────────────

export interface AgentTurn {
  personaId: string;
  personaName: string;
  archetype: PersonaArchetype;
  round: number;
  reaction: string;
  sentiment: "positive" | "neutral" | "negative";
  sentimentScore: number; // -1 to 1
  keyPoints: string[];
  memoryContext?: string;
}

export interface RoundSummary {
  round: number;
  runId: string;
  overallSentiment: number; // -1 to 1
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
  };
  topConcerns: string[];
  archetypeStances: Record<PersonaArchetype, "supportive" | "neutral" | "opposed">;
  summary: string;
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface ReportSection {
  id: string;
  title: string;
  content: string;
  order: number;
}

export interface Report {
  runId: string;
  title: string;
  executiveSummary: string;
  sections: ReportSection[];
  generatedAt: string;
}

// ─── SSE Events ──────────────────────────────────────────────────────────────

// Scrape stream
export type ScrapeEvent =
  | { type: "started"; totalSources: number }
  | { type: "source_started"; url: string; label: string }
  | { type: "progress"; url: string; message: string }
  | { type: "document"; document: SourceDocument }
  | { type: "source_complete"; url: string; docCount: number }
  | { type: "complete"; totalDocs: number }
  | { type: "error"; message: string };

// Simulate stream
export type SimulateEvent =
  | { type: "round_started"; round: number; totalRounds: number }
  | { type: "agent_response"; turn: AgentTurn }
  | { type: "memory_saved"; personaId: string }
  | { type: "round_summary"; summary: RoundSummary }
  | { type: "complete"; totalRounds: number }
  | { type: "error"; message: string };

// Report stream
export type ReportEvent =
  | { type: "outline"; sections: Array<{ id: string; title: string }> }
  | { type: "section_started"; sectionId: string; title: string }
  | { type: "section_complete"; section: ReportSection }
  | { type: "complete"; reportId: string }
  | { type: "error"; message: string };

export type AnyStreamEvent = ScrapeEvent | SimulateEvent | ReportEvent;
