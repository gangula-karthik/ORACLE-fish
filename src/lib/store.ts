"use client";

import { create } from "zustand";
import type {
  Run,
  ScenarioInput,
  SourceDocument,
  PersonaProfile,
  AgentTurn,
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
  roundSummaries: RoundSummary[];
  reportSections: ReportSection[];
  reportOutline: Array<{ id: string; title: string }>;
  currentSection: string | null;

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
  addRoundSummary: (summary: RoundSummary) => void;
  setReportOutline: (outline: Array<{ id: string; title: string }>) => void;
  setCurrentSection: (id: string | null) => void;
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
  roundSummaries: [],
  reportSections: [],
  reportOutline: [],
  currentSection: null,
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
  addRoundSummary: (summary) =>
    set((s) => ({ roundSummaries: [...s.roundSummaries, summary] })),
  setReportOutline: (outline) => set({ reportOutline: outline }),
  setCurrentSection: (id) => set({ currentSection: id }),
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
      roundSummaries: entry.roundSummaries,
      reportSections: entry.reportSections,
      reportOutline: entry.reportSections.map((s) => ({ id: s.id, title: s.title })),
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
