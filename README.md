# Oracle Fish

Oracle Fish is an AI-assisted policy simulation workbench built for Singapore-focused public policy scenarios. It lets a user define a policy change, gather supporting context from official sources, generate representative citizen personas, simulate multi-round reactions, and produce a structured report for communications and policy review.

The project is implemented as a Next.js 16 App Router application with a streaming workflow. Scraping, simulation, and report generation are exposed as Server-Sent Events (SSE) endpoints so the UI can surface progress incrementally instead of blocking on long-running requests.

## Why This Exists

Policy teams rarely fail because they lack raw information. They fail because the information is fragmented across official statements, parliamentary debate, agency pages, public sentiment, and internal assumptions about how different demographic groups will respond.

Oracle Fish narrows that gap by combining:

- targeted source extraction from Singapore government and public-sector pages
- structured persona generation grounded in the selected scenario
- round-based simulation with memory across persona turns
- source-backed reporting that turns raw simulation output into decision-ready analysis

This is not a forecasting engine and should not be treated as one. It is a structured exploratory tool for testing narratives, identifying stakeholder sensitivities, and surfacing messaging or implementation risks early.

## Product Workflow

The user experience follows a four-step flow:

1. `Scenario`
   The user selects a preset policy scenario or defines a custom one. They also choose round count, persona count, and search depth.
2. `Sources`
   The system scrapes relevant Singapore policy sources and streams progress back to the client.
3. `Simulate`
   The system generates personas, runs multiple rounds of persona reactions, stores round memory, and emits summaries.
4. `Report`
   The system produces a structured policy assessment report section by section.

The app also supports local browser caching. If the same scenario configuration has already been run on the same client, Oracle Fish can restore the completed result immediately without repeating the pipeline.

## Key Capabilities

- Scenario presets for common Singapore policy topics such as GST, transport fares, housing, and CPF.
- Custom policy scenario support.
- Source scraping via `@tiny-fish/sdk`.
- Fallback document support when live scraping fails or returns no usable excerpts.
- Persona generation with Singapore-specific demographic and socio-economic archetypes.
- Multi-round simulation with per-persona memory retrieval from stored prior turns.
- Incremental report generation with section-level streaming progress.
- Zustand-based client orchestration.
- Supermemory-backed persistence for scenarios, sources, personas, round summaries, and report sections.
- Local browser caching of completed runs.

## Technical Overview

### Stack

- `Next.js 16.2.1`
- `React 19`
- `TypeScript`
- `Tailwind CSS 4`
- `Zustand`
- `OpenAI Node SDK`
- `Supermemory`
- `@tiny-fish/sdk`
- `d3` for graph-oriented report visualization support

### Runtime Model

Oracle Fish uses a split execution model:

- The browser owns interaction state, step progression, and cached run restoration.
- Next.js route handlers own orchestration for creating runs, scraping sources, generating personas, simulating reactions, and building report sections.
- Supermemory acts as the persistence and retrieval layer for run artifacts.
- OpenAI is used for persona generation, per-round agent responses, and report writing.
- TinyFish is used to navigate and extract relevant policy information from source pages.

### Streaming Model

Long-running operations are implemented as SSE streams rather than standard request/response endpoints. This is a good fit for the product because each major stage has useful intermediate states:

- source start and source completion during scraping
- round start and persona turn events during simulation
- outline creation and per-section completion during report generation

The helper in [`src/lib/sse.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/sse.ts) builds the stream response and serializes events consistently.

## Architecture

### High-Level Flow

1. The client creates a run via `POST /api/runs`.
2. The run metadata and scenario are persisted to Supermemory.
3. The client opens the scrape SSE endpoint.
4. Scraped source documents are persisted to Supermemory as they are discovered.
5. The client requests persona generation via `POST /api/runs/[runId]/personas`.
6. Personas are generated with OpenAI and persisted to Supermemory.
7. The client opens the simulation SSE endpoint.
8. Each round retrieves source context and persona memory, generates turns, persists them, and stores a round summary.
9. The client opens the report SSE endpoint.
10. The report outline is emitted, each section is generated with OpenAI, and sections are persisted as they complete.

### Persistence Strategy

The code treats Supermemory as a tagged document store rather than a conventional relational database. Each run is split into logical containers:

- `meta`
- `scenario`
- `sources`
- `personas`
- `rounds`
- `report`

The tagging logic lives in [`src/lib/supermemory.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/supermemory.ts). This is a pragmatic design for a hackathon-grade product because:

- it avoids introducing a separate database migration workflow
- search and retrieval are simple to implement
- generated artifacts remain queryable by semantic relevance

