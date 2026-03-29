"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSimulatorStore } from "@/lib/store";
import { saveCachedRun, clearCachedRun } from "@/lib/cache";
import type { ReportEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PolicyGraph } from "./PolicyGraph";

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }

    return part;
  });
}

function renderMarkdownBlocks(content: string) {
  const lines = content.split("\n");
  const blocks: Array<{ type: string; lines?: string[]; text?: string }> = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let orderedList: string[] = [];

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  }

  function flushList() {
    if (list.length > 0) {
      blocks.push({ type: "list", lines: list });
      list = [];
    }
  }

  function flushOrderedList() {
    if (orderedList.length > 0) {
      blocks.push({ type: "ordered-list", lines: orderedList });
      orderedList = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      flushOrderedList();
      continue;
    }

    if (line === "---") {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push({ type: "divider" });
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push({ type: "h3", text: line.slice(4) });
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push({ type: "h2", text: line.slice(3) });
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push({ type: "h1", text: line.slice(2) });
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push({ type: "quote", text: line.slice(2) });
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      flushOrderedList();
      list.push(line.slice(2));
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      flushParagraph();
      flushList();
      orderedList.push(line.replace(/^\d+\.\s/, ""));
      continue;
    }

    flushList();
    flushOrderedList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushOrderedList();

  return blocks.map((block, index) => {
    switch (block.type) {
      case "h1":
        return <h1 key={index} className="text-xl font-semibold tracking-tight text-foreground">{renderInlineMarkdown(block.text ?? "")}</h1>;
      case "h2":
        return <h2 key={index} className="text-lg font-semibold tracking-tight text-foreground">{renderInlineMarkdown(block.text ?? "")}</h2>;
      case "h3":
        return <h3 key={index} className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{renderInlineMarkdown(block.text ?? "")}</h3>;
      case "quote":
        return (
          <blockquote key={index} className="border-l-2 border-border pl-4 text-sm italic text-muted-foreground">
            {renderInlineMarkdown(block.text ?? "")}
          </blockquote>
        );
      case "list":
        return (
          <ul key={index} className="space-y-2 pl-5 text-sm text-muted-foreground">
            {block.lines?.map((item, itemIndex) => (
              <li key={itemIndex} className="list-disc leading-relaxed">
                {renderInlineMarkdown(item)}
              </li>
            ))}
          </ul>
        );
      case "ordered-list":
        return (
          <ol key={index} className="space-y-2 pl-5 text-sm text-muted-foreground">
            {block.lines?.map((item, itemIndex) => (
              <li key={itemIndex} className="list-decimal leading-relaxed">
                {renderInlineMarkdown(item)}
              </li>
            ))}
          </ol>
        );
      case "divider":
        return <hr key={index} className="border-border" />;
      default:
        return (
          <p key={index} className="text-sm leading-7 text-muted-foreground">
            {renderInlineMarkdown(block.text ?? "")}
          </p>
        );
    }
  });
}

