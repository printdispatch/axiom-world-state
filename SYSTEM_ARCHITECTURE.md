# SYSTEM_ARCHITECTURE.md

## Purpose

This document defines the runtime architecture of the Axiom World State system.

It explains:
- how signals enter the system
- how agents process information
- how state is stored
- how the UI reads system knowledge
- how automation and simulation operate

The system should behave like a cognitive instrument, not a traditional application.

It must remain:
- inspectable
- deterministic
- provenance-first
- review-driven

## High-Level System Diagram

External World
    |
    v
Signal Gateway
    |
    v
Event Bus
    |
    v
Six-Layer Processing Engine
    |
    v
Entity Resolver
    |
    v
State Mutation Engine
    |
    v
World State Store
    |
    +-- UI Read Layer
    +-- Automation Engine
    +-- Simulation Engine
    +-- Knowledge Graph

Every component communicates through events, not direct function calls.

## 1 — Signal Gateway

Purpose:
Normalize incoming data into structured signals.

Possible sources:
- Email
- Calendar
- Slack
- WhatsApp
- API Webhooks
- Manual Entry
- File Upload

Signal format:

```ts
Signal {
  id
  source
  observed_at
  raw_payload
  provenance
  staleness
}
```

Responsibilities:
- receive external inputs
- store raw payloads
- emit signal_received

## 2 — Event Bus

The nervous system of the platform.

Agents publish and subscribe to events.

Example events:
- signal_received
- signal_processed
- entity_created
- entity_merged
- state_updated
- obligation_created
- contradiction_detected
- recipe_executed
- review_required

Recommended technologies:

Phase 1
- In-process event emitter

Phase 2
- NATS or Redis Streams

Phase 3
- Kafka

## 3 — Six-Layer Processing Engine

This engine transforms raw signals into structured interpretations.

Pipeline:
- Layer 1 Raw Truth
- Layer 2 Entity Linking
- Layer 3 State Check
- Layer 4 Relational Update
- Layer 5 Inference
- Layer 6 Agency

Output:

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

Rules:
- layers must run sequentially
- layers cannot be skipped
- inference cannot run before layers 1–4

## 4 — Entity Resolver

Purpose:
Maintain canonical entities.

Handles:
- People
- Organizations
- Workspaces
- Artifacts
- Tasks

Responsibilities:
- semantic similarity detection
- duplicate prevention
- entity merging

Rule:
- Merge before create

## 5 — State Mutation Engine

Converts interpretations into durable state.

Must obey:
- rules/state_mutation_contract.md

Responsibilities:
- update obligations
- update resources
- create tasks
- register contradictions
- update world state
- append history

All mutations must include:
- provenance
- timestamp
- source reference

## 6 — World State Store

The canonical representation of reality.

Structure:
- state/
- signals/
- entities/
- obligations/
- tasks/
- resources/
- events/
- world_state.json

The world state is append-only.

Snapshots may be created for performance.

Example:
- snapshot_001.json
- snapshot_002.json
- snapshot_003.json

This allows:
- time travel
- simulation
- audit

## 7 — UI Read Layer

The UI must never mutate state directly.

It reads from the state store.

Primary UI views:
- Feed
- Inspector
- Workspace
- Review Queue
- World State
- Graph
- Recipes
- Health
- Simulation

The UI should subscribe to event updates for real-time refresh.

## 8 — Automation Engine

Handles reusable workflows.

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

Triggers:
- signal_received
- state_updated
- obligation_created
- contradiction_detected
- time_event

Automation must log:
- execution_result
- timestamp
- error if failure

## 9 — Simulation Engine

Purpose:
Predict future state outcomes.

Mechanism:
- clone world state
- apply hypothetical change
- compute downstream effects

Example scenarios:
- deadline slip
- task completion
- resource delay
- obligation failure

Simulation must never mutate canonical state.

## 10 — Knowledge Graph

Derived representation of system relationships.

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

Graph is rebuilt from state data.

It is not the primary store.

## 11 — Review System

The human-in-the-loop safety layer.

Triggers:
- entity merge uncertainty
- contradiction detection
- low confidence inference
- high risk automation
- processing failure

Review decisions are logged permanently.

## 12 — System Health Monitor

Tracks operational metrics.

Metrics include:
- signals_processed
- unprocessed_signals
- duplicate_candidates
- contradictions
- review_backlog
- automation_failures

This system prevents silent degradation.

## Deployment Strategy

Phase 1:
- single-node runtime
- JSON storage
- in-process events
- local UI

Phase 2:
- Postgres state store
- object storage for artifacts
- vector index for retrieval
- event streaming layer

Phase 3:
- multi-agent distributed runtime
- scalable event bus
- graph database

## Operational Philosophy

The system must prioritize:
- truth
- traceability
- inspectability
- reversibility
- human oversight

Never prioritize:
- speed over correctness
- automation over review
- inference over evidence

## Final Principle

The system exists to answer one question:

What actually happened, what changed, and what should happen next?

Every subsystem must help answer that question.
