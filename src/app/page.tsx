"use client";

import { ChevronUp, ChevronDown } from "lucide-react";
import { useSimulatorStore } from "@/lib/store";
import type { AppStep } from "@/lib/store";
import { StepHeader } from "@/components/simulator/StepHeader";
import { ScenarioSetup } from "@/components/simulator/ScenarioSetup";
import { ScrapeView } from "@/components/simulator/ScrapeView";
import { SimulateView } from "@/components/simulator/SimulateView";
import { ReportView } from "@/components/simulator/ReportView";
import { cn } from "@/lib/utils";
const STEPS: AppStep[] = ["setup", "scrape", "simulate", "report"];

export default function Home() {
  const { step, error, setStep, run, scrapeLog, sourceDocs, personas } = useSimulatorStore();
  const currentIdx = STEPS.indexOf(step);
  const canGoBack = currentIdx > 0;
  const hasRun = Boolean(run);

  const scrapeDone = sourceDocs.length > 0 || scrapeLog.some((l) => l.message.includes("Scrape complete"));
  const simDone =
    personas.length > 0 ||
    run?.status === "simulation_complete" ||
    run?.status === "generating_report" ||
    run?.status === "complete";

  const canGoForward =
    (step === "setup" && hasRun) ||
    (step === "scrape" && scrapeDone) ||
    (step === "simulate" && simDone);

  function goBack() {
    if (canGoBack) setStep(STEPS[currentIdx - 1]);
  }

  function goForward() {
    if (canGoForward) setStep(STEPS[currentIdx + 1]);
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background">
      <StepHeader current={step} />

      {error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 max-w-lg w-full px-6">
          <div className="rounded-lg bg-destructive/8 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-start gap-2 shadow-sm">
            <span className="mt-0.5 shrink-0">⚠</span>
            {error}
          </div>
        </div>
      )}

      {/* Animated section */}
      <div className="flex-1 overflow-hidden relative">
        <div key={step} className="absolute inset-0 overflow-y-auto">
          {step === "setup" && <ScenarioSetup />}
          {step === "scrape" && <ScrapeView />}
          {step === "simulate" && <SimulateView />}
          {step === "report" && <ReportView />}
        </div>
      </div>

      {/* Floating nav */}
      <div className="fixed right-6 bottom-6 flex flex-col gap-2 z-20">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          aria-label="Previous section"
          className={cn(
            "w-9 h-9 rounded-full border bg-background flex items-center justify-center transition-all",
            canGoBack
              ? "text-foreground hover:bg-muted shadow-sm"
              : "opacity-20 cursor-not-allowed text-muted-foreground"
          )}
        >
          <ChevronUp size={15} />
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          aria-label="Next section"
          className={cn(
            "w-9 h-9 rounded-full border flex items-center justify-center transition-all",
            canGoForward
              ? "bg-foreground text-background border-foreground hover:opacity-80 shadow-sm"
              : "opacity-20 cursor-not-allowed bg-background text-muted-foreground"
          )}
        >
          <ChevronDown size={15} />
        </button>
      </div>
    </div>
  );
}