export function ReportView() {
  const {
    run,
    reportSections,
    reportOutline,
    currentSection,
    roundSummaries,
    personas,
    interactions,
    fromCache,
    cachedAt,
    setReportOutline,
    setCurrentSection,
    setSectionEvidence,
    addReportSection,
    setStatus,
    setError,
    setLoading,
    isLoading,
    reset,
  } = useSimulatorStore();

  const hasStarted = useRef(false);
  // If sections are already populated (cache restore), start as done
  const [isDone, setIsDone] = useState(() => reportSections.length > 0);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"report" | "graph">("report");

  const handleReportEvent = useCallback((event: ReportEvent) => {
    switch (event.type) {
      case "outline":
        setReportOutline(event.sections);
        break;
      case "section_started":
        setCurrentSection(event.sectionId);
        setActiveTab((current) => current ?? event.sectionId);
        break;
      case "section_evidence":
        setSectionEvidence(event.sectionId, event.evidence);
        break;
      case "section_complete":
        addReportSection(event.section);
        setCurrentSection(null);
        setActiveTab((current) => current ?? event.section.id);
        break;
      case "complete":
        setIsDone(true);
        setStatus("complete");
        setLoading(false);
        if (run) {
          const state = useSimulatorStore.getState();
          saveCachedRun(run.scenario, {
            sourceDocs: state.sourceDocs,
            personas: state.personas,
            agentTurns: state.agentTurns,
            interactions: state.interactions,
            roundSummaries: state.roundSummaries,
            reportSections: state.reportSections,
          });
        }
        break;
      case "error":
        setError(event.message);
        break;
    }
  }, [addReportSection, run, setCurrentSection, setError, setLoading, setReportOutline, setSectionEvidence, setStatus]);

  const generateReport = useCallback(async () => {
    if (!run) return;
    setLoading(true);
    setStatus("generating_report");

    try {
      const params = new URLSearchParams({
        scenario: encodeURIComponent(JSON.stringify(run.scenario)),
      });

      const res = await fetch(`/api/runs/${run.runId}/report?${params}`);
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
            const event: ReportEvent = JSON.parse(line.slice(6));
            handleReportEvent(event);
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
  }, [handleReportEvent, run, setError, setLoading, setStatus]);

  useEffect(() => {
    if (!run || hasStarted.current || reportSections.length > 0) return;
    hasStarted.current = true;
    generateReport();
  }, [generateReport, reportSections.length, run]);

  useEffect(() => {
    if (reportSections.length > 0 && !activeTab) {
      setActiveTab(reportSections[0].id);
    }
  }, [activeTab, reportSections]);

  function handleRerun() {
    if (run) clearCachedRun(run.scenario);
    reset();
  }

  const progress = reportOutline.length > 0
    ? (reportSections.length / reportOutline.length) * 100
    : 0;

  const activeSection = reportSections.find((s) => s.id === activeTab);
  const lastSummary = roundSummaries[roundSummaries.length - 1];
  const sentiment = lastSummary?.overallSentiment ?? 0;
  const sentimentLabel = sentiment > 0.2 ? "Generally Positive" : sentiment < -0.2 ? "Largely Negative" : "Mixed / Uncertain";
  const sentimentColor = sentiment > 0.2 ? "text-green-600" : sentiment < -0.2 ? "text-red-500" : "text-amber-500";

  const cachedDate = cachedAt
    ? new Date(cachedAt).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      {/* View mode switcher */}
      <div className="shrink-0 max-w-6xl mx-auto w-full px-6 pt-6 pb-0 flex items-center gap-1">
        <button
          onClick={() => setViewMode("report")}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            viewMode === "report" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
          )}
        >
          Report
        </button>
        <button
          onClick={() => setViewMode("graph")}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            viewMode === "graph" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
          )}
        >
          Impact Graph
        </button>
      </div>

      {/* Graph view */}
      {viewMode === "graph" && (
        <div className="flex-1 min-h-0 px-6 pb-6 pt-4 flex flex-col">
          <PolicyGraph />
        </div>
      )}

      {/* Report view */}
      {viewMode === "report" && (
      <div className="flex-1 min-h-0 max-w-6xl mx-auto w-full px-6 py-6 grid grid-cols-3 gap-6 overflow-hidden">
      {/* Left: Report nav + stats */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Policy Impact Report</h2>
            {fromCache && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 mt-1">
                cached
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">{run?.scenario.title}</p>
          {fromCache && cachedDate && (
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Saved {cachedDate}</p>
          )}
        </div>

        {isLoading && (
          <div className="space-y-1.5">
            <Progress value={progress} className="h-1" />
            <p className="text-[10px] text-muted-foreground">
              {reportSections.length} of {reportOutline.length} sections complete
            </p>
          </div>
        )}

        {/* Section nav */}
        <div className="space-y-1">
          {reportOutline.map((s) => {
            const done = reportSections.some((rs) => rs.id === s.id);
            const active = currentSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => done && setActiveTab(s.id)}
                disabled={!done}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-xs flex items-center gap-2 transition-colors",
                  activeTab === s.id ? "bg-foreground text-background" : "hover:bg-muted",
                  !done && !active && "opacity-40 cursor-default"
                )}
              >
                <span className={cn(
                  "w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] shrink-0",
                  done ? "bg-green-500 text-white" : active ? "bg-amber-400 animate-pulse" : "bg-muted-foreground/30"
                )}>
                  {done ? "✓" : active ? "•" : ""}
                </span>
                {s.title}
              </button>
            );
          })}
        </div>

        <Separator />

        {/* Quick stats */}
        {lastSummary && (
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Simulation Stats</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Public Mood</span>
                <span className={cn("font-medium", sentimentColor)}>{sentimentLabel}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Personas</span>
                <span className="font-medium">{personas.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Rounds</span>
                <span className="font-medium">{roundSummaries.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Interactions</span>
                <span className="font-medium">{interactions.length}</span>
              </div>
            </div>
            {lastSummary.topConcerns.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Top Concerns</p>
                <div className="flex gap-1 flex-wrap">
                  {lastSummary.topConcerns.slice(0, 4).map((c, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(isDone || fromCache) && (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                const content = reportSections
                  .map((s) => `# ${s.title}\n\n${s.content}`)
                  .join("\n\n---\n\n");
                const blob = new Blob([content], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `sg-policy-report-${run?.runId?.slice(0, 8)}.md`;
                a.click();
              }}
            >
              ↓ Export Markdown
            </Button>
            {fromCache && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={handleRerun}
              >
                ↺ Re-run simulation
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Right: Report content */}
      <div className="col-span-2 flex flex-col gap-4">
        {activeSection ? (
          <Card className="flex-1 overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">{activeSection.title}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="max-w-none space-y-5 p-6">
                  {renderMarkdownBlocks(activeSection.content)}
                  {activeSection.evidence && activeSection.evidence.length > 0 && (
                    <div className="space-y-3 border-t pt-5">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Evidence Used</p>
                      <div className="grid gap-2">
                        {activeSection.evidence.map((item) => (
                          <div key={item.id} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.type}</span>
                              <span className="text-[10px] text-muted-foreground">{item.relevance.toFixed(2)}</span>
                            </div>
                            <p className="text-xs font-medium text-foreground">{item.title}</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.snippet}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="flex gap-1 justify-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-muted-foreground/30 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {currentSection
                  ? `Writing: ${reportOutline.find((s) => s.id === currentSection)?.title ?? "..."}`
                  : "Generating report..."}
              </p>
            </div>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
}