The tradeoff is that consistency guarantees are weaker than in a transactional database. If you continue building the product, this is one of the first architectural seams worth revisiting.

### Client State Model

The UI state is centralized in a Zustand store at [`src/lib/store.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/store.ts). It tracks:

- the active run and step
- streamed source documents
- scrape logs
- personas
- agent turns
- round summaries
- report outline and sections
- loading and error states
- cache restoration flags

This keeps the page-level component tree thin and makes the step orchestration easier to reason about.

### Local Cache Model

Completed runs can be cached in browser storage using [`src/lib/cache.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/cache.ts). The cache key is derived from:

- preset or title
- policy text
- round count
- persona count
- search limit

This is intentionally simple and local. It improves demo responsiveness but should not be mistaken for durable persistence.

## Repository Structure

```text
src/
  app/
    api/
      runs/
        route.ts                         Create a run
        [runId]/
          route.ts                       Fetch run metadata
          personas/route.ts              Generate personas
          scrape/route.ts                Stream source extraction
          simulate/route.ts              Stream round simulation
          report/route.ts                Stream report generation
    layout.tsx                           Global metadata and shell
    page.tsx                             Single-page workflow host
  components/
    simulator/                           Step-specific UI
    ui/                                  Shared UI primitives
  lib/
    openai-client.ts                     LLM prompts and generation
    supermemory.ts                       Persistence and retrieval
    fallback-documents.ts                Offline-safe source fallbacks
    sse.ts                               SSE helpers
    store.ts                             Zustand client store
    cache.ts                             Browser cache helpers
    types.ts                             Domain types and presets
```

## API Surface

### `POST /api/runs`

Creates a run record and persists the scenario.

Expected payload:

```json
{
  "title": "GST Increase: 9% → 10%",
  "policyChange": "The Singapore government is proposing...",
  "description": "",
  "presetId": "gst_9_to_10",
  "roundCount": 3,
  "personaCount": 10,
  "searchLimit": 2,
  "sources": []
}
```

### `GET /api/runs/[runId]`

Returns the latest stored run metadata from Supermemory.

### `GET /api/runs/[runId]/scrape`

SSE endpoint that:

- marks the run as `scraping`
- visits a subset of predefined policy sources
- attempts to extract structured content from those pages
- stores source excerpts as documents
- falls back to prepared documents if scraping fails or returns zero excerpts

### `POST /api/runs/[runId]/personas`

Generates personas from the selected scenario and retrieved source context.

### `GET /api/runs/[runId]/simulate`

SSE endpoint that:

- marks the run as `simulating`
- iterates through configured rounds
- retrieves persona memory from prior rounds
- generates persona reactions
- persists turns and round summaries

### `GET /api/runs/[runId]/report`

SSE endpoint that:

- marks the run as `generating_report`
- emits a report outline
- generates each report section
- persists sections
- marks the run as `complete`

## Domain Model

