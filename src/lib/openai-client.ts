import OpenAI from "openai";
import type {
  AgentTurn,
  InteractionEvent,
  PersonaArchetype,
  PersonaProfile,
  ReportEvidenceItem,
  ReportSection,
  RoundSummary,
  ScenarioInput,
  VisiblePost,
} from "./types";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const MODEL = "gpt-4o";

const SG_PERSONA_ARCHETYPES: PersonaArchetype[] = [
  "hdb_family",
  "hawker",
  "pmet",
  "retiree",
  "student",
  "sme_owner",
  "gig_worker",
  "civil_servant",
  "landlord",
  "lower_income",
];

type StakeholderSeed = {
  stakeholderLabel: string;
  stakeholderType: PersonaProfile["stakeholderType"];
  likelyArchetype: PersonaArchetype;
  whyAffected: string;
  topConcerns: string[];
  initialStance: PersonaProfile["initialStance"];
  influenceWeight: number;
  activityLevel: number;
  visibilityTags: string[];
  sourceBasis: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeStance(sentimentScore: number): AgentTurn["stance"] {
  if (sentimentScore >= 0.2) return "supportive";
  if (sentimentScore <= -0.2) return "opposed";
  return "neutral";
}

async function parseJsonObject<T>(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<T> {
  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages,
  });

  return JSON.parse(completion.choices[0].message.content ?? "{}") as T;
}

function fallbackSeeds(count: number, sourceContext: string): StakeholderSeed[] {
  return SG_PERSONA_ARCHETYPES.slice(0, count).map((archetype, index) => ({
    stakeholderLabel: archetype.replace(/_/g, " "),
    stakeholderType: archetype === "civil_servant" ? "institution" : archetype === "sme_owner" ? "business" : "community",
    likelyArchetype: archetype,
    whyAffected: `This stakeholder is materially affected by the policy and will evaluate it through cost of living, fairness, and implementation clarity.`,
    topConcerns: ["cost of living", "fairness", "implementation clarity"],
    initialStance: index % 3 === 0 ? "opposed" : index % 3 === 1 ? "neutral" : "supportive",
    influenceWeight: index === 0 ? 1.3 : 0.9,
    activityLevel: index < 3 ? 0.8 : 0.55,
    visibilityTags: ["cost", "fairness", "singapore policy"],
    sourceBasis: sourceContext ? [sourceContext.slice(0, 120)] : ["scenario context"],
  }));
}

export async function extractStakeholderSeeds(
  scenario: ScenarioInput,
  sourceContext: string,
  count: number
): Promise<StakeholderSeed[]> {
  const parsed = await parseJsonObject<{ stakeholders?: StakeholderSeed[] }>([
    {
      role: "system",
      content:
        "You are a Singapore public-policy planner doing stakeholder mapping for a cabinet-style scenario analysis. Extract realistic stakeholder segments from source material. Think in terms of distributional effects, implementation friction, political salience, communications risk, and likely narratives. Return JSON with key stakeholders. Keep segments concrete, policy-relevant, and diverse.",
    },
    {
      role: "user",
      content: `Policy scenario:
${scenario.title}
${scenario.policyChange}

Source material:
${sourceContext}

Return ${count} stakeholder seeds. Each object must contain:
- stakeholderLabel
- stakeholderType: individual|community|business|institution
- likelyArchetype: one of ${SG_PERSONA_ARCHETYPES.join(", ")}
- whyAffected
- topConcerns: string[]
- initialStance: supportive|neutral|opposed|uncertain
- influenceWeight: 0.4 to 1.8
- activityLevel: 0.2 to 1.0
- visibilityTags: string[]
- sourceBasis: string[]`,
    },
  ]).catch(() => ({ stakeholders: [] }));

  const seeds = (parsed.stakeholders ?? []).slice(0, count);
  return seeds.length > 0 ? seeds : fallbackSeeds(count, sourceContext);
}

