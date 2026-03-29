"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { useSimulatorStore } from "@/lib/store";
import type { PersonaArchetype, PersonaProfile, AgentTurn, RoundSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const ARCHETYPE_LABEL: Record<PersonaArchetype, string> = {
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

const ARCHETYPE_ICON: Record<PersonaArchetype, string> = {
  hdb_family: "H",
  hawker: "W",
  pmet: "P",
  retiree: "R",
  student: "S",
  sme_owner: "B",
  gig_worker: "G",
  civil_servant: "C",
  landlord: "L",
  lower_income: "I",
};

const SENTIMENT_COLOR = {
  positive: "#16a34a",
  neutral:  "#6b7280",
  negative: "#dc2626",
  uncertain: "#d97706",
};

function sentimentFromScore(score: number): keyof typeof SENTIMENT_COLOR {
  if (score > 0.2)  return "positive";
  if (score < -0.2) return "negative";
  return "neutral";
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ─── Graph data types ─────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  type: "policy" | "persona" | "concern";
  label: string;
  shortLabel: string;
  color: string;
  radius: number;
  data: PersonaProfile | null;
  sentimentScore?: number;
  sentimentLabel?: string;
  // d3 internals
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: "stance" | "concern" | "impact" | "interaction";
  label?: string;
  sentimentScore?: number;
  strength: number;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

interface SelectedItem {
  kind: "policy" | "persona" | "concern";
  node: GraphNode;
  turns?: AgentTurn[];
  raisedBy?: string[];
  roundsAppearedIn?: number[];
}

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(
  personas: PersonaProfile[],
  agentTurns: AgentTurn[],
  roundSummaries: RoundSummary[],
  scenario: { title: string; policyChange: string }
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Final sentiment per persona (last round)
  const turnsByPersona = new Map<string, AgentTurn[]>();
  for (const t of agentTurns) {
    if (!turnsByPersona.has(t.personaId)) turnsByPersona.set(t.personaId, []);
    turnsByPersona.get(t.personaId)!.push(t);
  }

  // Collect top concerns (deduplicated, capped at 8)
  const concernCounts = new Map<string, number>();
  for (const s of roundSummaries) {
    for (const c of s.topConcerns) concernCounts.set(c, (concernCounts.get(c) ?? 0) + 2);
  }
  for (const p of personas) {
    for (const c of p.topConcerns) concernCounts.set(c, (concernCounts.get(c) ?? 0) + 1);
  }
  const topConcerns = [...concernCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([c]) => c);

  // Nodes
  const nodes: GraphNode[] = [];

  // Policy node (center)
  const lastSummary = roundSummaries[roundSummaries.length - 1];
  const overallScore = lastSummary?.overallSentiment ?? 0;
  nodes.push({
    id: "policy",
    type: "policy",
    label: scenario.title,
    shortLabel: scenario.title.length > 22 ? scenario.title.slice(0, 20) + "…" : scenario.title,
    color: "#1e1b4b",
    radius: 42,
    data: null,
    sentimentScore: overallScore,
    sentimentLabel: sentimentFromScore(overallScore),
  });

  // Persona nodes
  for (const p of personas) {
    const turns = (turnsByPersona.get(p.id) ?? []).sort((a, b) => b.round - a.round);
    const lastTurn = turns[0];
    const score = lastTurn?.sentimentScore ?? 0;
    const col = SENTIMENT_COLOR[sentimentFromScore(score)];
    nodes.push({
      id: p.id,
      type: "persona",
      label: p.name,
      shortLabel: p.name.split(" ")[0],
      color: col,
      radius: 20,
      data: p,
      sentimentScore: score,
      sentimentLabel: lastTurn?.sentiment ?? p.initialStance,
    });
  }

  // Concern nodes
  for (let i = 0; i < topConcerns.length; i++) {
    const c = topConcerns[i];
    const short = c.length > 18 ? c.slice(0, 16) + "…" : c;
    nodes.push({
      id: `concern_${i}`,
      type: "concern",
      label: c,
      shortLabel: short,
      color: "#b45309",
      radius: 15,
      data: null,
    });
  }

  // Edges
  const edges: GraphEdge[] = [];

  // Persona → Policy
  for (const p of personas) {
    const turns = (turnsByPersona.get(p.id) ?? []).sort((a, b) => b.round - a.round);
    const score = turns[0]?.sentimentScore ?? 0;
    edges.push({
      source: p.id,
      target: "policy",
      type: "stance",
      label: turns[0]?.sentiment ?? p.initialStance,
      sentimentScore: score,
      strength: 0.4,
    });
  }

  // Persona → Concern
  for (const p of personas) {
    for (const concern of p.topConcerns) {
      const idx = topConcerns.indexOf(concern);
      if (idx >= 0) {
        edges.push({
          source: p.id,
          target: `concern_${idx}`,
          type: "concern",
          strength: 0.15,
        });
      }
    }
  }

  // Persona → Persona interaction edges
  for (const turn of agentTurns) {
    if (turn.replyToPersonaId && turn.replyToPersonaId !== turn.personaId) {
      edges.push({
        source: turn.personaId,
        target: turn.replyToPersonaId,
        type: "interaction",
        label: turn.actionType,
        sentimentScore: turn.sentimentScore,
        strength: 0.25 + turn.engagementScore * 0.35,
      });
    }
  }

  // Policy → Concern (from final round summary)
  if (lastSummary) {
    for (const concern of lastSummary.topConcerns) {
      const idx = topConcerns.indexOf(concern);
      if (idx >= 0) {
        edges.push({
          source: "policy",
          target: `concern_${idx}`,
          type: "impact",
          strength: 0.2,
        });
      }
    }
  }

  return { nodes, edges };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PolicyGraph() {
  const { personas, agentTurns, roundSummaries, run } = useSimulatorStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [graphVersion, setGraphVersion] = useState(0);
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  const hasData = personas.length > 0 && run;

  const buildSelectedItem = useCallback(
    (node: GraphNode): SelectedItem => {
      if (node.type === "policy") {
        return { kind: "policy", node };
      }
      if (node.type === "persona") {
        const turns = agentTurns
          .filter((t) => t.personaId === node.id)
          .sort((a, b) => a.round - b.round);
        return { kind: "persona", node, turns };
      }
      // concern
      const concernLabel = node.label;
      const raisedBy = personas
        .filter((p) => p.topConcerns.includes(concernLabel))
        .map((p) => p.name);
      const roundsAppearedIn = roundSummaries
        .filter((s) => s.topConcerns.includes(concernLabel))
        .map((s) => s.round);
      return { kind: "concern", node, raisedBy, roundsAppearedIn };
    },
    [agentTurns, personas, roundSummaries]
  );

  const graphLegend = [
    { label: "Policy", color: "#1e1b4b", kind: "dot" as const },
    { label: "Stakeholder", color: "#0f766e", kind: "dot" as const },
    { label: "Concern", color: "#b45309", kind: "pill" as const },
    { label: "Interaction", color: "#0f766e", kind: "line" as const },
  ];

  useEffect(() => {
    if (!hasData || !svgRef.current || !containerRef.current) return;

    const scenario = run!.scenario;
    const { nodes, edges } = buildGraph(personas, agentTurns, roundSummaries, {
      title: scenario.title,
      policyChange: scenario.policyChange,
    });

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();

    // Fix policy at center
    const policyNode = nodes.find((n) => n.id === "policy")!;
    policyNode.fx = width / 2;
    policyNode.fy = height / 2;

    // Stop any previous simulation
    simRef.current?.stop();

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance((d) => {
            if (d.type === "stance") return 160;
            if (d.type === "impact") return 120;
            if (d.type === "interaction") return 110;
            return 90;
          })
          .strength((d) => d.strength)
      )
      .force("charge", d3.forceManyBody().strength(-280))
      .force("collide", d3.forceCollide<GraphNode>((d) => d.radius + 18))
      .force("x", d3.forceX(width / 2).strength(0.03))
      .force("y", d3.forceY(height / 2).strength(0.03));

    simRef.current = simulation;

    const g = svg.append("g");

    // Zoom
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.25, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        })
    );

    // Defs for arrowheads
    const defs = svg.append("defs");
    const mkArrow = (id: string, color: string) => {
      defs
        .append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 10)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color);
    };
    mkArrow("arrow-positive", SENTIMENT_COLOR.positive);
    mkArrow("arrow-negative", SENTIMENT_COLOR.negative);
    mkArrow("arrow-neutral", SENTIMENT_COLOR.neutral);
    mkArrow("arrow-concern", "#d97706");
    mkArrow("arrow-impact", "#6366f1");
    mkArrow("arrow-interaction", "#0f766e");

    // Draw edges
    const edgeGroup = g.append("g").attr("class", "edges");
    const link = edgeGroup
      .selectAll<SVGPathElement, GraphEdge>("path")
      .data(edges)
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d) => {
        if (d.type === "stance") {
          const s = d.sentimentScore ?? 0;
          return s > 0.2 ? SENTIMENT_COLOR.positive : s < -0.2 ? SENTIMENT_COLOR.negative : SENTIMENT_COLOR.neutral;
        }
        if (d.type === "interaction") return "#0f766e";
        if (d.type === "impact") return "#6366f1";
        return "#d97706";
      })
      .attr("stroke-opacity", (d) => (d.type === "stance" ? 0.55 : d.type === "interaction" ? 0.45 : 0.25))
      .attr("stroke-width", (d) => (d.type === "stance" ? 1.8 : d.type === "interaction" ? 1.4 : 1))
      .attr("stroke-dasharray", (d) => (d.type === "concern" ? "3,3" : d.type === "interaction" ? "6,3" : "none"))
      .attr("marker-end", (d) => {
        if (d.type === "stance") {
          const s = d.sentimentScore ?? 0;
          return `url(#arrow-${s > 0.2 ? "positive" : s < -0.2 ? "negative" : "neutral"})`;
        }
        if (d.type === "interaction") return "url(#arrow-interaction)";
        if (d.type === "impact") return "url(#arrow-impact)";
        return "url(#arrow-concern)";
      });

    const linkLabelBg = edgeGroup
      .selectAll<SVGRectElement, GraphEdge>("rect.edge-label-bg")
      .data(edges)
      .enter()
      .append("rect")
      .attr("class", "edge-label-bg")
      .attr("fill", "rgba(255,255,255,0.95)")
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("stroke", "#ececec")
      .attr("stroke-width", 1)
      .style("display", showEdgeLabels ? "block" : "none")
      .style("pointer-events", "none");

    const linkLabels = edgeGroup
      .selectAll<SVGTextElement, GraphEdge>("text.edge-label")
      .data(edges)
      .enter()
      .append("text")
      .attr("class", "edge-label")
      .text((d) => d.label ?? d.type)
      .attr("font-size", "9px")
      .attr("fill", "#666")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .style("font-family", "Geist, system-ui, sans-serif")
      .style("display", showEdgeLabels ? "block" : "none")
      .style("pointer-events", "none");

    // Node group
    const nodeGroup = g.append("g").attr("class", "nodes");
    const nodeG = nodeGroup
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            if (d.id !== "policy") {
              d.fx = null;
              d.fy = null;
            }
          })
      )
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelected(buildSelectedItem(d));
        // Highlight
        nodeG.selectAll("circle, rect").attr("stroke-width", 1.5);
        d3.select(event.currentTarget)
          .select("circle, rect")
          .attr("stroke", "#f59e0b")
          .attr("stroke-width", 3);
      });

    // Policy node
    const policyNodes = nodeG.filter((d) => d.type === "policy");
    policyNodes
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("stroke", "#312e81")
      .attr("stroke-width", 2);
    policyNodes
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#fff")
      .attr("font-size", "9px")
      .attr("font-weight", "600")
      .attr("pointer-events", "none")
      .each(function (d) {
        const words = d.shortLabel.split(" ");
        const el = d3.select(this);
        // Wrap into 3 lines max
        const lines: string[] = [];
        let line = "";
        for (const w of words) {
          if ((line + " " + w).trim().length <= 12) {
            line = (line + " " + w).trim();
          } else {
            if (line) lines.push(line);
            line = w;
          }
        }
        if (line) lines.push(line);
        const startY = -((lines.length - 1) * 6);
        lines.forEach((l, i) => {
          el.append("tspan")
            .attr("x", 0)
            .attr("dy", i === 0 ? `${startY}px` : "12px")
            .text(l);
        });
      });

    // Persona nodes
    const personaNodes = nodeG.filter((d) => d.type === "persona");
    personaNodes
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color + "22")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 1.5);
    personaNodes
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", (d) => d.color)
      .attr("font-size", "10px")
      .attr("font-weight", "700")
      .attr("pointer-events", "none")
      .text((d) => ARCHETYPE_ICON[(d.data as PersonaProfile).archetype]);
    personaNodes
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", (d) => d.color)
      .attr("font-size", "8px")
      .attr("dy", "28")
      .attr("pointer-events", "none")
      .text((d) => d.shortLabel);

    // Concern nodes
    const concernNodes = nodeG.filter((d) => d.type === "concern");
    const rx = 10;
    concernNodes.each(function (d) {
      const el = d3.select(this);
      const textWidth = Math.min(d.shortLabel.length * 5.2 + 12, 110);
      const boxH = 20;
      el.append("rect")
        .attr("x", -textWidth / 2)
        .attr("y", -boxH / 2)
        .attr("width", textWidth)
        .attr("height", boxH)
        .attr("rx", rx)
        .attr("fill", "#fef3c7")
        .attr("stroke", "#b45309")
        .attr("stroke-width", 1.2);
      el.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#92400e")
        .attr("font-size", "8px")
        .attr("pointer-events", "none")
        .text(d.shortLabel);
    });

    // Click on background to deselect
    svg.on("click", () => setSelected(null));

    // Tick
    const getLinkPath = (d: GraphEdge) => {
      const s = d.source as GraphNode;
      const t = d.target as GraphNode;
      if (!s.x || !s.y || !t.x || !t.y) return "";
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Shorten edge to node radius
      const sr = s.radius + 2;
      const tr = (t.type === "concern" ? 10 : t.radius) + 8;
      const sx = s.x + (dx / dist) * sr;
      const sy = s.y + (dy / dist) * sr;
      const tx = t.x - (dx / dist) * tr;
      const ty = t.y - (dy / dist) * tr;
      return `M${sx},${sy} L${tx},${ty}`;
    };

    simulation.on("tick", () => {
      link.attr("d", getLinkPath);
      linkLabels.each(function (d) {
        const s = d.source as GraphNode;
        const t = d.target as GraphNode;
        const x = ((s.x ?? 0) + (t.x ?? 0)) / 2;
        const y = ((s.y ?? 0) + (t.y ?? 0)) / 2;
        d3.select(this).attr("x", x).attr("y", y);
      });
      linkLabelBg.each(function (_, index) {
        const textNode = linkLabels.nodes()[index];
        if (!textNode || textNode.style.display === "none") return;
        const bbox = textNode.getBBox();
        d3.select(this)
          .attr("x", bbox.x - 4)
          .attr("y", bbox.y - 2)
          .attr("width", bbox.width + 8)
          .attr("height", bbox.height + 4);
      });
      nodeG.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [hasData, personas, agentTurns, roundSummaries, run, buildSelectedItem, showEdgeLabels, graphVersion]);

  if (!hasData) {
    return (
      <div className="relative flex-1 overflow-hidden rounded-xl border border-[#eaeaea] bg-[#fafafa]" style={{ minHeight: 0 }}>
        <div className="absolute inset-0 bg-[radial-gradient(circle,_#d0d0d0_1.5px,_transparent_1.5px)] [background-size:24px_24px]" />
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Run a simulation first to see the impact graph.
        </div>
      </div>
    );
  }

  const lastSummary = roundSummaries[roundSummaries.length - 1];

  return (
    <div className="relative flex-1 overflow-hidden rounded-xl border border-[#eaeaea] bg-[#fafafa]" style={{ minHeight: 0 }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle,_#d0d0d0_1.5px,_transparent_1.5px)] [background-size:24px_24px]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-white/95 to-transparent px-5 py-4">
        <span className="pointer-events-auto text-[14px] font-semibold text-[#333]">Graph Relationship Visualization</span>
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setGraphVersion((value) => value + 1);
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[#e0e0e0] bg-white px-3 text-[12px] text-[#666] shadow-sm transition hover:border-[#ccc] hover:bg-[#f5f5f5] hover:text-black"
          >
            <span className={cn(graphVersion > 0 && "animate-spin")}>↻</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} className="absolute inset-0">
        <svg ref={svgRef} className="w-full h-full" />
      </div>

      <div className="absolute right-5 top-[60px] z-10 flex items-center gap-2 rounded-full border border-[#e0e0e0] bg-white px-4 py-2 text-[12px] text-[#666] shadow-sm">
        <label className="relative inline-flex h-[22px] w-10 cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={showEdgeLabels}
            onChange={(event) => setShowEdgeLabels(event.target.checked)}
          />
          <span className="absolute inset-0 rounded-full bg-[#e0e0e0] transition peer-checked:bg-[#7b2d8e]" />
          <span className="absolute left-[3px] h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-[18px]" />
        </label>
        <span>Show Edge Labels</span>
      </div>

      <div className="absolute bottom-6 left-6 z-10 rounded-lg border border-[#eaeaea] bg-white/95 px-4 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.5px] text-[#e91e63]">Entity Types</span>
        <div className="flex max-w-[320px] flex-wrap gap-x-4 gap-y-2">
          {graphLegend.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-[12px] text-[#555]">
              {item.kind === "dot" ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} /> : null}
              {item.kind === "pill" ? <span className="h-2.5 w-4 rounded-full border border-[#b45309] bg-[#fef3c7]" /> : null}
              {item.kind === "line" ? <span className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: item.color }} /> : null}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {lastSummary && !selected && (
        <div className="absolute left-6 top-[68px] z-10 rounded-lg border border-[#eaeaea] bg-white/95 px-4 py-3 text-[11px] text-[#666] shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
          <p className="mb-1 font-semibold text-[#333]">Simulation Summary</p>
          <div className="flex gap-3">
            <span className="font-medium text-green-600">{lastSummary.sentimentBreakdown.positive} positive</span>
            <span>{lastSummary.sentimentBreakdown.neutral} neutral</span>
            <span className="font-medium text-red-500">{lastSummary.sentimentBreakdown.negative} negative</span>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <DetailPanel
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

function DetailPanel({
  item,
  roundSummaries,
  run,
  onClose,
}: {
  item: SelectedItem;
  roundSummaries: RoundSummary[];
  run: NonNullable<ReturnType<typeof useSimulatorStore.getState>["run"]>;
  onClose: () => void;
}) {
  const lastSummary = roundSummaries[roundSummaries.length - 1];

  return (
    <div className="absolute bottom-5 right-5 top-[108px] z-20 flex w-80 flex-col overflow-hidden rounded-[10px] border border-[#eaeaea] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-between border-b border-[#eee] bg-[#fafafa] px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#888]">
            {item.kind === "policy" ? "Policy" : item.kind === "persona" ? "Persona" : "Concern"}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-tight text-[#333]">{item.node.label}</p>
        </div>
        <button
          onClick={onClose}
          className="text-[20px] leading-none text-[#999] transition hover:text-[#333]"
        >
          ×
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {/* Policy detail */}
        {item.kind === "policy" && (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Policy Description</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{run.scenario.policyChange}</p>
            </div>
            {lastSummary && (
              <>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Public Sentiment</p>
                  <div className="flex gap-1 h-6">
                    {(["positive", "neutral", "negative"] as const).map((s) => {
                      const count = lastSummary.sentimentBreakdown[s];
                      const total = lastSummary.sentimentBreakdown.positive + lastSummary.sentimentBreakdown.neutral + lastSummary.sentimentBreakdown.negative;
                      const pct = total ? (count / total) * 100 : 0;
                      const colors = { positive: "bg-green-500", neutral: "bg-gray-400", negative: "bg-red-500" };
                      return (
                        <div
                          key={s}
                          className={cn("rounded-sm transition-all", colors[s])}
                          style={{ width: `${pct}%`, minWidth: pct > 0 ? 4 : 0 }}
                          title={`${s}: ${count}`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span className="text-green-600">{lastSummary.sentimentBreakdown.positive} support</span>
                    <span>{lastSummary.sentimentBreakdown.neutral} neutral</span>
                    <span className="text-red-500">{lastSummary.sentimentBreakdown.negative} oppose</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Round Summary</p>
                  <p className="text-xs text-foreground/80 leading-relaxed">{lastSummary.summary}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Top Concerns</p>
                  <div className="flex flex-wrap gap-1">
                    {lastSummary.topConcerns.map((c, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Sentiment Over Rounds</p>
                  <div className="flex items-end gap-1 h-10">
                    {roundSummaries.map((s, i) => {
                      const pct = ((s.overallSentiment + 1) / 2) * 100;
                      const col = s.overallSentiment > 0.2 ? "bg-green-500" : s.overallSentiment < -0.2 ? "bg-red-500" : "bg-gray-400";
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                          <div className={cn("w-full rounded-t", col)} style={{ height: `${pct}%` }} />
                          <span className="text-[9px] text-muted-foreground">R{s.round}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Persona detail */}
        {item.kind === "persona" && item.node.data && (() => {
          const p = item.node.data as PersonaProfile;
          return (
            <>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
                  style={{ background: item.node.color + "22", border: `2px solid ${item.node.color}`, color: item.node.color }}
                >
                  {ARCHETYPE_ICON[p.archetype]}
                </div>
                <div>
                  <p className="font-semibold text-sm">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground">{ARCHETYPE_LABEL[p.archetype]} · {p.age}y · {p.gender}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {[
                  ["Occupation", p.occupation],
                  ["Income", p.monthlyIncome],
                  ["Housing", p.housingType],
                  ["Family", p.familyStatus],
                  ["Ethnicity", p.ethnicity],
                  ["Initial Stance", p.initialStance],
                  ["Influence", safeNumber(p.influenceWeight, 1).toFixed(2)],
                  ["Activity", safeNumber(p.activityLevel, 0.5).toFixed(2)],
                ].map(([label, val]) => (
                  <div key={label}>
                    <p className="text-muted-foreground">{label}</p>
                    <p className="font-medium capitalize">{val}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Bio</p>
                <p className="text-xs text-foreground/80 leading-relaxed">{p.bio}</p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Primary Concerns</p>
                <div className="flex flex-wrap gap-1">
                  {p.topConcerns.map((c, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              {item.turns && item.turns.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Simulation Responses</p>
                  <div className="space-y-2.5">
                    {item.turns.map((t) => {
                      const col = t.sentiment === "positive" ? "text-green-600" : t.sentiment === "negative" ? "text-red-500" : "text-muted-foreground";
                      return (
                        <div key={t.round} className="border-l-2 pl-2.5" style={{ borderColor: t.sentiment === "positive" ? "#16a34a" : t.sentiment === "negative" ? "#dc2626" : "#9ca3af" }}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Round {t.round}</span>
                            <span className="text-[9px] text-muted-foreground">{t.actionType}</span>
                            <span className={cn("text-[9px] font-semibold capitalize", col)}>{t.sentiment}</span>
                            <span className="text-[9px] text-muted-foreground/60">({t.sentimentScore > 0 ? "+" : ""}{t.sentimentScore.toFixed(2)})</span>
                          </div>
                          <p className="text-[11px] text-foreground/80 leading-relaxed">{t.reaction}</p>
                          {t.targetPersonaName ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Target: {t.targetPersonaName} · engagement {safeNumber(t.engagementScore).toFixed(2)}
                            </p>
                          ) : (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Engagement {safeNumber(t.engagementScore).toFixed(2)}
                            </p>
                          )}
                          {t.keyPoints.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {t.keyPoints.map((kp, i) => (
                                <li key={i} className="text-[10px] text-muted-foreground flex gap-1">
                                  <span className="shrink-0 mt-0.5">·</span>
                                  <span>{kp}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* Concern detail */}
        {item.kind === "concern" && (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Concern</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{item.node.label}</p>
            </div>
            {item.raisedBy && item.raisedBy.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Raised by {item.raisedBy.length} persona{item.raisedBy.length > 1 ? "s" : ""}</p>
                <div className="flex flex-wrap gap-1">
                  {item.raisedBy.map((name, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {item.roundsAppearedIn && item.roundsAppearedIn.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Appeared in rounds</p>
                <div className="flex gap-1">
                  {item.roundsAppearedIn.map((r) => (
                    <span key={r} className="text-[10px] w-6 h-6 flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 font-medium">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Related to</p>
              {lastSummary?.topConcerns.includes(item.node.label) ? (
                <p className="text-xs text-foreground/80">
                  This concern appeared in the final round summary, indicating it is a persistent issue.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Surfaced from persona profiles but not in the final round summary.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