The primary domain types are defined in [`src/lib/types.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/types.ts).

Important concepts:

- `Run`
  Encapsulates the lifecycle of a single policy simulation.
- `ScenarioInput`
  Defines the policy prompt, execution parameters, and source settings.
- `SourceDocument`
  Represents an extracted policy excerpt from a source.
- `PersonaProfile`
  Represents one simulated citizen persona.
- `AgentTurn`
  Captures a persona reaction for a given round.
- `RoundSummary`
  Stores aggregate sentiment and concerns for a round.
- `ReportSection`
  Stores one generated section of the final report.

## Environment Variables

The application depends on external services. At minimum, define the following in `.env.local`:

```bash
OPENAI_API_KEY=your_openai_api_key
SUPERMEMORY_API_KEY=your_supermemory_api_key
```

Notes:

- `OPENAI_API_KEY` is required by [`src/lib/openai-client.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/openai-client.ts).
- `SUPERMEMORY_API_KEY` is required by [`src/lib/supermemory.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/supermemory.ts).
- The scraping flow uses `@tiny-fish/sdk`. If that SDK requires additional credentials or environment-level setup in your deployment environment, configure them according to your TinyFish account and runtime setup.

If these variables are missing, the application will fail at request time rather than build time because both clients are lazily initialized.

## Local Development

### Prerequisites

- Node.js 20 or newer is the practical baseline for current Next.js 16 development
- npm
- valid OpenAI credentials
- valid Supermemory credentials
- network access to the external services used by the app

### Install

```bash
npm install
```

### Configure Environment

```bash
cp .env.example .env.local
```

If you do not have `.env.example`, create `.env.local` manually with the variables listed above.

### Run the Development Server

```bash
npm run dev
```

Then open `http://localhost:3000`.

### Lint

```bash
npm run lint
```

At the time of writing, the repository has lint warnings in a few simulator files related to unused variables and hook dependency arrays. Those are worth cleaning up, but they do not block local development.

## Build and Production Start

```bash
npm run build
npm run start
```

This is a standard Next.js production flow. In production, pay particular attention to:

- request duration limits for streaming endpoints
- outbound access to OpenAI, Supermemory, and TinyFish
- buffering behavior on the hosting platform for SSE responses

## Prompting and AI Behavior

The LLM orchestration lives in [`src/lib/openai-client.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/openai-client.ts).

Current behavior includes:

- `generatePersonas`
  Produces a fixed set of Singapore-relevant persona archetypes using `gpt-4o`.
- `generateAgentTurn`
  Produces first-person reactions and structured sentiment metadata.
- `generateRoundSummary`
  Produces aggregate analysis for each simulation round.
- `generateReportSection`
  Produces section content for the final report.

Important implementation notes:

- The current code uses `chat.completions.create`.
- The model is hardcoded to `gpt-4o`.
- Response validation is minimal. JSON parsing is attempted, but there is no robust schema enforcement.

If you continue developing this system, stronger response validation should be near the top of the backlog.

## Scraping and Fallback Strategy

The scrape route at [`src/app/api/runs/[runId]/scrape/route.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/app/api/runs/[runId]/scrape/route.ts) does two important things well for a demo-grade system:

- it streams progress so the UI remains alive during long navigation/extraction work
- it degrades gracefully to prepared fallback documents

The fallback set in [`src/lib/fallback-documents.ts`](/Users/karthikgangula/Downloads/tinyfish_hackathon/sg-policy-simulator/src/lib/fallback-documents.ts) is important. It prevents the end-to-end experience from collapsing when:

- a source site changes structure
- a scrape times out
- the extraction result is unparsable
- the upstream source returns no useful excerpts

This is exactly the sort of resilience pattern that matters in demos and hackathon environments.

## Known Limitations

- The app is optimized for demonstration and exploration, not for formal policy evaluation.
- Source coverage is narrow and partially hardcoded.
- There is no robust schema validation around model responses.
- Supermemory is being used as a document-oriented persistence layer, which is flexible but not strongly structured.
- Persona generation is heuristic and prompt-driven rather than calibrated against empirical public opinion data.
- The report pipeline currently uses source search context, but the report generation path should be reviewed to ensure round-level simulation outputs are incorporated as deeply as intended.
- SSE reliability depends on hosting behavior. Some proxies buffer or terminate long-lived streams.
- There is no authentication or multi-tenant isolation layer.

## Engineering Recommendations

If this project moves beyond hackathon scope, I would prioritize the following:

1. Add explicit runtime schema validation for all model outputs.
2. Move run persistence to a transactional store for metadata integrity.
3. Separate source evidence, simulation memory, and report artifacts into clearer storage boundaries.
4. Add replayable job orchestration rather than handling all long-running work directly inside request handlers.
5. Add observability around token usage, latency, source failures, and per-stage success rates.
6. Replace hardcoded source sets with configurable source registries.
7. Add authentication, authorization, and retention policies before handling any sensitive workflows.
8. Add evaluation harnesses for persona realism, sentiment consistency, and report usefulness.

## Troubleshooting

### The app loads but simulation does nothing

Check:

- `OPENAI_API_KEY`
- `SUPERMEMORY_API_KEY`
- server logs for route handler errors
- browser network tab for SSE failures

### Scraping produces no results

This may still be a healthy run. The app will fall back to prepared documents when live extraction fails.

### SSE appears stuck behind a proxy

Verify that your hosting environment does not buffer `text/event-stream` responses and allows long-lived responses.

### A run exists but report data looks incomplete

Inspect:

- the run metadata endpoint
- stored source availability
- whether persona generation completed successfully
- whether the report stream emitted all section completion events

## Contributing

If you are extending the project, keep these standards in mind:

- prefer small, verifiable changes over broad speculative rewrites
- keep prompts and domain types aligned
- preserve SSE event compatibility when changing stream payloads
- document new environment variables and external dependencies immediately
- treat generated text as untrusted until validated

## Current Repository Status

This repository already contains meaningful product code beyond the default Next.js starter. The README was rewritten to reflect the real architecture in the codebase rather than the generic framework bootstrap template.

## License

No license file is currently present in the repository. Until one is added, assume the code is not licensed for external reuse by default.
