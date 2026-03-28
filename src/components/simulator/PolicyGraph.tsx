"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { useSimulatorStore } from "@/lib/store";
import type { PersonaArchetype, PersonaProfile, AgentTurn, RoundSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  positive: "#10b981",   // emerald-500
  negative: "#f43f5e",   // rose-500
  neutral:  "#94a3b8",   // slate-400
  concern:  "#f59e0b",   // amber-400
};

function sentimentColor(score: number) {
  return score > 0.2 ? C.positive : score < -0.2 ? C.negative : C.neutral;
}

const ARCHETYPE_LABEL: Record<PersonaArchetype, string> = {
  hdb_family: "HDB Family", hawker: "Hawker", pmet: "PMET",
  retiree: "Retiree", student: "Student", sme_owner: "SME Owner",
  gig_worker: "Gig Worker", civil_servant: "Civil Servant",
  landlord: "Landlord", lower_income: "Lower Income",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface GNode {
  id: string;
  type: "policy" | "persona" | "concern";
  label: string;
  color: string;
  r: number;
  data: PersonaProfile | null;
  score: number;
  x?: number; y?: number; vx?: number; vy?: number;
  fx?: number | null; fy?: number | null;
}

interface GEdge {
  source: string | GNode;
  target: string | GNode;
  edgeType: "stance" | "worry" | "impact";
  score?: number;
  strength: number;
}

interface SelectedItem {
  kind: "policy" | "persona" | "concern";
  node: GNode;
  turns?: AgentTurn[];
  raisedBy?: string[];
}

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(
  personas: PersonaProfile[],
  agentTurns: AgentTurn[],
  roundSummaries: RoundSummary[],
  scenario: { title: string }
): { nodes: GNode[]; edges: GEdge[] } {
  const turnsByPersona = new Map<string, AgentTurn[]>();
  for (const t of agentTurns) {
    if (!turnsByPersona.has(t.personaId)) turnsByPersona.set(t.personaId, []);
    turnsByPersona.get(t.personaId)!.push(t);
  }

  const concernWeight = new Map<string, number>();
  for (const s of roundSummaries)
    for (const c of s.topConcerns) concernWeight.set(c, (concernWeight.get(c) ?? 0) + 2);
  for (const p of personas)
    for (const c of p.topConcerns) concernWeight.set(c, (concernWeight.get(c) ?? 0) + 1);

  const topConcerns = [...concernWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c]) => c);

  const lastSummary = roundSummaries[roundSummaries.length - 1];
  const overallScore = lastSummary?.overallSentiment ?? 0;

  const nodes: GNode[] = [
    {
      id: "policy", type: "policy",
      label: scenario.title,
      color: "#0f172a", r: 50,
      data: null, score: overallScore,
    },
    ...personas.map((p) => {
      const turns = (turnsByPersona.get(p.id) ?? []).sort((a, b) => b.round - a.round);
      const score = turns[0]?.sentimentScore ?? 0;
      return {
        id: p.id, type: "persona" as const,
        label: p.name.split(" ")[0],
        color: sentimentColor(score),
        r: 16, data: p, score,
      };
    }),
    ...topConcerns.map((c, i) => ({
      id: `concern_${i}`, type: "concern" as const,
      label: c.length > 22 ? c.slice(0, 20) + "…" : c,
      color: C.concern, r: 5,
      data: null, score: 0,
    })),
  ];

  const edges: GEdge[] = [];

  for (const p of personas) {
    const turns = (turnsByPersona.get(p.id) ?? []).sort((a, b) => b.round - a.round);
    const score = turns[0]?.sentimentScore ?? 0;
    edges.push({ source: p.id, target: "policy", edgeType: "stance", score, strength: 0.45 });
  }
  for (const p of personas) {
    for (const concern of p.topConcerns) {
      const idx = topConcerns.indexOf(concern);
      if (idx >= 0) edges.push({ source: p.id, target: `concern_${idx}`, edgeType: "worry", strength: 0.12 });
    }
  }
  if (lastSummary) {
    for (const concern of lastSummary.topConcerns) {
      const idx = topConcerns.indexOf(concern);
      if (idx >= 0) edges.push({ source: "policy", target: `concern_${idx}`, edgeType: "impact", strength: 0.18 });
    }
  }

  return { nodes, edges };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PolicyGraph() {
  const { personas, agentTurns, roundSummaries, run } = useSimulatorStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const simRef = useRef<d3.Simulation<GNode, GEdge> | null>(null);

  const hasData = personas.length > 0 && run;

  const makeSelected = useCallback((node: GNode): SelectedItem => {
    if (node.type === "policy") return { kind: "policy", node };
    if (node.type === "persona") {
      const turns = agentTurns.filter(t => t.personaId === node.id).sort((a, b) => a.round - b.round);
      return { kind: "persona", node, turns };
    }
    const raisedBy = personas.filter(p => p.topConcerns.includes(node.label)).map(p => p.name);
    return { kind: "concern", node, raisedBy };
  }, [agentTurns, personas]);

  useEffect(() => {
    if (!hasData || !svgRef.current || !containerRef.current) return;

    const isDark = document.documentElement.classList.contains("dark");
    const policyFill = isDark ? "#f1f5f9" : "#0f172a";
    const policyText = isDark ? "#0f172a" : "#ffffff";
    const edgeBg    = isDark ? "#334155" : "#cbd5e1"; // subtle edges

    const { nodes, edges } = buildGraph(personas, agentTurns, roundSummaries, { title: run!.scenario.title });
    const container = containerRef.current;
    const W = container.clientWidth;
    const H = container.clientHeight;

    const svg = d3.select(svgRef.current)
      .attr("width", W).attr("height", H)
      .attr("viewBox", `0 0 ${W} ${H}`);
    svg.selectAll("*").remove();

    // Defs
    const defs = svg.append("defs");

    // Policy glow
    const glow = defs.append("filter").attr("id", "pg").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "12").attr("result", "blur");
    glow.append("feComposite").attr("in", "SourceGraphic").attr("in2", "blur").attr("operator", "over");

    // Subtle node shadow
    const shadow = defs.append("filter").attr("id", "ns").attr("x", "-30%").attr("y", "-30%").attr("width", "160%").attr("height", "160%");
    shadow.append("feDropShadow").attr("dx", "0").attr("dy", "2").attr("stdDeviation", "3").attr("flood-opacity", "0.12");

    nodes.find(n => n.id === "policy")!.fx = W / 2;
    nodes.find(n => n.id === "policy")!.fy = H / 2;

    simRef.current?.stop();
    const sim = d3.forceSimulation<GNode>(nodes)
      .force("link", d3.forceLink<GNode, GEdge>(edges).id(d => d.id)
        .distance(d => d.edgeType === "stance" ? 175 : d.edgeType === "impact" ? 130 : 95)
        .strength(d => d.strength))
      .force("charge", d3.forceManyBody().strength(-320))
      .force("collide", d3.forceCollide<GNode>(d => d.r + 22))
      .force("x", d3.forceX(W / 2).strength(0.025))
      .force("y", d3.forceY(H / 2).strength(0.025));
    simRef.current = sim;

    const root = svg.append("g");
    svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 3.5]).on("zoom", e => root.attr("transform", e.transform)));

    // ── Edges ──────────────────────────────────────────────────────────────────

    const edgeG = root.append("g");
    const link = edgeG.selectAll<SVGPathElement, GEdge>("path")
      .data(edges).enter().append("path")
      .attr("fill", "none")
      .attr("stroke", d => {
        if (d.edgeType === "stance") return sentimentColor(d.score ?? 0);
        if (d.edgeType === "impact") return C.concern;
        return edgeBg;
      })
      .attr("stroke-opacity", d => d.edgeType === "stance" ? 0.38 : d.edgeType === "impact" ? 0.22 : 0.14)
      .attr("stroke-width", d => d.edgeType === "stance" ? 1.6 : 1)
      .attr("stroke-dasharray", d => d.edgeType === "worry" ? "2 4" : "none")
      .attr("stroke-linecap", "round");

    // ── Nodes ──────────────────────────────────────────────────────────────────

    const nodeG = root.append("g")
      .selectAll<SVGGElement, GNode>("g")
      .data(nodes).enter().append("g")
      .style("cursor", "pointer")
      .call(d3.drag<SVGGElement, GNode>()
        .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end", (ev, d) => {
          if (!ev.active) sim.alphaTarget(0);
          if (d.id !== "policy") { d.fx = null; d.fy = null; }
        }));

    // Policy node
    const policyG = nodeG.filter(d => d.type === "policy");

    // Glow disc (behind)
    policyG.append("circle")
      .attr("r", 62)
      .attr("fill", policyFill)
      .attr("opacity", 0.07)
      .attr("filter", "url(#pg)");

    // Main disc
    policyG.append("circle")
      .attr("r", d => d.r)
      .attr("fill", policyFill)
      .attr("filter", "url(#ns)");

    // Text — wrap inside disc
    policyG.append("text")
      .attr("text-anchor", "middle")
      .attr("fill", policyText)
      .attr("font-size", "8.5px")
      .attr("font-weight", "600")
      .attr("letter-spacing", "0.3px")
      .attr("pointer-events", "none")
      .each(function(d) {
        const el = d3.select(this);
        const words = d.label.split(" ");
        const lines: string[] = [];
        let cur = "";
        for (const w of words) {
          const test = cur ? `${cur} ${w}` : w;
          if (test.length <= 14) { cur = test; }
          else { if (cur) lines.push(cur); cur = w; }
        }
        if (cur) lines.push(cur);
        const lineH = 11;
        const startY = -((lines.length - 1) / 2) * lineH;
        lines.forEach((l, i) => {
          el.append("tspan")
            .attr("x", 0).attr("dy", i === 0 ? `${startY}px` : `${lineH}px`)
            .text(l);
        });
      });

    // Persona nodes — clean ring
    const personaG = nodeG.filter(d => d.type === "persona");

    personaG.append("circle")
      .attr("r", d => d.r)
      .attr("fill", d => d.color + "12")
      .attr("stroke", d => d.color)
      .attr("stroke-width", 2)
      .attr("filter", "url(#ns)");

    // First-name label below
    personaG.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", d => d.r + 11)
      .attr("fill", d => d.color)
      .attr("font-size", "7.5px")
      .attr("font-weight", "500")
      .attr("letter-spacing", "0.2px")
      .attr("pointer-events", "none")
      .text(d => d.label);

    // Concern nodes — small dot + floating label
    const concernG = nodeG.filter(d => d.type === "concern");

    concernG.append("circle")
      .attr("r", d => d.r)
      .attr("fill", C.concern + "20")
      .attr("stroke", C.concern)
      .attr("stroke-width", 1.5);

    concernG.append("text")
      .attr("x", 10)
      .attr("dy", "0.35em")
      .attr("fill", isDark ? "#fbbf24" : "#92400e")
      .attr("font-size", "7px")
      .attr("letter-spacing", "0.15px")
      .attr("pointer-events", "none")
      .text(d => d.label);

    // ── Hover focus effect ─────────────────────────────────────────────────────

    const defaultOpacity = (d: GEdge) => d.edgeType === "stance" ? 0.38 : d.edgeType === "impact" ? 0.22 : 0.14;

    nodeG
      .on("mouseenter", function(_, d) {
        // Fade unrelated edges
        link
          .attr("stroke-opacity", l => {
            const sid = (l.source as GNode).id;
            const tid = (l.target as GNode).id;
            if (sid === d.id || tid === d.id) return l.edgeType === "stance" ? 0.85 : 0.55;
            return 0.04;
          })
          .attr("stroke-width", l => {
            const sid = (l.source as GNode).id;
            const tid = (l.target as GNode).id;
            return (sid === d.id || tid === d.id) ? (l.edgeType === "stance" ? 2.2 : 1.2) : 0.8;
          });
        // Fade unrelated nodes
        nodeG.attr("opacity", nd => {
          if (nd.id === d.id) return 1;
          const connected = edges.some(l => {
            const sid = (l.source as GNode).id;
            const tid = (l.target as GNode).id;
            return (sid === d.id && tid === nd.id) || (tid === d.id && sid === nd.id);
          });
          return connected ? 0.85 : 0.2;
        });
      })
      .on("mouseleave", function() {
        link.attr("stroke-opacity", defaultOpacity).attr("stroke-width", d => d.edgeType === "stance" ? 1.6 : 1);
        nodeG.attr("opacity", 1);
      })
      .on("click", function(ev, d) {
        ev.stopPropagation();
        setSelected(makeSelected(d));
      });

    svg.on("click", () => setSelected(null));

    // ── Tick ───────────────────────────────────────────────────────────────────

    const path = (d: GEdge) => {
      const s = d.source as GNode;
      const t = d.target as GNode;
      if (!s.x || !s.y || !t.x || !t.y) return "";
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const sr = s.r + 2;
      const tr = t.r + (t.type === "concern" ? 6 : 4);
      const x1 = s.x + (dx / dist) * sr, y1 = s.y + (dy / dist) * sr;
      const x2 = t.x - (dx / dist) * tr, y2 = t.y - (dy / dist) * tr;
      if (d.edgeType !== "stance") return `M${x1},${y1}L${x2},${y2}`;
      // Slight curve for stance edges
      const nx = -dy / dist, ny = dx / dist;
      const c = 18;
      const cx = (x1 + x2) / 2 + nx * c, cy = (y1 + y2) / 2 + ny * c;
      return `M${x1},${y1}Q${cx},${cy}${x2},${y2}`;
    };

    sim.on("tick", () => {
      link.attr("d", path);
      nodeG.attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { sim.stop(); };
  }, [hasData, personas, agentTurns, roundSummaries, run, makeSelected]);

  if (!hasData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Run a simulation to see the impact graph.</p>
      </div>
    );
  }

  const lastSummary = roundSummaries[roundSummaries.length - 1];
  const { positive = 0, neutral = 0, negative = 0 } = lastSummary?.sentimentBreakdown ?? {};
  const total = positive + neutral + negative || 1;

  return (
    <div className="relative flex-1 overflow-hidden rounded-xl border bg-background" style={{ minHeight: 0 }}>

      {/* Canvas */}
      <div ref={containerRef} className="absolute inset-0">
        <svg ref={svgRef} className="w-full h-full" />
      </div>

      {/* Sentiment bar — top center */}
      {lastSummary && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-background/80 backdrop-blur-sm border rounded-full px-4 py-1.5 pointer-events-none select-none">
          <span className="text-[10px] font-medium text-emerald-600">{positive} support</span>
          <div className="flex h-1.5 w-24 rounded-full overflow-hidden gap-px">
            <div className="bg-emerald-500 rounded-l-full transition-all" style={{ width: `${(positive / total) * 100}%` }} />
            <div className="bg-slate-300 dark:bg-slate-600 transition-all" style={{ width: `${(neutral / total) * 100}%` }} />
            <div className="bg-rose-500 rounded-r-full transition-all" style={{ width: `${(negative / total) * 100}%` }} />
          </div>
          <span className="text-[10px] font-medium text-rose-500">{negative} oppose</span>
        </div>
      )}

      {/* Legend — bottom left, ultra-minimal */}
      <div className="absolute bottom-4 left-4 flex items-center gap-3 pointer-events-none select-none">
        {[
          { color: C.positive, label: "Support" },
          { color: C.neutral,  label: "Neutral" },
          { color: C.negative, label: "Oppose"  },
          { color: C.concern,  label: "Concern" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-[9px] text-muted-foreground/70">{label}</span>
          </div>
        ))}
        <span className="text-[9px] text-muted-foreground/40 ml-1">scroll · drag</span>
      </div>

      {/* Detail panel */}
      {selected && (
        <Panel
          item={selected}
          roundSummaries={roundSummaries}
          run={run!}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

type RunType = NonNullable<ReturnType<typeof useSimulatorStore.getState>["run"]>;

function Panel({ item, roundSummaries, run, onClose }: {
  item: SelectedItem;
  roundSummaries: RoundSummary[];
  run: RunType;
  onClose: () => void;
}) {
  const last = roundSummaries[roundSummaries.length - 1];
  const p = item.node.data as PersonaProfile | null;

  return (
    <div className="absolute top-3 right-3 bottom-3 w-[296px] flex flex-col rounded-xl border bg-background/96 backdrop-blur-md shadow-2xl shadow-black/10 overflow-hidden z-20">

      {/* Header */}
      <div className="shrink-0 px-5 pt-5 pb-4 border-b flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-0.5">
            {item.kind}
          </p>
          <p className="text-[13px] font-semibold leading-snug truncate">{item.node.label}</p>
          {item.kind === "persona" && p && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {ARCHETYPE_LABEL[p.archetype]} · {p.age}y · {p.occupation}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors text-sm leading-none"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[11px]">

        {/* ── Policy ──────────────────────────────────────────────────── */}
        {item.kind === "policy" && (
          <>
            <Section label="Policy Change">
              <p className="text-[11px] leading-relaxed text-foreground/70">{run.scenario.policyChange}</p>
            </Section>

            {last && (
              <>
                <Section label="Public Sentiment">
                  <SentimentBar breakdown={last.sentimentBreakdown} />
                </Section>

                <Section label="Summary">
                  <p className="text-[11px] leading-relaxed text-foreground/70">{last.summary}</p>
                </Section>

                {roundSummaries.length > 1 && (
                  <Section label="Sentiment by Round">
                    <RoundChart summaries={roundSummaries} />
                  </Section>
                )}

                <Section label="Top Concerns">
                  <Pills items={last.topConcerns} color="amber" />
                </Section>
              </>
            )}
          </>
        )}

        {/* ── Persona ─────────────────────────────────────────────────── */}
        {item.kind === "persona" && p && (
          <>
            {/* Sentiment indicator */}
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.node.color }} />
              <span className="capitalize font-medium" style={{ color: item.node.color }}>
                {item.node.score > 0.2 ? "Supports" : item.node.score < -0.2 ? "Opposes" : "Neutral"}
              </span>
              <span className="text-muted-foreground/50">
                ({item.node.score > 0 ? "+" : ""}{item.node.score.toFixed(2)})
              </span>
            </div>

            <Section label="Profile">
              <Grid items={[
                ["Housing", p.housingType],
                ["Income", p.monthlyIncome],
                ["Family", p.familyStatus],
                ["Ethnicity", p.ethnicity],
                ["Initial stance", p.initialStance],
              ]} />
            </Section>

            <Section label="Bio">
              <p className="text-[11px] leading-relaxed text-foreground/70">{p.bio}</p>
            </Section>

            <Section label="Primary Concerns">
              <Pills items={p.topConcerns} color="amber" />
            </Section>

            {item.turns && item.turns.length > 0 && (
              <Section label="Responses">
                <div className="space-y-3">
                  {item.turns.map(t => (
                    <div key={t.round} className="relative pl-3">
                      <div
                        className="absolute left-0 top-1 bottom-0 w-px rounded-full"
                        style={{ background: sentimentColor(t.sentimentScore) + "60" }}
                      />
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/50">R{t.round}</span>
                        <span className="font-medium capitalize text-[10px]" style={{ color: sentimentColor(t.sentimentScore) }}>
                          {t.sentiment}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-foreground/70">{t.reaction}</p>
                      {t.keyPoints.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {t.keyPoints.map((kp, i) => (
                            <li key={i} className="flex gap-1.5 text-[10px] text-muted-foreground">
                              <span className="shrink-0 opacity-40">—</span>
                              <span>{kp}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* ── Concern ─────────────────────────────────────────────────── */}
        {item.kind === "concern" && (
          <>
            <Section label="Concern">
              <p className="text-[11px] leading-relaxed text-foreground/70">{item.node.label}</p>
            </Section>

            {item.raisedBy && item.raisedBy.length > 0 && (
              <Section label={`Raised by ${item.raisedBy.length} persona${item.raisedBy.length > 1 ? "s" : ""}`}>
                <Pills items={item.raisedBy} color="default" />
              </Section>
            )}

            <Section label="Status">
              <p className="text-[11px] leading-relaxed text-foreground/70">
                {last?.topConcerns.includes(item.node.label)
                  ? "Persisted through the final round — a recurring concern across personas."
                  : "Surfaced from persona backgrounds but did not dominate the final round."}
              </p>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function Grid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <p className="text-[9px] text-muted-foreground/50">{k}</p>
          <p className="text-[11px] font-medium capitalize text-foreground/80">{v}</p>
        </div>
      ))}
    </div>
  );
}

function Pills({ items, color }: { items: string[]; color: "amber" | "default" }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <span
          key={i}
          className={cn(
            "text-[9px] px-2 py-0.5 rounded-full border",
            color === "amber"
              ? "border-amber-200/60 dark:border-amber-800/60 text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/40"
              : "border-border text-muted-foreground bg-muted/50"
          )}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function SentimentBar({ breakdown }: { breakdown: { positive: number; neutral: number; negative: number } }) {
  const total = (breakdown.positive + breakdown.neutral + breakdown.negative) || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        <div className="bg-emerald-500 transition-all rounded-l-full" style={{ width: `${(breakdown.positive / total) * 100}%` }} />
        <div className="bg-slate-300 dark:bg-slate-600 transition-all" style={{ width: `${(breakdown.neutral / total) * 100}%` }} />
        <div className="bg-rose-500 transition-all rounded-r-full" style={{ width: `${(breakdown.negative / total) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[9px]">
        <span className="text-emerald-600">{breakdown.positive} support</span>
        <span className="text-muted-foreground/50">{breakdown.neutral} neutral</span>
        <span className="text-rose-500">{breakdown.negative} oppose</span>
      </div>
    </div>
  );
}

function RoundChart({ summaries }: { summaries: RoundSummary[] }) {
  return (
    <div className="flex items-end gap-1.5 h-10">
      {summaries.map((s, i) => {
        const pct = Math.round(((s.overallSentiment + 1) / 2) * 100);
        const color = s.overallSentiment > 0.2 ? "#10b981" : s.overallSentiment < -0.2 ? "#f43f5e" : "#94a3b8";
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group">
            <div className="w-full rounded-sm transition-all" style={{ height: `${pct}%`, background: color + "80" }} />
            <span className="text-[8px] text-muted-foreground/40">R{s.round}</span>
          </div>
        );
      })}
    </div>
  );
}
