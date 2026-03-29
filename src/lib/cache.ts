import type {
  ScenarioInput,
  SourceDocument,
  PersonaProfile,
  AgentTurn,
  InteractionEvent,
  RoundSummary,
  ReportSection,
} from "./types";

export interface CacheEntry {
  cacheKey: string;
  scenario: ScenarioInput;
  sourceDocs: SourceDocument[];
  personas: PersonaProfile[];
  agentTurns: AgentTurn[];
  interactions?: InteractionEvent[];
  roundSummaries: RoundSummary[];
  reportSections: ReportSection[];
  cachedAt: string;
}

const PREFIX = "sgpolicy_v1_";

/** Stable key based on the scenario identity + run parameters. */
function makeKey(scenario: ScenarioInput): string {
  const raw = [
    scenario.presetId ?? scenario.title,
    scenario.policyChange,
    scenario.roundCount,
    scenario.personaCount,
    scenario.searchLimit,
  ].join("|");
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36);
}

export function getCachedRun(scenario: ScenarioInput): CacheEntry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + makeKey(scenario));
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

export function saveCachedRun(
  scenario: ScenarioInput,
  payload: Pick<CacheEntry, "sourceDocs" | "personas" | "agentTurns" | "interactions" | "roundSummaries" | "reportSections">
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const key = makeKey(scenario);
    const entry: CacheEntry = { cacheKey: key, scenario, cachedAt: new Date().toISOString(), ...payload };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded — silently ignore
  }
}

export function clearCachedRun(scenario: ScenarioInput): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(PREFIX + makeKey(scenario));
  } catch {}
}
