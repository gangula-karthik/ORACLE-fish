"use client";

import { create } from "zustand";
import type {
  Run,
  SourceDocument,
  PersonaProfile,
  AgentTurn,
  InteractionEvent,
  RoundSummary,
  ReportSection,
  RunStatus,
} from "./types";
import type { CacheEntry } from "./cache";

export type AppStep = "setup" | "scrape" | "simulate" | "report";

interface SimulatorState {
  // Current run
  run: Run | null;
  step: AppStep;

  // Step data
  sourceDocs: SourceDocument[];
  scrapeLog: Array<{ time: string; message: string; type: "info" | "success" | "error" }>;
  personas: PersonaProfile[];
  agentTurns: AgentTurn[];
  interactions: InteractionEvent[];
  roundSummaries: RoundSummary[];
  reportSections: ReportSection[];
  reportOutline: Array<{ id: string; title: string }>;
  currentSection: string | null;
  sectionEvidence: Record<string, ReportSection["evidence"]>;

  // UI state
  isLoading: boolean;
  error: string | null;
  fromCache: boolean;
  cachedAt: string | null;

  // Actions
  setRun: (run: Run) => void;
  setStep: (step: AppStep) => void;
  setStatus: (status: RunStatus) => void;
  addSourceDoc: (doc: SourceDocument) => void;
  addScrapeLog: (message: string, type?: "info" | "success" | "error") => void;
  setPersonas: (personas: PersonaProfile[]) => void;
  addAgentTurn: (turn: AgentTurn) => void;
  addInteraction: (interaction: InteractionEvent) => void;
  addRoundSummary: (summary: RoundSummary) => void;
  setReportOutline: (outline: Array<{ id: string; title: string }>) => void;
  setCurrentSection: (id: string | null) => void;
  setSectionEvidence: (sectionId: string, evidence: NonNullable<ReportSection["evidence"]>) => void;
  addReportSection: (section: ReportSection) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  restoreFromCache: (entry: CacheEntry) => void;
  reset: () => void;
}

const initialState = {
  run: null,
  step: "setup" as AppStep,
  sourceDocs: [],
  scrapeLog: [],
  personas: [],
  agentTurns: [],
  interactions: [],
  roundSummaries: [],
  reportSections: [],
  reportOutline: [],
  currentSection: null,
  sectionEvidence: {},
  isLoading: false,
  error: null,
  fromCache: false,
  cachedAt: null,
};

export const useSimulatorStore = create<SimulatorState>((set) => ({
  ...initialState,

  setRun: (run) => set({ run }),
  setStep: (step) => set({ step }),
  setStatus: (status) =>
    set((s) => ({ run: s.run ? { ...s.run, status } : null })),
  addSourceDoc: (doc) =>
    set((s) => ({ sourceDocs: [...s.sourceDocs, doc] })),
  addScrapeLog: (message, type = "info") =>
    set((s) => ({
      scrapeLog: [
        ...s.scrapeLog,
        { time: new Date().toLocaleTimeString("en-SG"), message, type },
      ],
    })),
  setPersonas: (personas) => set({ personas }),
  addAgentTurn: (turn) =>
    set((s) => ({ agentTurns: [...s.agentTurns, turn] })),
  addInteraction: (interaction) =>
    set((s) => ({ interactions: [...s.interactions, interaction] })),
  addRoundSummary: (summary) =>
    set((s) => ({ roundSummaries: [...s.roundSummaries, summary] })),
  setReportOutline: (outline) => set({ reportOutline: outline }),
  setCurrentSection: (id) => set({ currentSection: id }),
  setSectionEvidence: (sectionId, evidence) =>
    set((s) => ({
      sectionEvidence: {
        ...s.sectionEvidence,
        [sectionId]: evidence,
      },
    })),
  addReportSection: (section) =>
    set((s) => ({
      reportSections: [...s.reportSections, section].sort((a, b) => a.order - b.order),
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  restoreFromCache: (entry) =>
    set({
      sourceDocs: entry.sourceDocs,
      personas: entry.personas,
      agentTurns: entry.agentTurns,
      interactions: entry.interactions ?? [],
      roundSummaries: entry.roundSummaries,
      reportSections: entry.reportSections,
      reportOutline: entry.reportSections.map((s) => ({ id: s.id, title: s.title })),
      sectionEvidence: Object.fromEntries(entry.reportSections.map((s) => [s.id, s.evidence ?? []])),
      run: {
        runId: `cached_${entry.cacheKey}`,
        title: entry.scenario.title,
        status: "complete",
        scenario: entry.scenario,
        createdAt: entry.cachedAt,
        updatedAt: entry.cachedAt,
      },
      step: "report",
      isLoading: false,
      error: null,
      fromCache: true,
      cachedAt: entry.cachedAt,
    }),

  reset: () => set(initialState),
}));
