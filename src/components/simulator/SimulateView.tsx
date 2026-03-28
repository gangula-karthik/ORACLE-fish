"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSimulatorStore } from "@/lib/store";
import type { SimulateEvent, PersonaProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

const ARCHETYPE_LABELS: Record<string, string> = {
  hdb_family: "HDB Family",
  hawker: "Hawker",
  pmet: "PMET",
  retiree: "Retiree",
  student: "Student",
  sme_owner: "SME Owner",
  gig_worker: "Gig Worker",
  civil_servant: "Civil Servant",
  landlord: "Landlord",
  lower_income: "Lower Income",
};

const SENTIMENT_COLOR = {
  positive: "text-green-600 dark:text-green-400",
  neutral: "text-amber-500",
  negative: "text-red-500",
};

const SENTIMENT_BAR = {
  positive: "bg-green-500",
  neutral: "bg-amber-400",
  negative: "bg-red-500",
};

export function SimulateView() {
  const {
    run,
    personas,
    agentTurns,
    roundSummaries,
    addAgentTurn,
    addRoundSummary,
    setPersonas,
    setStep,
    setStatus,
    setError,
    setLoading,
    isLoading,
  } = useSimulatorStore();

  const hasStarted = useRef(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"generating_personas" | "simulating" | "done">("generating_personas");

  useEffect(() => {
    if (!run || hasStarted.current) return;
    hasStarted.current = true;
    runPipeline();
  }, [run]);

  async function runPipeline() {
    if (!run) return;
    setLoading(true);
    setPhase("generating_personas");
    setStatus("generating_personas");

    try {
      // Step 1: Generate personas
      const personaRes = await fetch(`/api/runs/${run.runId}/personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: run.scenario }),
      });
      const personaData = await personaRes.json();
      if (!personaRes.ok) throw new Error(personaData.error ?? "Failed to generate personas");
      setPersonas(personaData.personas);
      setStatus("personas_ready");

      // Step 2: Simulate
      setPhase("simulating");
      setStatus("simulating");

      const params = new URLSearchParams({
        scenario: encodeURIComponent(JSON.stringify(run.scenario)),
        personas: encodeURIComponent(JSON.stringify(personaData.personas)),
      });

      const res = await fetch(`/api/runs/${run.runId}/simulate?${params}`);
      if (!res.body) throw new Error("No stream body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: SimulateEvent = JSON.parse(line.slice(6));
            handleSimEvent(event, personaData.personas);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleSimEvent(event: SimulateEvent, _personas: PersonaProfile[]) {
    switch (event.type) {
      case "round_started":
        setCurrentRound(event.round);
        setActivePersonaId(null);
        break;
      case "agent_response":
        setActivePersonaId(event.turn.personaId);
        addAgentTurn(event.turn);
        break;
      case "memory_saved":
        break;
      case "round_summary":
        addRoundSummary(event.summary);
        setActivePersonaId(null);
        break;
      case "complete":
        setPhase("done");
        setStatus("simulation_complete");
        setLoading(false);
        break;
      case "error":
        setError(event.message);
        break;
    }
  }

  const totalRounds = run?.scenario.roundCount ?? 3;
  const progress = totalRounds > 0 ? (currentRound / totalRounds) * 100 : 0;
  const summaryCount = roundSummaries.length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
      <div className="sticky top-18 z-10 rounded-xl border border-border/70 bg-background/90 px-4 py-3 shadow-sm backdrop-blur-md">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold tracking-tight">Simulation Workspace</span>
              <div className={cn("h-1.5 w-1.5 rounded-full", isLoading ? "bg-amber-400 animate-pulse" : phase === "done" ? "bg-green-500" : "bg-muted-foreground/30")} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>{personas.length} personas</span>
              <span>{summaryCount} / {totalRounds} rounds summarized</span>
              <span>{phase === "simulating" ? `Round ${currentRound} in progress` : phase === "done" ? "Simulation complete" : "Preparing personas"}</span>
            </div>
            {(phase === "simulating" || phase === "done") && (
              <Progress value={progress} className="h-1.5 max-w-md" />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {phase === "done" ? (
              <Button onClick={() => setStep("report")} size="lg" className="min-w-40 font-semibold">
                Generate Report
              </Button>
            ) : (
              <Button size="lg" disabled className="min-w-40 font-semibold">
                Generating Report
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.2fr_0.95fr] items-start">
      {/* Left: Persona roster */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Personas</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {phase === "generating_personas"
              ? "Generating Singapore citizen profiles..."
              : `${personas.length} active agents`}
          </p>
        </div>

        <div className="space-y-2">
          {phase === "generating_personas" && personas.length === 0 && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}
          {personas.map((p) => {
            const isActive = activePersonaId === p.id;
            const turns = agentTurns.filter((t) => t.personaId === p.id);
            const lastTurn = turns[turns.length - 1];
            return (
              <Card
                key={p.id}
                className={cn(
                  "transition-all",
                  isActive && "ring-2 ring-foreground shadow-md"
                )}
              >
                <CardContent className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold truncate">{p.name}</p>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {ARCHETYPE_LABELS[p.archetype] ?? p.archetype}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <p className="min-w-0 truncate text-muted-foreground">{p.occupation}</p>
                    {lastTurn ? (
                      <div className={cn("shrink-0 font-medium", SENTIMENT_COLOR[lastTurn.sentiment])}>
                        {lastTurn.sentimentScore > 0 ? "+" : ""}{lastTurn.sentimentScore.toFixed(2)}
                      </div>
                    ) : null}
                  </div>
                  {isActive ? (
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Responding...
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Middle: Live feed */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Live Feed</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {phase === "simulating" ? `Round ${currentRound} of ${totalRounds}` : phase === "done" ? "Complete" : "Preparing..."}
            </p>
          </div>
          <div className={cn("w-1.5 h-1.5 rounded-full", isLoading ? "bg-amber-400 animate-pulse" : phase === "done" ? "bg-green-500" : "bg-muted-foreground/30")} />
        </div>

        <div className="space-y-2.5">
          {agentTurns.map((turn, i) => (
            <div key={i}>
              {i === 0 || agentTurns[i - 1].round !== turn.round ? (
                <div className="my-2 flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                    Round {turn.round}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <Card className="text-xs">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-semibold">{turn.personaName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {ARCHETYPE_LABELS[turn.archetype] ?? turn.archetype}
                    </Badge>
                    <span className={cn("ml-auto text-[10px] font-medium", SENTIMENT_COLOR[turn.sentiment])}>
                      {turn.sentiment}
                    </span>
                  </div>
                  <p className="line-clamp-4 text-muted-foreground leading-relaxed">{turn.reaction}</p>
                  <div className="flex gap-1 flex-wrap">
                    {turn.keyPoints.map((kp, j) => (
                      <Badge key={j} variant="secondary" className="text-[10px]">{kp}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Round summaries */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Round Summaries</h2>
        <div className="space-y-3">
          {roundSummaries.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-12">
              Summaries will appear after each round...
            </p>
          )}
          {roundSummaries.map((summary) => (
            <Card key={summary.round}>
              <CardHeader className="px-4 pb-2 pt-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Round {summary.round}</span>
                  <span className={cn(
                    "text-xs font-medium",
                    summary.overallSentiment > 0.2 ? "text-green-600" :
                    summary.overallSentiment < -0.2 ? "text-red-500" : "text-amber-500"
                  )}>
                    {summary.overallSentiment > 0 ? "+" : ""}{summary.overallSentiment.toFixed(2)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 px-4 pb-4">
                <div className="space-y-1">
                  {(["positive", "neutral", "negative"] as const).map((s) => (
                    <div key={s} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-12">{s}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", SENTIMENT_BAR[s])}
                          style={{ width: `${(summary.sentimentBreakdown[s] / Math.max(personas.length, 1)) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-4 text-right">{summary.sentimentBreakdown[s]}</span>
                    </div>
                  ))}
                </div>
                <Separator />
                <p className="line-clamp-5 text-xs text-muted-foreground leading-relaxed">{summary.summary}</p>
                {summary.topConcerns.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {summary.topConcerns.map((c, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
