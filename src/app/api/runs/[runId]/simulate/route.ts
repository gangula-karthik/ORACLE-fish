import { NextRequest } from "next/server";
import { generateAgentTurn, generateRoundSummary } from "@/lib/openai-client";
import {
  saveAgentTurn,
  saveRoundSummary,
  saveRunMeta,
  searchSources,
  getPersonaMemory,
} from "@/lib/supermemory";
import { createSSEStream } from "@/lib/sse";
import type { PersonaProfile, ScenarioInput, AgentTurn } from "@/lib/types";

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

      for (let round = 1; round <= totalRounds; round++) {
        send({ type: "round_started", round, totalRounds });

        const turns: AgentTurn[] = [];

        for (const persona of personas) {
          // Retrieve persona's memory from prior rounds
          const memoryContext = round > 1
            ? await getPersonaMemory(runId, persona.id, scenario.policyChange)
            : "";

          const turn = await generateAgentTurn(
            persona,
            scenario,
            round,
            sourceContext,
            memoryContext
          );

          // Persist turn to Super Memory
          await saveAgentTurn(runId, round, persona.id, persona.name, turn.reaction);
          send({ type: "memory_saved", personaId: persona.id });

          send({ type: "agent_response", turn });
          turns.push(turn);
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
