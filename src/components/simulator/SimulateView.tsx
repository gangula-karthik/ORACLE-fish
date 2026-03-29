"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSimulatorStore } from "@/lib/store";
import type { SimulateEvent } from "@/lib/types";
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

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function SimulateView() {
  const {
    run,
    personas,
    agentTurns,
    interactions,
    roundSummaries,
    addAgentTurn,
    addInteraction,
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
  const [activeRoundTab, setActiveRoundTab] = useState(1);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"generating_personas" | "simulating" | "done">("generating_personas");

  const handleSimEvent = useCallback((event: SimulateEvent) => {
    switch (event.type) {
      case "round_started":
        setCurrentRound(event.round);
        setActiveRoundTab(event.round);
        setActivePersonaId(null);
        break;
      case "agent_response":
        setActivePersonaId(event.turn.personaId);
        addAgentTurn(event.turn);
        break;
      case "interaction":
        addInteraction(event.interaction);
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
  }, [addAgentTurn, addInteraction, addRoundSummary, setError, setLoading, setStatus]);

  const runPipeline = useCallback(async () => {
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
            handleSimEvent(event);
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
  }, [run, setLoading, setStatus, setPersonas, handleSimEvent, setError]);

  useEffect(() => {
    if (!run || hasStarted.current) return;
    hasStarted.current = true;
    runPipeline();
  }, [run, runPipeline]);

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
              <span>{interactions.length} interactions</span>
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

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.2fr_0.95fr] lg:items-start">
      {/* Left: Persona roster */}
      <div className="flex min-h-0 flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Personas</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {phase === "generating_personas"
              ? "Generating Singapore citizen profiles..."
              : `${personas.length} active agents`}
          </p>
        </div>

        <div className="h-[min(65vh,42rem)] min-h-0 space-y-2 overflow-y-auto pr-1">
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
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] uppercase">{lastTurn.actionType}</Badge>
                        <div className={cn("shrink-0 font-medium", SENTIMENT_COLOR[lastTurn.sentiment])}>
                          {lastTurn.sentimentScore > 0 ? "+" : ""}{lastTurn.sentimentScore.toFixed(2)}
                        </div>
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

      {/* Middle: Live feed — tabbed by round */}
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Live Feed</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {phase === "simulating" ? `Round ${currentRound} of ${totalRounds}` : phase === "done" ? "Complete" : "Preparing..."}
            </p>
          </div>
          <div className={cn("w-1.5 h-1.5 rounded-full", isLoading ? "bg-amber-400 animate-pulse" : phase === "done" ? "bg-green-500" : "bg-muted-foreground/30")} />
        </div>

        {/* Round tabs */}
        {Array.from({ length: totalRounds }).some((_, i) => agentTurns.some(t => t.round === i + 1)) && (
          <div className="flex gap-1">
            {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => {
              const hasData = agentTurns.some(t => t.round === round);
              const isActive = activeRoundTab === round;
              const isLive = phase === "simulating" && currentRound === round;
              if (!hasData && !isLive) return null;
              return (
                <button
                  key={round}
                  onClick={() => setActiveRoundTab(round)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  Round {round}
                  {isLive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="h-[min(65vh,42rem)] min-h-0 space-y-2.5 overflow-y-auto pr-1">
          {agentTurns.filter(t => t.round === activeRoundTab).length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-12">
              {phase === "generating_personas" ? "Preparing personas..." : "Waiting for round to start..."}
            </p>
          )}
          {agentTurns.filter(t => t.round === activeRoundTab).map((turn, i) => (
            (() => {
              const influenceWeight = safeNumber(turn.influenceWeight, 1);
              const engagementScore = safeNumber(turn.engagementScore, 0);
              return (
                <Card key={i} className="text-xs">
                  <CardContent className="space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate font-semibold">{turn.personaName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {ARCHETYPE_LABELS[turn.archetype] ?? turn.archetype}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {turn.actionType ?? "post"}
                      </Badge>
                      <span className={cn("ml-auto text-[10px] font-medium", SENTIMENT_COLOR[turn.sentiment])}>
                        {turn.sentiment}
                      </span>
                    </div>
                    {turn.targetPersonaName ? (
                      <p className="text-[10px] text-muted-foreground">
                        {turn.actionType === "reply" ? `Responding to ${turn.targetPersonaName}` : `Amplifying ${turn.targetPersonaName}`}
                      </p>
                    ) : null}
                    <p className="line-clamp-4 text-muted-foreground leading-relaxed">{turn.reaction}</p>
                    {turn.visiblePosts && turn.visiblePosts.length > 0 ? (
                      <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Visible Feed</p>
                        <div className="space-y-1">
                          {turn.visiblePosts.map((post) => (
                            <p key={post.turnId} className="text-[10px] text-muted-foreground line-clamp-2">
                              <span className="font-medium text-foreground/80">{post.personaName}</span>: {post.content}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex gap-1 flex-wrap">
                      {turn.keyPoints.map((kp, j) => (
                        <Badge key={j} variant="secondary" className="text-[10px]">{kp}</Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Influence {influenceWeight.toFixed(2)}</span>
                      <span>Engagement {engagementScore.toFixed(2)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })()
          ))}
        </div>
      </div>

      {/* Right: Round summaries — tabbed by round */}
      <div className="flex min-h-0 flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Round Summaries</h2>

        {/* Round tabs (mirrors the feed tabs) */}
        {roundSummaries.length > 0 && (
          <div className="flex gap-1">
            {roundSummaries.map((s) => (
              <button
                key={s.round}
                onClick={() => setActiveRoundTab(s.round)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  activeRoundTab === s.round
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                Round {s.round}
              </button>
            ))}
          </div>
        )}

        <div className="h-[min(65vh,42rem)] min-h-0 overflow-y-auto pr-1">
        {roundSummaries.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-12">
            Summaries will appear after each round...
          </p>
        ) : (
          roundSummaries.filter(s => s.round === activeRoundTab).map((summary) => {
            const overallSentiment = safeNumber(summary.overallSentiment);
            const polarizationScore = safeNumber(summary.polarizationScore);
            const sentimentBreakdown = {
              positive: safeNumber(summary.sentimentBreakdown?.positive),
              neutral: safeNumber(summary.sentimentBreakdown?.neutral),
              negative: safeNumber(summary.sentimentBreakdown?.negative),
            };

            return (
            <Card key={summary.round}>
              <CardHeader className="px-4 pb-2 pt-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Round {summary.round}</span>
                  <span className={cn(
                    "text-xs font-medium",
                    overallSentiment > 0.2 ? "text-green-600" :
                    overallSentiment < -0.2 ? "text-red-500" : "text-amber-500"
                  )}>
                    {overallSentiment > 0 ? "+" : ""}{overallSentiment.toFixed(2)}
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
                          style={{ width: `${(sentimentBreakdown[s] / Math.max(personas.length, 1)) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-4 text-right">{sentimentBreakdown[s]}</span>
                    </div>
                  ))}
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground leading-relaxed">{summary.summary}</p>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                  <div>Polarization: {polarizationScore.toFixed(2)}</div>
                  <div>Flashpoints: {summary.flashpoints.length}</div>
                </div>
                {summary.topConcerns.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {summary.topConcerns.map((c, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>
                    ))}
                  </div>
                )}
                {summary.mostInfluentialTurns.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Top Amplifiers</p>
                    {summary.mostInfluentialTurns.map((turn) => (
                      <div key={turn.turnId} className="flex items-center justify-between text-[10px]">
                        <span>{turn.personaName}</span>
                        <span className="text-muted-foreground">{turn.actionType} · {turn.engagementScore.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )})
        )}
        </div>
      </div>
      </div>
    </div>
  );
}
