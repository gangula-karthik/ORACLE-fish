"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PRESET_SCENARIOS, DEFAULT_SOURCES } from "@/lib/types";
import type { ScenarioInput, PresetScenarioId } from "@/lib/types";
import { useSimulatorStore } from "@/lib/store";
import { getCachedRun } from "@/lib/cache";
import { cn } from "@/lib/utils";

const PRESETS = Object.keys(PRESET_SCENARIOS) as PresetScenarioId[];

export function ScenarioSetup() {
  const { setRun, setStep, setLoading, setError, isLoading, restoreFromCache } = useSimulatorStore();
  const [selected, setSelected] = useState<PresetScenarioId | "custom">("gst_9_to_10");
  const [customPolicy, setCustomPolicy] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [roundCount, setRoundCount] = useState(3);
  const [personaCount, setPersonaCount] = useState(10);
  const [searchLimit, setSearchLimit] = useState(2);

  function buildScenario(): ScenarioInput | null {
    if (selected === "custom") {
      if (!customTitle.trim() || !customPolicy.trim()) return null;
      return { title: customTitle, description: "", policyChange: customPolicy, roundCount, personaCount, searchLimit, sources: DEFAULT_SOURCES };
    }
    const preset = PRESET_SCENARIOS[selected];
    return { ...preset, roundCount, personaCount, searchLimit, sources: DEFAULT_SOURCES };
  }

  const cachedResult = (() => {
    const s = buildScenario();
    return s ? getCachedRun(s) : null;
  })();

  async function handleStart() {
    setLoading(true);
    setError(null);

    let scenario: ScenarioInput;
    if (selected === "custom") {
      if (!customTitle.trim() || !customPolicy.trim()) {
        setError("Please provide a title and policy description.");
        setLoading(false);
        return;
      }
      scenario = { title: customTitle, description: "", policyChange: customPolicy, roundCount, personaCount, searchLimit, sources: DEFAULT_SOURCES };
    } else {
      const preset = PRESET_SCENARIOS[selected];
      scenario = { ...preset, roundCount, personaCount, searchLimit, sources: DEFAULT_SOURCES };
    }

    // Cache hit — restore instantly, no API calls needed
    const cached = getCachedRun(scenario);
    if (cached) {
      restoreFromCache(cached);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scenario, searchLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create run");
      setRun(data.run);
      setStep("scrape");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-start justify-center pt-16 pb-16 px-6">
      <div className="w-full max-w-lg space-y-8">

        {/* Hero */}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Oracle Fish</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Simulate how Singapore citizens respond to government policy using AI-powered personas.
          </p>
        </div>

        {/* Scenario list */}
        <div className="space-y-1">
          {PRESETS.map((id) => {
            const s = PRESET_SCENARIOS[id];
            const isSelected = selected === id;
            const presetScenario: ScenarioInput = { ...s, roundCount, personaCount, searchLimit, sources: DEFAULT_SOURCES };
            const isCached = !!getCachedRun(presetScenario);
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                className={cn(
                  "w-full text-left px-4 py-3.5 rounded-lg border transition-all duration-100",
                  isSelected
                    ? "border-foreground bg-foreground text-background"
                    : "border-transparent hover:border-border hover:bg-muted/40"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("text-sm font-medium", !isSelected && "text-foreground")}>{s.title}</p>
                  {isCached && (
                    <span className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0",
                      isSelected ? "bg-background/15 text-background/80" : "bg-muted text-muted-foreground"
                    )}>
                      cached
                    </span>
                  )}
                </div>
                <p className={cn("text-xs mt-0.5 leading-relaxed", isSelected ? "text-background/60" : "text-muted-foreground")}>
                  {s.description}
                </p>
              </button>
            );
          })}

          {/* Custom */}
          <button
            onClick={() => setSelected("custom")}
            className={cn(
              "w-full text-left px-4 py-3.5 rounded-lg border transition-all duration-100",
              selected === "custom"
                ? "border-foreground bg-foreground text-background"
                : "border-dashed border-border hover:border-foreground/30 hover:bg-muted/40"
            )}
          >
            <p className={cn("text-sm font-medium", selected !== "custom" && "text-muted-foreground")}>Custom policy</p>
            <p className={cn("text-xs mt-0.5", selected === "custom" ? "text-background/60" : "text-muted-foreground/60")}>
              Define your own scenario
            </p>
          </button>
        </div>

        {/* Custom inputs */}
        {selected === "custom" && (
          <div className="space-y-2">
            <input
              className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/15 transition-colors"
              placeholder="Policy title"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
            />
            <textarea
              className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/15 resize-none transition-colors"
              rows={3}
              placeholder="Describe the policy change..."
              value={customPolicy}
              onChange={(e) => setCustomPolicy(e.target.value)}
            />
          </div>
        )}

        {/* Settings */}
        <div className="flex flex-wrap items-start gap-8">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Rounds</p>
            <div className="flex gap-1.5">
              {[2, 3, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRoundCount(n)}
                  className={cn(
                    "w-9 h-8 rounded-md text-sm font-medium border transition-all",
                    roundCount === n
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Personas</p>
            <div className="flex gap-1.5">
              {[5, 8, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setPersonaCount(n)}
                  className={cn(
                    "w-9 h-8 rounded-md text-sm font-medium border transition-all",
                    personaCount === n
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Searches</p>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setSearchLimit(n)}
                  className={cn(
                    "w-9 h-8 rounded-md text-sm font-medium border transition-all",
                    searchLimit === n
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Fewer TinyFish searches makes the scrape step finish faster.
            </p>
          </div>
        </div>

        {/* CTA */}
        <Button onClick={handleStart} disabled={isLoading} className="w-full h-10 font-medium">
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              Loading...
            </span>
          ) : cachedResult ? (
            "Load cached result →"
          ) : (
            "Start simulation"
          )}
        </Button>

        <p className="text-[11px] text-muted-foreground/50 text-center">
          Sources: Parliament.gov.sg · MOF Budget · data.gov.sg
        </p>

      </div>
    </div>
  );
}
