# Axiom Orchestration Loop: Technical Design

**Author:** Manus AI
**Date:** 2026-03-13
**Status:** Proposed

## 1. Overview

This document outlines the architecture for a new orchestration loop within the Axiom World State. The current system uses a linear, stateless processing pipeline. This new design introduces a cyclical, stateful, and temporal model inspired by industry best practices like the OODA loop, CQRS/Event Sourcing, and the temporal context graph pattern seen in projects like Zep's Graphiti [1].

The primary goal is to evolve Axiom from a simple email processor into a robust cognitive architecture where the system's understanding of the world is durable, auditable, and improves over time.

## 2. Core Philosophy: The Ceremonial Loop

The architecture is built around a strict, four-stage **Ceremonial Loop**. This ensures a clear separation of concerns between observing reality, interpreting it, changing the official record of reality, and deciding what to do next.

1.  **Observe:** An external event occurs (e.g., an email arrives). It is captured and normalized into a raw, immutable **Episode**.
2.  **Interpret:** A cognitive layer (the **Engine**) analyzes the Episode *in the context of the current World State*. It does not change the state; it produces a **Delta**, which is a set of *proposed* changes.
3.  **Commit:** The **Orchestrator** validates the Delta and applies it to the **World State**. This is the *only* point where the canonical state of the world is mutated. The commit process is temporal, creating new versions of entities and facts rather than overwriting them.
4.  **Deliberate:** After the state is updated, the Engine is invoked again to analyze the new state of the world. It can then propose actions, flag new tensions, or update its own internal models.

This loop transforms the system from a simple input-output function to a self-aware agent that maintains a coherent internal model of its environment.

## 3. Architectural Components

We will introduce three new components and refactor several existing ones.

| Component | Type | Responsibility | Implementation |
|---|---|---|---|
| **`Episode`** | Schema | A single, immutable record of an observed event. | New file: `schema/episodes.ts` |
| **`Orchestrator`** | Service | Drives the Ceremonial Loop. Listens for events, calls the Engine, and commits Deltas. | New file: `src/orchestration/orchestrator.ts` |
| **`CognitionService`** | Service | The "Engine." Encapsulates the logic for interpreting Episodes and deliberating on the World State. | New file: `src/engine/cognition_service.ts` |
| **`WorldStateStore`** | Service | The persistence layer. | **Refactor** `src/state/world_state_store.ts` to support temporal, versioned writes. |
| **`SignalGateway`** | Service | The entry point for external data. | **Refactor** `src/signals/signal_gateway.ts` to produce `Episodes` instead of `Signals`. |

## 4. Data Contracts

### 4.1. The `Episode` Schema

An `Episode` is the atomic unit of observation. It is created once and never changed. It replaces the current `Signal` object as the primary input to the system.

```typescript
// In: schema/episodes.ts

import { UUID, ISODateTime, SourceKind, ProvenanceRef } from "./common.js";

export interface Episode {
  id: UUID; // "ep-...
  schema_version: "1.0.0";
  source_kind: SourceKind;
  provenance: ProvenanceRef[];
  observed_at: ISODateTime;
  title: string;
  raw_text: string;
  // The raw payload from the source adapter (e.g., full Gmail API object)
  raw_payload: Record<string, unknown>;
}
```

### 4.2. The `Delta` Contract

A `Delta` is a pure data object produced by the `CognitionService`. It represents a transaction of proposed changes.

```typescript
// In: schema/interpretation.ts (new content)

export type EntityChange = 
  | { type: "create", entity: Partial<Entity> }
  | { type: "update", entityId: UUID, changes: Record<string, any> };

export type ObligationChange = 
  | { type: "create", obligation: Partial<Obligation> }
  | { type: "update", obligationId: UUID, status: ObligationStatus, reason: string };

export interface Delta {
  episode_id: UUID;
  entity_changes: EntityChange[];
  obligation_changes: ObligationChange[];
  new_facts: Array<{ entityId: UUID, property: string, value: any, valid_from: ISODateTime }>;
  contradictions_found: Array<Omit<Contradiction, "id">>;
}
```

## 5. Refactoring Plan

### 5.1. `WorldStateStore` Goes Temporal

The most significant change is making the `WorldStateStore` temporal. The current implementation overwrites records. The new implementation will use an event-sourcing-like pattern.

-   **Entities:** When an entity is updated, we will not modify the existing record. Instead, we will create a *new version* of the entity and link it to the previous version. The `entities.json` file will become a log of entity versions.
-   **Obligations:** Similarly, `obligations.json` will store all versions of an obligation. A `current_status` field will be added for quick queries.
-   **Fact Store:** A new file, `facts.json`, will be created to store timestamped, atomic facts about entities (e.g., `(entity: 'ent-123', property: 'email', value: 'test@test.com', valid_from: '2026-03-13T20:00:00Z')`).

This provides a full, auditable history of the world state.

### 5.2. `SignalGateway` to `EpisodeProducer`

The `SignalGateway` will be refactored to take raw data from adapters and produce an `Episode`. It will no longer be responsible for storing a `Signal` but will instead emit an `episode_observed` event on the `EventBus`.

### 5.3. `SixLayerProcessor` becomes `CognitionService`

The logic within `SixLayerProcessor` will be moved into the new `CognitionService`. However, instead of directly mutating state, its `interpret` method will receive an `Episode` and the current `WorldState` and return a `Delta`.

## 6. The New Workflow (Step-by-Step)

1.  A Gmail email arrives.
2.  `GmailAdapter` formats it into a raw payload and calls `SignalGateway`.
3.  `SignalGateway` creates an `Episode` object, saves the raw payload, and emits `episode_observed` with the Episode ID.
4.  The `Orchestrator` listens for this event and begins the loop.
5.  **(Observe):** The Orchestrator loads the full `Episode`.
6.  **(Interpret):** The Orchestrator calls `cognitionService.interpret(episode, worldState)`. The `CognitionService` reads the current state from `WorldStateStore` and uses its AI logic to produce a `Delta` object.
7.  **(Commit):** The Orchestrator receives the `Delta` and calls a new method, `worldStateStore.commitDelta(delta)`. The store processes the changes, creating new entity/obligation versions and facts.
8.  **(Deliberate):** After the commit is successful, the Orchestrator can optionally call `cognitionService.deliberate(worldState)` to get a list of proposed actions (e.g., send a notification, draft a reply), which can be handled by a new `ActionEngine`.

This design provides a solid foundation for a more intelligent and reliable system. It decouples the core components, introduces a robust audit trail, and paves the way for more advanced cognitive features.

---

### References

[1] Zep. (2026). *Graphiti: Build Real-Time Knowledge Graphs for AI Agents*. GitHub. Retrieved from https://github.com/getzep/graphiti
