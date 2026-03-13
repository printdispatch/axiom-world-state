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

## Phase 1 — Core Signal Pipeline

Goal: the system can ingest a signal and store it.

Implement:
- /signals/signal_gateway.ts
- /signals/signal_store.ts

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

Acceptance test:
- Ingest sample email
- Signal appears in storage

## Phase 2 — Six-Layer Processing

Goal: every signal goes through the structured interpretation pipeline.

Implement:
- /engine/six_layer_processor.ts

Layers:
1 Raw Truth
2 Entity Linking
3 State Check
4 Relational Update
5 Inference
6 Agency

Output object:

```ts
ProcessingResult {
  signal_id
  raw_truth
  linked_entities
  state_deltas
  relational_updates
  inferences
  proposed_actions
}
```

Acceptance test:
- A signal produces a complete six-layer record.

## Phase 3 — Entity Resolver

Goal: prevent duplicate entities.

Implement:
- /engine/entity_resolver.ts

Responsibilities:
- similarity detection
- canonical entity creation
- merge-before-create enforcement

Rules must follow:
- rules/normalization_rules.md

Acceptance test:
- Duplicate signals referencing same person resolve to same entity.

## Phase 4 — State Mutation Engine

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