export async function generatePersonas(
  runId: string,
  scenario: ScenarioInput,
  sourceContext: string,
  count: number
): Promise<PersonaProfile[]> {
  const seeds = await extractStakeholderSeeds(scenario, sourceContext, count);

  const parsed = await parseJsonObject<{ personas?: PersonaProfile[] }>([
    {
      role: "system",
      content: `You are a Singapore social researcher creating stakeholder agents for a policy simulation.
Return a JSON object with key "personas".
Each persona must include all fields from the provided seeds plus:
- id
- runId: "${runId}"
- name
- age
- gender
- ethnicity
- occupation
- housingType
- monthlyIncome
- familyStatus
- bio
- postsPerRound
- stanceStrength
- sentimentBias

Requirements:
- Keep the seed's stakeholderLabel, stakeholderType, likelyArchetype -> archetype, sourceBasis, visibilityTags, influenceWeight, activityLevel, topConcerns, and initialStance aligned.
- Use realistic Singapore names and demographics.
- Influence and activity should vary.
- Make the personas feel like public stakeholders, not random fictional biographies.
- Use a policy-planning lens: affordability, fairness, trust, take-up friction, administrative burden, inter-generational impact, and likely messaging triggers.`,
    },
    {
      role: "user",
      content: `Scenario:
${scenario.title}
${scenario.policyChange}

Seeds:
${JSON.stringify(seeds, null, 2)}

Source context:
${sourceContext}`,
    },
  ]).catch(() => ({ personas: [] }));

  if ((parsed.personas ?? []).length > 0) {
    return parsed.personas!.slice(0, count).map((persona, index) => ({
      ...persona,
      runId,
      id: persona.id || `p_${persona.archetype}_${index + 1}`,
      sourceBasis: persona.sourceBasis?.length ? persona.sourceBasis : seeds[index]?.sourceBasis ?? [],
      stakeholderLabel: persona.stakeholderLabel || seeds[index]?.stakeholderLabel || persona.archetype,
      stakeholderType: persona.stakeholderType || seeds[index]?.stakeholderType || "community",
      stanceStrength: clamp(persona.stanceStrength ?? 0.6, 0, 1),
      sentimentBias: clamp(persona.sentimentBias ?? 0, -1, 1),
      activityLevel: clamp(persona.activityLevel ?? seeds[index]?.activityLevel ?? 0.5, 0.1, 1),
      postsPerRound: Math.max(1, Math.round(persona.postsPerRound ?? 1)),
      influenceWeight: clamp(persona.influenceWeight ?? seeds[index]?.influenceWeight ?? 1, 0.2, 2),
      visibilityTags: persona.visibilityTags?.length ? persona.visibilityTags : seeds[index]?.visibilityTags ?? [],
    }));
  }

  return seeds.map((seed, index) => ({
    id: `p_${seed.likelyArchetype}_${index + 1}`,
    runId,
    archetype: seed.likelyArchetype,
    sourceBasis: seed.sourceBasis,
    stakeholderLabel: seed.stakeholderLabel,
    stakeholderType: seed.stakeholderType,
    name: `Stakeholder ${index + 1}`,
    age: 35 + index,
    gender: index % 2 === 0 ? "female" : "male",
    ethnicity: "Chinese",
    occupation: seed.stakeholderLabel,
    housingType: "HDB 3-4 room",
    monthlyIncome: "$3,000-$5,000",
    familyStatus: "Lives in Singapore household",
    topConcerns: seed.topConcerns,
    initialStance: seed.initialStance,
    stanceStrength: 0.6,
    sentimentBias: seed.initialStance === "supportive" ? 0.2 : seed.initialStance === "opposed" ? -0.2 : 0,
    activityLevel: seed.activityLevel,
    postsPerRound: Math.max(1, Math.round(seed.activityLevel * 2)),
    influenceWeight: seed.influenceWeight,
    visibilityTags: seed.visibilityTags,
    bio: seed.whyAffected,
  }));
}

