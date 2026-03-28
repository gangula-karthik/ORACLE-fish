"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { TextAnimate } from "@/components/ui/text-animate";
import { useSimulatorStore } from "@/lib/store";
import type { ScrapeEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ScrapeView() {
  const {
    run,
    sourceDocs,
    scrapeLog,
    addSourceDoc,
    addScrapeLog,
    setStep,
    setStatus,
    setError,
    setLoading,
    isLoading,
  } = useSimulatorStore();

  const hasStarted = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [showTopBlur, setShowTopBlur] = useState(false);
  const [showBottomBlur, setShowBottomBlur] = useState(false);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    updateLogBlurState();
  }, [scrapeLog]);

  useEffect(() => {
    const node = logContainerRef.current;
    if (!node) return;

    const handleScroll = () => updateLogBlurState();
    const resizeObserver = new ResizeObserver(() => updateLogBlurState());

    node.addEventListener("scroll", handleScroll, { passive: true });
    resizeObserver.observe(node);
    updateLogBlurState();

    return () => {
      node.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!run || hasStarted.current) return;
    hasStarted.current = true;
    startScrape();
  }, [run]);

  async function startScrape() {
    if (!run) return;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    cancelRequestedRef.current = false;

    setLoading(true);
    setError(null);
    setStatus("scraping");
    addScrapeLog("Initializing TinyFish web agent...", "info");

    try {
      const policyChange = encodeURIComponent(run.scenario.policyChange);
      const searchLimit = Math.max(1, run.scenario.searchLimit ?? 2);
      const presetId = run.scenario.presetId ? `&presetId=${encodeURIComponent(run.scenario.presetId)}` : "";
      const title = `&title=${encodeURIComponent(run.scenario.title)}`;
      const res = await fetch(`/api/runs/${run.runId}/scrape?policyChange=${policyChange}&searchLimit=${searchLimit}${presetId}${title}`, {
        signal: abortController.signal,
      });
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
            const event: ScrapeEvent = JSON.parse(line.slice(6));
            handleScrapeEvent(event);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      if (abortController.signal.aborted || cancelRequestedRef.current) {
        addScrapeLog("Scrape cancelled.", "info");
        setStatus("created");
        setError(null);
        return;
      }
      addScrapeLog(`Error: ${(err as Error).message}`, "error");
      setError((err as Error).message);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  function cancelScrape() {
    if (!isLoading) return;
    cancelRequestedRef.current = true;
    abortControllerRef.current?.abort();
  }

  function handleScrapeEvent(event: ScrapeEvent) {
    switch (event.type) {
      case "started":
        addScrapeLog(`Scraping ${event.totalSources} sources...`, "info");
        break;
      case "source_started":
        addScrapeLog(`→ ${event.label} (${event.url})`, "info");
        break;
      case "progress":
        addScrapeLog(`  ${event.message}`, "info");
        break;
      case "document":
        addSourceDoc(event.document);
        addScrapeLog(`✓ Saved: "${event.document.title}"`, "success");
        break;
      case "source_complete":
        addScrapeLog(`✓ Source complete — ${event.docCount} excerpts`, "success");
        break;
      case "complete":
        addScrapeLog(`Scrape complete. ${event.totalDocs} documents saved.`, "success");
        setStatus("scrape_complete");
        setLoading(false);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Scrape complete", {
            body: `${event.totalDocs} documents extracted. Ready to simulate.`,
            icon: "/favicon.ico",
          });
        }
        break;
      case "error":
        addScrapeLog(`Error: ${event.message}`, "error");
        setError(event.message);
        break;
    }
  }

  function updateLogBlurState() {
    const node = logContainerRef.current;
    if (!node) return;

    const hasOverflow = node.scrollHeight > node.clientHeight + 1;
    const canScrollUp = node.scrollTop > 4;
    const canScrollDown = node.scrollTop + node.clientHeight < node.scrollHeight - 4;

    setShowTopBlur(hasOverflow && canScrollUp);
    setShowBottomBlur(hasOverflow && canScrollDown);
  }

  const isDone = scrapeLog.some((l) => l.message.includes("Scrape complete"));

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              isLoading ? "bg-amber-400 animate-pulse" : isDone ? "bg-green-500" : "bg-muted-foreground/30"
            )} />
            <h2 className="text-xl font-semibold tracking-tight">Source Scrape</h2>
          </div>
          <p className="text-sm text-muted-foreground pl-3.5">
            Extracting policy context from Singapore government sources.
          </p>
        </div>
        {isLoading ? (
          <Button variant="destructive" onClick={cancelScrape} className="shrink-0">
            Cancel Search
          </Button>
        ) : null}
      </div>

      {/* Progress bar */}
      <div className="h-px bg-border overflow-hidden rounded-full">
        <div
          className="h-full bg-foreground transition-all duration-500 ease-out"
          style={{ width: isDone ? "100%" : isLoading ? "60%" : "0%" }}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        {/* Agent log */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Agent Log
            </p>
            <p className="text-[11px] text-muted-foreground">
              {scrapeLog.length} {scrapeLog.length === 1 ? "entry" : "entries"}
            </p>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm">
            <div
              ref={logContainerRef}
              className="max-h-[min(60vh,40rem)] overflow-y-auto px-4 py-4"
            >
              <div className="space-y-0.5 font-mono text-xs">
                {scrapeLog.map((entry, i) => (
                  <div
                    key={`${entry.time}-${entry.message}-${i}`}
                    className={cn(
                      "flex min-w-0 items-start gap-3 py-0.5 leading-relaxed",
                      entry.type === "success" && "text-green-600 dark:text-green-400",
                      entry.type === "error" && "text-red-500",
                      entry.type === "info" && "text-muted-foreground"
                    )}
                  >
                    <span className="text-muted-foreground/30 shrink-0 select-none tabular-nums">{entry.time}</span>
                    <TextAnimate
                      as="span"
                      by="character"
                      animation="blurIn"
                      startOnView={false}
                      once
                      duration={0.22}
                      className="block min-w-0 flex-1 overflow-hidden break-words"
                      segmentClassName="max-w-full will-change-[filter,opacity]"
                    >
                      {entry.message}
                    </TextAnimate>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {showTopBlur && (
              <ProgressiveBlur
                position="top"
                height="5rem"
                className="bg-gradient-to-b from-card via-card/80 to-transparent"
              />
            )}
            {showBottomBlur && (
              <ProgressiveBlur
                position="bottom"
                height="6rem"
                className="bg-gradient-to-t from-card via-card/80 to-transparent"
              />
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Documents
            </p>
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {sourceDocs.length} {sourceDocs.length === 1 ? "document" : "documents"}
            </span>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm">
            {sourceDocs.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/40 px-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Documents will appear here as TinyFish extracts relevant passages.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sourceDocs.map((doc) => (
                  <div key={doc.id} className="space-y-1.5 py-3 border-b last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-snug">{doc.title}</p>
                      <Badge variant="outline" className="text-[10px] shrink-0 font-normal">{doc.publisher}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {doc.excerpt}
                    </p>
                    {doc.relevanceTags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {doc.relevanceTags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[10px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CTA */}
      {isDone && (
        <Button onClick={() => setStep("simulate")} className="w-full h-10 font-semibold">
          Generate Personas & Simulate →
        </Button>
      )}
    </div>
  );
}
