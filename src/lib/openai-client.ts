import OpenAI from "openai";
import type {
  PersonaProfile,
  PersonaArchetype,
  AgentTurn,
  RoundSummary,
  ReportSection,
  ScenarioInput,
} from "./types";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

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

// ─── Persona Generation ──────────────────────────────────────────────────────

export async function generatePersonas(
  runId: string,
  scenario: ScenarioInput,
  sourceContext: string,
  count: number
): Promise<PersonaProfile[]> {
  const archetypes = SG_PERSONA_ARCHETYPES.slice(0, count);

  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a Singapore social researcher. Generate realistic Singapore citizen personas for a policy simulation.
Return a JSON object with key "personas" containing an array of persona objects.

Each persona must have:
- id: string (unique, e.g. "p_hdb_family_1")
- runId: "${runId}"
- archetype: one of the provided archetypes
- name: realistic Singapore name reflecting diverse ethnicity (Chinese ~74%, Malay ~13%, Indian ~9%, Others ~4%)
- age: number
- gender: "male" | "female"
- ethnicity: "Chinese" | "Malay" | "Indian" | "Eurasian" | "Others"
- occupation: string
- housingType: "HDB 1-2 room" | "HDB 3-4 room" | "HDB 5 room/EA" | "Condo" | "Landed" | "Renting"
- monthlyIncome: string (range, e.g. "$2,000–$3,500")
- familyStatus: string
- topConcerns: string[] (3-4 items, specific to this persona and the policy)
- initialStance: "supportive" | "neutral" | "opposed" | "uncertain"
- bio: string (2-3 sentences giving context and how this policy affects them specifically)`,
      },
      {
        role: "user",
        content: `Policy scenario: ${scenario.title}
${scenario.policyChange}

Background context from Singapore sources:
${sourceContext}

Generate ${count} personas with these archetypes: ${archetypes.join(", ")}
Make them realistic and representative of Singapore's diverse society.`,
      },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content ?? "{}");
  return (parsed.personas ?? []) as PersonaProfile[];
}

// ─── Agent Turn ───────────────────────────────────────────────────────────────

export async function generateAgentTurn(
  persona: PersonaProfile,
  scenario: ScenarioInput,
  round: number,
  sourceContext: string,
  memoryContext: string
): Promise<AgentTurn> {
  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are simulating a Singapore citizen's reaction to a government policy.
Stay in character. Respond as this person would in real life — on social media, to family, or in a forum post.
Return a JSON object with:
- reaction: string (their authentic response, 2-4 sentences, first-person voice)
- sentiment: "positive" | "neutral" | "negative"
- sentimentScore: number from -1.0 (very negative) to 1.0 (very positive)
- keyPoints: string[] (2-3 key concerns or views they express)`,
      },
      {
        role: "user",
        content: `You are: ${persona.name}, ${persona.age}-year-old ${persona.gender} ${persona.ethnicity} ${persona.occupation}.
Housing: ${persona.housingType}. Income: ${persona.monthlyIncome}. ${persona.familyStatus}.
Bio: ${persona.bio}
Top concerns: ${persona.topConcerns.join(", ")}

Policy (Round ${round}): ${scenario.policyChange}

Relevant government sources:
${sourceContext}

${memoryContext ? `Your previous reactions:\n${memoryContext}\n` : ""}
How do you feel about this policy right now?`,
      },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content ?? "{}");
  return {
    personaId: persona.id,
    personaName: persona.name,
    archetype: persona.archetype,
    round,
    reaction: parsed.reaction ?? "",
    sentiment: parsed.sentiment ?? "neutral",
    sentimentScore: parsed.sentimentScore ?? 0,
    keyPoints: parsed.keyPoints ?? [],
    memoryContext: memoryContext || undefined,
  };
}

// ─── Round Summary ────────────────────────────────────────────────────────────

export async function generateRoundSummary(
  round: number,
  runId: string,
  scenario: ScenarioInput,
  turns: AgentTurn[]
): Promise<RoundSummary> {
  const turnSummaries = turns
    .map((t) => `${t.personaName} (${t.archetype}): ${t.reaction} [sentiment: ${t.sentimentScore.toFixed(2)}]`)
    .join("\n");

  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a Singapore policy analyst. Summarize a simulation round.
Return JSON with:
- overallSentiment: number -1 to 1
- sentimentBreakdown: { positive: number, neutral: number, negative: number } (counts)
- topConcerns: string[] (top 3-4 concerns from all personas)
- archetypeStances: object mapping each archetype to "supportive"|"neutral"|"opposed"
- summary: string (2-3 sentence analyst summary of public mood)`,
      },
      {
        role: "user",
        content: `Policy: ${scenario.title}\n\nRound ${round} agent reactions:\n${turnSummaries}`,
      },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content ?? "{}");
  return {
    round,
    runId,
    overallSentiment: parsed.overallSentiment ?? 0,
    sentimentBreakdown: parsed.sentimentBreakdown ?? { positive: 0, neutral: 0, negative: 0 },
    topConcerns: parsed.topConcerns ?? [],
    archetypeStances: parsed.archetypeStances ?? {},
    summary: parsed.summary ?? "",
  };
}

// ─── Report Outline ───────────────────────────────────────────────────────────

export async function generateReportOutline(
  scenario: ScenarioInput
): Promise<Array<{ id: string; title: string }>> {
  return [
    { id: "policy_summary", title: "Policy Summary" },
    { id: "source_evidence", title: "Source-Backed Evidence" },
    { id: "persona_breakdown", title: "Persona Reaction Breakdown" },
    { id: "risk_hotspots", title: "Risk Hotspots" },
    { id: "recommendations", title: "Recommended Messaging & Mitigations" },
  ];
}

// ─── Report Section ───────────────────────────────────────────────────────────

export async function generateReportSection(
  sectionId: string,
  sectionTitle: string,
  order: number,
  scenario: ScenarioInput,
  allContext: string
): Promise<ReportSection> {
  const sectionPrompts: Record<string, string> = {
    policy_summary: `Write a clear 2-3 paragraph summary of the policy change, its official rationale, and key details for a government communications team.`,
    source_evidence: `Summarize the key facts, statistics, and statements from parliamentary debates and official sources that are relevant to understanding public impact.`,
    persona_breakdown: `Analyze the simulated reactions across the 10 Singapore citizen archetypes. Group by most affected vs. less affected. Include quotes or representative reactions.`,
    risk_hotspots: `Identify the top 3-4 population segments at highest risk of strong negative reaction. Explain why and what their core grievances are.`,
    recommendations: `Provide 4-5 specific, actionable messaging and policy mitigation recommendations for the Singapore government's communications team. Be specific to Singapore's context and social norms.`,
  };

  const prompt = sectionPrompts[sectionId] ?? `Write the ${sectionTitle} section of the policy impact report.`;

  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a Singapore government policy communications expert writing a confidential impact assessment report.
Write in a professional, analytical tone. Use specific Singapore references. Be concise but thorough.`,
      },
      {
        role: "user",
        content: `Policy: ${scenario.title}
${scenario.policyChange}

Simulation data and sources:
${allContext}

${prompt}`,
      },
    ],
  });

  return {
    id: sectionId,
    title: sectionTitle,
    content: completion.choices[0].message.content ?? "",
    order,
  };
}