export async function generateAgentTurn(
  persona: PersonaProfile,
  scenario: ScenarioInput,
  round: number,
  sourceContext: string,
  memoryContext: string,
  visiblePosts: VisiblePost[]
): Promise<AgentTurn> {
  const parsed: {
    actionType?: AgentTurn["actionType"];
    reaction?: string;
    sentiment?: AgentTurn["sentiment"];
    sentimentScore?: number;
    keyPoints?: string[];
    replyToTurnId?: string;
    replyToPersonaId?: string;
    targetPersonaName?: string;
    engagementScore?: number;
  } = await parseJsonObject<{
    actionType?: AgentTurn["actionType"];
    reaction?: string;
    sentiment?: AgentTurn["sentiment"];
    sentimentScore?: number;
    keyPoints?: string[];
    replyToTurnId?: string;
    replyToPersonaId?: string;
    targetPersonaName?: string;
    engagementScore?: number;
  }>([
    {
      role: "system",
      content: `You are simulating a Singapore stakeholder in a public policy discourse.
Return JSON with:
- actionType: post|reply|endorse|ignore
- reaction
- sentiment: positive|neutral|negative
- sentimentScore: -1 to 1
- keyPoints: string[]
- replyToTurnId: optional
- replyToPersonaId: optional
- targetPersonaName: optional
- engagementScore: 0 to 1

Rules:
- In round 1, prefer post.
- In later rounds, use visible posts to decide whether to reply or endorse.
- Stay grounded in source context and the stakeholder's incentives.
- Reason like a politically aware policy stakeholder: consider fairness, implementation details, support measures, loopholes, tradeoffs, trust in government, and who wins or loses.
- Surface specific grievances or support conditions rather than generic sentiment.
- Keep reaction concise and specific.`,
    },
    {
      role: "user",
      content: `You are ${persona.name}, a ${persona.age}-year-old ${persona.occupation}.
Stakeholder: ${persona.stakeholderLabel} (${persona.stakeholderType})
Archetype: ${persona.archetype}
Bio: ${persona.bio}
Income: ${persona.monthlyIncome}
Housing: ${persona.housingType}
Family: ${persona.familyStatus}
Top concerns: ${persona.topConcerns.join(", ")}
Initial stance: ${persona.initialStance}
Influence: ${persona.influenceWeight}
Activity: ${persona.activityLevel}

Policy round ${round}:
${scenario.policyChange}

Relevant sources:
${sourceContext}

${memoryContext ? `Your previous memory:\n${memoryContext}\n` : ""}
${visiblePosts.length > 0 ? `Visible public feed:\n${visiblePosts.map((post) => `- ${post.personaName} [${post.actionType}/${post.stance}] (${post.sentimentScore.toFixed(2)}): ${post.content}`).join("\n")}` : "No public posts are visible yet."}`,
    },
  ]).catch(() => ({} as {
    actionType?: AgentTurn["actionType"];
    reaction?: string;
    sentiment?: AgentTurn["sentiment"];
    sentimentScore?: number;
    keyPoints?: string[];
    replyToTurnId?: string;
    replyToPersonaId?: string;
    targetPersonaName?: string;
    engagementScore?: number;
  }));

  const sentimentScore = clamp(
    typeof parsed.sentimentScore === "number"
      ? parsed.sentimentScore
      : persona.initialStance === "supportive"
        ? 0.35
        : persona.initialStance === "opposed"
          ? -0.35
          : 0,
    -1,
    1
  );

  return {
    id: crypto.randomUUID(),
    personaId: persona.id,
    personaName: persona.name,
    archetype: persona.archetype,
    round,
    actionType: parsed.actionType ?? (round === 1 ? "post" : visiblePosts.length ? "reply" : "post"),
    stance: normalizeStance(sentimentScore),
    reaction: parsed.reaction ?? `${persona.name} is still weighing how the policy affects ${persona.stakeholderLabel}.`,
    sentiment: parsed.sentiment ?? (sentimentScore > 0.2 ? "positive" : sentimentScore < -0.2 ? "negative" : "neutral"),
    sentimentScore,
    keyPoints: parsed.keyPoints?.slice(0, 4) ?? persona.topConcerns.slice(0, 3),
    replyToTurnId: parsed.replyToTurnId,
    replyToPersonaId: parsed.replyToPersonaId,
    targetPersonaName: parsed.targetPersonaName,
    visiblePosts,
    engagementScore: clamp(parsed.engagementScore ?? persona.activityLevel * persona.influenceWeight * 0.5, 0, 1),
    influenceWeight: persona.influenceWeight,
    memoryContext: memoryContext || undefined,
  };
}

export function createInteractionEvent(runId: string, turn: AgentTurn): InteractionEvent | null {
  if (turn.actionType === "ignore") return null;
  return {
    id: `interaction_${turn.id}`,
    runId,
    round: turn.round,
    fromPersonaId: turn.personaId,
    fromPersonaName: turn.personaName,
    toPersonaId: turn.replyToPersonaId,
    toPersonaName: turn.targetPersonaName,
    type: turn.actionType,
    content: turn.reaction,
    sentimentScore: turn.sentimentScore,
    keyPoints: turn.keyPoints,
    influenceWeight: turn.influenceWeight,
    engagementScore: turn.engagementScore,
  };
}

