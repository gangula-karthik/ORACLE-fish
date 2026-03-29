import { NextRequest } from "next/server";
import { createInteractionEvent, generateAgentTurn, generateRoundSummary } from "@/lib/openai-client";
import {
  getInteractionContext,
  saveAgentTurn,
  saveInteraction,
  saveRoundSummary,
  saveRunMeta,
  searchSources,
  getPersonaMemory,
} from "@/lib/supermemory";
import { createSSEStream } from "@/lib/sse";
import type { PersonaProfile, ScenarioInput, AgentTurn, VisiblePost } from "@/lib/types";

function pickVisiblePosts(persona: PersonaProfile, previousTurns: AgentTurn[]): VisiblePost[] {
  return previousTurns
    .filter((turn) => turn.personaId !== persona.id)
    .map((turn) => {
      const sharedTags = persona.visibilityTags.filter((tag) =>
        turn.keyPoints.some((point) => point.toLowerCase().includes(tag.toLowerCase()))
      ).length;
      const stanceBonus = turn.stance === persona.initialStance ? 0.15 : 0;
      const salience = turn.engagementScore + turn.influenceWeight * 0.35 + sharedTags * 0.08 + stanceBonus;
      return { turn, salience };
    })
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 3)
    .map(({ turn }) => ({
      turnId: turn.id,
      personaId: turn.personaId,
      personaName: turn.personaName,
      round: turn.round,
      actionType: turn.actionType,
      stance: turn.stance,
      sentimentScore: turn.sentimentScore,
      content: turn.reaction,
      influenceWeight: turn.influenceWeight,
    }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const { send, close, response } = createSSEStream();

  (async () => {
    try {
      const scenarioParam = req.nextUrl.searchParams.get("scenario");
      const personasParam = req.nextUrl.searchParams.get("personas");

      if (!scenarioParam || !personasParam) {
        send({ type: "error", message: "scenario and personas query params are required" });
        close();
        return;
      }

      const scenario: ScenarioInput = JSON.parse(decodeURIComponent(scenarioParam));
      const personas: PersonaProfile[] = JSON.parse(decodeURIComponent(personasParam));
      const totalRounds = scenario.roundCount;

      await saveRunMeta(runId, { status: "simulating", updatedAt: new Date().toISOString() });

      // Pull source context once (shared across rounds)
      const sourceContext = await searchSources(runId, scenario.policyChange, 5);
      const allTurns: AgentTurn[] = [];

      for (let round = 1; round <= totalRounds; round++) {
        send({ type: "round_started", round, totalRounds });

        const turns: AgentTurn[] = [];

        for (const persona of personas) {
          // Retrieve persona's memory from prior rounds
          const memoryContext = round > 1
            ? await getPersonaMemory(runId, persona.id, scenario.policyChange)
            : "";
          const socialContext = round > 1
            ? await getInteractionContext(runId, `${persona.stakeholderLabel} ${scenario.policyChange}`, 4)
            : "";
          const visiblePosts = round > 1 ? pickVisiblePosts(persona, allTurns) : [];

          const turn = await generateAgentTurn(
            persona,
            scenario,
            round,
            sourceContext,
            [memoryContext, socialContext].filter(Boolean).join("\n\n"),
            visiblePosts
          );

          // Persist turn to Super Memory
          await saveAgentTurn(runId, turn);
          send({ type: "memory_saved", personaId: persona.id });

          const interaction = createInteractionEvent(runId, turn);
          if (interaction) {
            await saveInteraction(runId, interaction);
            send({ type: "interaction", interaction });
          }

          send({ type: "agent_response", turn });
          turns.push(turn);
          allTurns.push(turn);
        }

        // Summarise the round
        const summary = await generateRoundSummary(round, runId, scenario, turns);
        await saveRoundSummary(runId, summary);
        send({ type: "round_summary", summary });
      }

      await saveRunMeta(runId, { status: "simulation_complete", updatedAt: new Date().toISOString() });
      send({ type: "complete", totalRounds });
    } catch (err) {
      console.error("[simulate/stream]", err);
      send({ type: "error", message: (err as Error).message });
      await saveRunMeta(runId, { status: "error", error: (err as Error).message, updatedAt: new Date().toISOString() });
    } finally {
      close();
    }
  })();

  return response;
}
