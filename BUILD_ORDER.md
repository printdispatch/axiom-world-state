# BUILD_ORDER.md

## Purpose

This document defines the recommended implementation order for the Axiom World State system.

The goal is to ensure the system becomes functional early, rather than attempting to implement all subsystems simultaneously.

The build should proceed in layers:

1. Signal ingestion
2. Six-layer processing
3. World state mutation
4. Feed rendering
5. Review mechanisms
6. Expanded introspection and automation

Each stage must work before the next begins.

## Phase 1 — Core Signal Pipeline ✅ COMPLETE

Goal: the system can ingest a signal and store it.

Implemented:
- `src/signals/signal_gateway.ts` — Single entry point for all incoming signals
- `src/signals/signal_store.ts` — Append-only JSON-backed signal persistence
- `src/signals/adapters/gmail_adapter.ts` — Gmail message → Signal converter
- `src/event_bus.ts` — In-process typed EventBus (Node.js EventEmitter)

Responsibilities:
- Accept external signals
- Normalize into Signal objects
- Persist raw payload and metadata
- Emit signal_received event

Minimal signal structure:

```ts
Signal {
  id
  source
  observed_at
  raw_payload
  provenance
}
```

Acceptance test results (13/13 passing):
- ✅ Converts a Gmail message into a valid Signal object
- ✅ Attaches provenance to the signal
- ✅ Generates a unique UUID for each signal
- ✅ Initializes with an empty signal log
- ✅ Persists a signal to the log
- ✅ Rejects duplicate signals with the same external_id
- ✅ Marks a signal as processed
- ✅ Successfully ingests a Gmail signal end-to-end
- ✅ Persists the signal to the store after ingestion
- ✅ Emits a signal_received event on the EventBus after ingestion
- ✅ Records the event in the EventBus log
- ✅ Returns an error result (not throws) when provenance is missing
- ✅ Returns an error result when a duplicate signal is ingested

## Phase 2 — Six-Layer Processing ✅ COMPLETE

Goal: every signal goes through the structured interpretation pipeline.

Implemented:
- `schema/processing.ts` — Full ProcessingResult type definition (all six layers)
- `src/engine/six_layer_processor.ts` — Calls gpt-5-pro via OpenAI Responses API, parses structured JSON output
- `src/engine/processing_service.ts` — Wires processor to EventBus; auto-triggers on signal_received
- `prompts/six_layer_processor_prompt.md` — Assertive six-layer system prompt with noise filtering

Layers:
1 Raw Truth
2 Entity Linking
3 State Check
4 Relational Update
5 Inference
6 Agency

Acceptance test results (5/5 passing — gpt-4.1 for tests, gpt-5-pro default for production):
- ✅ Client project email produces a complete ProcessingResult with all six layers populated
- ✅ Invoice follow-up email detects overdue payment and flags it as a risk
- ✅ Spam/promotional email classified as noise with no obligations or inferences
- ✅ ProcessingService auto-processes a signal when signal_received fires on EventBus
- ✅ ProcessingService emits review_required when a proposed action requires approval

## Phase 3 — Entity Resolver ✅ COMPLETE

Goal: prevent duplicate entities.

Implemented:
- `src/entities/entity_store.ts` — Persistent JSON-backed storage for canonical entities
- `src/entities/entity_resolver.ts` — Similarity detection, merge-before-create enforcement, manual merge
- `src/engine/processing_service.ts` — Updated to wire EntityResolver after six-layer processing
- `src/event_bus.ts` — Added `entities_resolved` event type
- `schema/processing.ts` — Added `email` and `attributes` fields to EntityCandidate

Similarity strategy (in priority order):
1. Email exact match (person entities) — always merge
2. Exact name match (case-insensitive) — always merge
3. Jaccard token similarity ≥ 0.65 — merge
4. Jaccard token similarity 0.40–0.65 — conflict flagged, review_required emitted
5. Jaccard token similarity < 0.40 — create new entity