export async function generateRoundSummary(
  round: number,
  runId: string,
  scenario: ScenarioInput,
  turns: AgentTurn[]
): Promise<RoundSummary> {
  const turnSummaries = turns
    .map((t) => `${t.personaName} [${t.actionType}/${t.stance}] ${t.reaction} (engagement ${t.engagementScore.toFixed(2)})`)
    .join("\n");

  const parsed: Partial<RoundSummary> = await parseJsonObject<Partial<RoundSummary>>([
    {
      role: "system",
      content: `You are a Singapore policy analyst. Summarize a social simulation round.
Return JSON with:
- overallSentiment
- sentimentBreakdown
- topConcerns
- archetypeStances
- polarizationScore
- flashpoints
- coalitions
- mostInfluentialTurns: [{ turnId, personaName, actionType, engagementScore }]
- summary

Analyze like a policy planner:
- distinguish intensity from volume
- identify implementability risks and communications risks
- note which groups could be persuaded with clarifications or offsets
- flag narratives that could broaden beyond the directly affected group`,
    },
    {
      role: "user",
      content: `Policy: ${scenario.title}
Round ${round} activity:
${turnSummaries}`,
    },
  ]).catch(() => ({} as Partial<RoundSummary>));

  const positives = turns.filter((t) => t.sentiment === "positive").length;
  const neutrals = turns.filter((t) => t.sentiment === "neutral").length;
  const negatives = turns.filter((t) => t.sentiment === "negative").length;
  const avgSentiment = turns.length ? turns.reduce((sum, t) => sum + t.sentimentScore, 0) / turns.length : 0;
  const polarization = turns.length
    ? turns.reduce((sum, t) => sum + Math.abs(t.sentimentScore - avgSentiment), 0) / turns.length
    : 0;

  return {
    round,
    runId,
    overallSentiment: clamp(finiteNumber(parsed.overallSentiment, avgSentiment), -1, 1),
    sentimentBreakdown: parsed.sentimentBreakdown && typeof parsed.sentimentBreakdown === "object"
      ? {
          positive: Math.max(0, Math.round(finiteNumber(parsed.sentimentBreakdown.positive, positives))),
          neutral: Math.max(0, Math.round(finiteNumber(parsed.sentimentBreakdown.neutral, neutrals))),
          negative: Math.max(0, Math.round(finiteNumber(parsed.sentimentBreakdown.negative, negatives))),
        }
      : {
          positive: positives,
          neutral: neutrals,
          negative: negatives,
        },
    topConcerns: Array.isArray(parsed.topConcerns)
      ? parsed.topConcerns.slice(0, 5).filter((item): item is string => typeof item === "string")
      : Array.from(new Set(turns.flatMap((t) => t.keyPoints))).slice(0, 5),
    archetypeStances: (parsed.archetypeStances as RoundSummary["archetypeStances"]) ?? Object.fromEntries(
      SG_PERSONA_ARCHETYPES.map((archetype) => {
        const match = turns.find((turn) => turn.archetype === archetype);
        return [archetype, match?.stance ?? "neutral"];
      })
    ) as RoundSummary["archetypeStances"],
    polarizationScore: clamp(finiteNumber(parsed.polarizationScore, polarization), 0, 1),
    flashpoints: Array.isArray(parsed.flashpoints)
      ? parsed.flashpoints.slice(0, 4).filter((item): item is string => typeof item === "string")
      : Array.from(new Set(turns.filter((t) => t.actionType === "reply" || t.sentiment === "negative").flatMap((t) => t.keyPoints))).slice(0, 4),
    coalitions: Array.isArray(parsed.coalitions)
      ? parsed.coalitions.slice(0, 4).filter((item): item is string => typeof item === "string")
      : Array.from(new Set(turns.filter((t) => t.sentimentScore > 0.15).map((t) => `${t.personaName} leaning supportive`))).slice(0, 4),
    mostInfluentialTurns: Array.isArray(parsed.mostInfluentialTurns) ? parsed.mostInfluentialTurns.slice(0, 4).map((turn) => ({
      turnId: typeof turn.turnId === "string" ? turn.turnId : "",
      personaName: typeof turn.personaName === "string" ? turn.personaName : "Unknown",
      actionType: turn.actionType === "post" || turn.actionType === "reply" || turn.actionType === "endorse" || turn.actionType === "ignore" ? turn.actionType : "post",
      engagementScore: clamp(finiteNumber(turn.engagementScore, 0), 0, 1),
    })) : turns
      .slice()
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 4)
      .map((turn) => ({
        turnId: turn.id,
        personaName: turn.personaName,
        actionType: turn.actionType,
        engagementScore: turn.engagementScore,
      })),
    summary: parsed.summary ?? `Round ${round} produced a ${avgSentiment > 0.2 ? "generally supportive" : avgSentiment < -0.2 ? "largely skeptical" : "mixed"} response, with debate concentrating around ${Array.from(new Set(turns.flatMap((t) => t.keyPoints))).slice(0, 2).join(" and ") || "implementation details"}.`,
  };
}