Acceptance test results (17/17 passing):
- ✅ Initializes with an empty store
- ✅ Creates a new entity and persists it
- ✅ Persists entities to disk and reloads them
- ✅ Updates an entity with a new alias and attributes
- ✅ Does not add duplicate aliases
- ✅ Marks an entity as superseded
- ✅ Finds entities by name (case-insensitive, partial match)
- ✅ Creates a new entity when no match exists
- ✅ Merges on exact name match (case-insensitive)
- ✅ Merges on high token similarity (same org, different format)
- ✅ Merges on email exact match for person entities
- ✅ Flags a similarity conflict and emits review_required
- ✅ Creates distinct entities for clearly different names
- ✅ Resolves multiple candidates in a single call
- ✅ Emits entities_resolved event on the EventBus
- ✅ Manual merge transfers aliases and supersedes the duplicate
- ✅ Does not resolve noise signals (skips entity resolution)

## Phase 4 — State Mutation Engine ✅ COMPLETE

Goal: convert processing results into durable state updates.

Implement:
- /engine/state_engine.ts

Rules:
Follow:
- rules/state_mutation_contract.md

Responsibilities:
- update obligations
- update resources
- create tasks
- log contradictions
- append to world state history

Acceptance test:
- A signal changes world state with provenance.

## Phase 5 — Feed Interface

Goal: human operator can see the system working.

Implement UI:
- /ui/feed/

Feed card types:
- Signal
- State Update
- Obligation Change
- Inference
- Proposed Action
- Contradiction
- Review Required

Acceptance test:
- new signal appears in feed within seconds.

## Phase 6 — Six Layer Inspector UI

Goal: human can inspect the reasoning chain.

Implement:
- /ui/inspector/

Show:
- Layer 1 Raw Truth
- Layer 2 Entity Linking
- Layer 3 State Check
- Layer 4 Relational Update
- Layer 5 Inference
- Layer 6 Agency

Acceptance test:
- tapping feed item reveals full reasoning chain.

## Phase 7 — Review Queue

Goal: ambiguity never disappears silently.

Implement:
- /review/review_queue_service.ts

Triggers:
- entity_similarity_conflict
- contradiction_detected
- low_confidence_inference
- high_risk_action
- processing_failure

Acceptance test:
- contradictions appear in review queue.

## Phase 8 — Workspace View

Goal: show contextual state around projects.

Implement:
- /ui/workspace/

Display:
- Timeline
- Open Obligations
- Artifacts
- Tasks
- Threads

Acceptance test:
- workspace view reconstructs history from events.

## Phase 9 — World State Dashboard

Goal: global situational awareness.

Implement:
- /ui/state/

Sections:
- Current Focus
- Open Obligations
- High Priority Workspaces
- Upcoming Events
- Contradictions
- Waiting Chains

Acceptance test:
- world state reflects active obligations.

## Phase 10 — Knowledge Graph

Goal: visualize entity relationships.

Implement:
- /graph/graph_builder.ts

Nodes:
- People
- Organizations
- Workspaces
- Artifacts
- Tasks
- Signals

Edges:
- sent
- owns
- linked_to
- depends_on
- supersedes
- requires

Acceptance test:
- graph renders entity connections correctly.

## Phase 11 — Automation Recipes

Goal: reusable workflows.

Implement:
- /automation/recipe_engine.ts

Recipe structure:

```ts
Recipe {
  id
  trigger
  steps
  risk_level
  approval_required
}
```

Acceptance test:
- recipe runs when trigger occurs.

## Phase 12 — Simulation Engine

Goal: forecast future state.

Implement:
- /simulation/simulation_engine.ts

Responsibilities:
- clone world state snapshot
- apply hypothetical change
- compute downstream effects

Acceptance test:
- simulation shows predicted state changes.

## Phase 13 — System Health

Goal: maintain observability.

Implement:
- /health/health_monitor.ts

Metrics:
- signals_processed
- unprocessed_signals
- merge_candidates
- contradictions
- review_backlog
- automation_failures

Acceptance test:
- health dashboard reflects real metrics.

## Final Acceptance Test

System must demonstrate:
1. ingest email signal
2. entity linking
3. state update
4. obligation creation
5. inference generation
6. action proposal
7. feed update
8. review queue update

All steps must show provenance.

## Non-Negotiable System Rules

- Raw signals are never destroyed
- All state mutations cite provenance
- Facts and inferences remain separable
- Ambiguity surfaces in review
- High-risk actions require approval