export async function generateReportOutline(
  scenario: ScenarioInput
): Promise<Array<{ id: string; title: string }>> {
  const parsed = await parseJsonObject<{ sections?: Array<{ id: string; title: string }> }>([
    {
      role: "system",
      content: "You are planning a concise Singapore policy simulation report. Return JSON with key sections.",
    },
    {
      role: "user",
      content: `Scenario: ${scenario.title}
${scenario.policyChange}

Return 5 sections that cover policy context, stakeholder dynamics, risks, and recommendations.`,
    },
  ]).catch(() => ({ sections: [] }));

  return parsed.sections?.length
    ? parsed.sections
    : [
        { id: "policy_summary", title: "Policy Summary" },
        { id: "stakeholder_map", title: "Stakeholder Map" },
        { id: "distributional_effects", title: "Distributional Effects" },
        { id: "social_dynamics", title: "Social Dynamics" },
        { id: "risk_hotspots", title: "Risk Hotspots" },
        { id: "recommendations", title: "Recommended Messaging & Mitigations" },
      ];
}

export function buildSectionQuery(sectionId: string, scenario: ScenarioInput): string {
  const prompts: Record<string, string> = {
    policy_summary: `${scenario.title} official rationale implementation details`,
    stakeholder_map: `${scenario.title} affected groups stakeholder tensions`,
    distributional_effects: `${scenario.title} winners losers affordability fairness implementation burden`,
    social_dynamics: `${scenario.title} interactions debate reactions`,
    risk_hotspots: `${scenario.title} negative reaction flashpoints risks`,
    recommendations: `${scenario.title} mitigations communications recommendations`,
  };
  return prompts[sectionId] ?? `${scenario.title} policy reactions`;
}

export async function generateReportSection(
  sectionId: string,
  sectionTitle: string,
  order: number,
  scenario: ScenarioInput,
  evidence: ReportEvidenceItem[],
  allContext: string
): Promise<ReportSection> {
  const sectionPrompts: Record<string, string> = {
    policy_summary: "Summarize the policy, official rationale, timing, design choices, and implementation facts that matter for downstream stakeholder reaction.",
    stakeholder_map: "Explain which stakeholder segments matter most, what motivates them, where influence is concentrated, and which groups are loud versus materially affected.",
    distributional_effects: "Assess first-order and second-order effects across income bands, household types, businesses, institutions, and edge-case groups. Distinguish direct impact from perceived unfairness.",
    social_dynamics: "Describe how the public discourse evolved across rounds, including replies, endorsements, amplification, coalition formation, and narrative spread.",
    risk_hotspots: "Identify the strongest resistance points, who amplified them, whether they are substantive or narrative-driven, and why they may become policy or communications problems.",
    recommendations: "Give practical recommendations for policy messaging, sequencing, offsets, implementation clarifications, and mitigation design. Prioritize what a Singapore policy team should do next.",
  };

  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a senior Singapore government policy analyst writing an internal planning memo. Use only the supplied evidence and simulation context. Prefer concrete judgments about affected groups, delivery risk, trust, political salience, and mitigation options over generic prose.",
      },
      {
        role: "user",
        content: `Policy:
${scenario.title}
${scenario.policyChange}

Evidence:
${evidence.map((item) => `- [${item.type}] ${item.title}: ${item.snippet}`).join("\n")}

Context:
${allContext}

Task:
${sectionPrompts[sectionId] ?? `Write the ${sectionTitle} section.`}

Requirements:
- use markdown
- prefer short paragraphs and flat bullets
- explicitly separate substantive policy risk from narrative/communications risk when relevant
- mention implementation assumptions, support measures, and uncertainty where relevant
- write like a policy planner, not a journalist`,
      },
    ],
  });

  return {
    id: sectionId,
    title: sectionTitle,
    order,
    content: completion.choices[0].message.content ?? "",
    evidence,
  };
}
