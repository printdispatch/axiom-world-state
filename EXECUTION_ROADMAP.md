
# Axiom World State: Project Execution Roadmap

## 1. Introduction

This document provides a strategic roadmap for building the Axiom World State system. It expands upon the `BUILD_ORDER.md` to offer concrete recommendations, technology choices, and strategic focus for each phase of development. Its purpose is to guide a development team from the current state (a complete architectural blueprint) to a fully functional, production-ready system.

This is a monumental but achievable project. The key to success is disciplined, sequential execution that prioritizes correctness and traceability at every step.

---

## 2. Guiding Principles for Execution

Every technical decision and line of code must adhere to the project's core philosophy. These are not suggestions; they are the constitution of the system.

1.  **Provenance is Paramount:** If a piece of information cannot be traced back to its source, it is considered invalid. All state mutations must be accompanied by a verifiable provenance chain.
2.  **Correctness Over Speed:** The system must be right before it is fast. Rushing leads to untraceable errors and a loss of trust. Build methodically and test rigorously.
3.  **Surface Ambiguity, Don't Hide It:** The system's default behavior when faced with uncertainty is to escalate to the Review Queue. Do not build logic that makes 
assumptions or guesses. The human-in-the-loop is a feature, not a bug.
4.  **Build Sequentially, Test Continuously:** Strictly follow the 13 phases outlined in `BUILD_ORDER.md`. Do not begin a phase until the acceptance criteria for the previous phase have been met and verified with tests. Each phase should result in a more capable, but still stable, system.

---

## 3. Recommended Technology Stack

The architectural documents provide flexibility, but for a concrete starting point, the following stack is recommended for its maturity, scalability, and alignment with the project's goals.

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Language** | TypeScript | Provides strong typing that is essential for maintaining the integrity of the complex data schemas. |
| **Runtime** | Node.js | A mature, well-supported, and high-performance environment for building the backend engine. |
| **Event Bus** | **Phase 1:** In-process `EventEmitter` | Simple, no external dependencies, perfect for initial development and testing. |
| | **Phase 2:** Redis Streams or NATS | Provides a robust, scalable, and persistent event bus for a multi-service architecture. |
| **State Store** | **Phase 1:** JSON files on disk | Simple to implement and debug during early phases. The current structure already supports this. |
| | **Phase 2:** PostgreSQL | A powerful, reliable, and feature-rich relational database that can handle the complex relationships between entities. |
| **Vector Store** | **Phase 2:** pgvector (Postgres extension) | Keeps the vector search capability within the same database, simplifying the stack. |
| **UI Framework** | Next.js (with React) | A production-grade framework for building the user interface, with excellent support for TypeScript. |

---

## 4. Detailed Phase-by-Phase Execution Plan

This section breaks down each of the 13 build phases with specific implementation advice and focus areas.

### Phase 1: Core Signal Pipeline

*   **Goal:** Ingest a signal and store it with provenance.
*   **Focus:** Build the absolute minimum required to get data into the system reliably. Do not worry about processing or interpretation yet.
*   **Implementation Steps:**
    1.  Create the `SignalGateway` class in `src/signals/gateway.ts`.
    2.  Implement methods for accepting mock email and calendar inputs.
    3.  Write the logic to normalize these inputs into the `Signal` object defined in `schema/signals.ts`.
    4.  Implement a simple file-based storage mechanism to append new signals to a log file (e.g., `state/signal_log.json`).
    5.  Implement an in-process `EventEmitter` to emit a `signal_received` event with the signal's ID.
*   **Acceptance Test:** A script that calls the `SignalGateway` with a mock email object should result in a new line in the signal log and a corresponding event being emitted.

### Phase 2: Six-Layer Processing Engine (Stubbed)

*   **Goal:** Create the structure for the processing pipeline and have it listen to ingest events.
*   **Focus:** Build the scaffolding of the engine. The layers themselves will be empty functions for now, but the data flow must be established.
*   **Implementation Steps:**
    1.  Create the `SixLayerProcessor` class in `src/engine/processor.ts`.
    2.  Create stub functions for each of the six layers (e.g., `runLayer1_RawTruth`, `runLayer2_EntityLinking`, etc.). These functions should log that they were called and return a placeholder object.
    3.  Subscribe the `SixLayerProcessor` to the `signal_received` event from the event bus.
    4.  When the event is received, the processor should call each of the six layers in sequence.
*   **Acceptance Test:** Running the Phase 1 test should now also produce console logs indicating that all six layers of the processing engine were executed in the correct order.

### Phase 3: Entity Resolver

*   **Goal:** Prevent the creation of duplicate entities.
*   **Focus:** Implement the core logic for semantic similarity and the "merge-before-create" rule. This is a critical step for maintaining a clean world state.
*   **Implementation Steps:**
    1.  Flesh out the `EntityResolver` class in `src/engine/resolver.ts`.
    2.  For the initial implementation, use a simple string-matching algorithm for similarity (e.g., Levenshtein distance) on key fields like `full_name` and `email` for `Person` entities.
    3.  Implement the logic defined in `rules/normalization_rules.md`: if similarity is > 0.9, merge; if > 0.75, send to review; if less, create new.
    4.  Integrate the `EntityResolver` into the `runLayer2_EntityLinking` step of the `SixLayerProcessor`.
*   **Acceptance Test:** Ingesting two signals with slightly different names but the same email address for a person should result in only one `Person` entity being created, and a merge event being logged.

*(This roadmap would continue in this level of detail for all 13 phases, covering the State Mutation Engine, UI implementation, Review Queue, Knowledge Graph, and more, providing a clear and actionable path for the development team.)*

### Phase 4: State Mutation Engine

*   **Goal:** Convert the results of the processing engine into durable, provenance-stamped state updates.
*   **Focus:** Enforcing the `state_mutation_contract.md`. This is the heart of the system's integrity. No state should ever change without passing through this engine.
*   **Implementation Steps:**
    1.  Build the `StateMutationEngine` in `src/state/engine.ts`.
    2.  It should subscribe to a `processing_complete` event emitted by the `SixLayerProcessor`.
    3.  Implement the core logic: for each proposed `state_delta` from the processor's output, validate its provenance using `requireProvenance()`.
    4.  If valid, write the change to the appropriate JSON file in the `/state` directory (e.g., update an entity in `entity_index.json`).
    5.  Emit a `state_updated` event containing the change that was made.
*   **Acceptance Test:** A processed signal that proposes changing a workspace status from `active` to `archived` should result in the `entity_index.json` file being updated, and a `state_updated` event being fired.

### Phase 5: Feed Interface (UI)

*   **Goal:** Allow a human operator to see the system working.
*   **Focus:** Read-only display. The UI should only render the current state; it should not modify it. This is the first time the system becomes visually inspectable.
*   **Implementation Steps:**
    1.  Set up a new Next.js project within the repository (e.g., in a `/ui` directory).
    2.  Create a simple API route that reads the `state/ingest_log.json` and `state/action_log.json` files.
    3.  Build a React component that fetches data from this API route and renders a reverse-chronological list of events as cards, following the `docs/ui_spec.md`.
    4.  The UI should listen for `state_updated` and `signal_received` events (you can use a simple polling mechanism or WebSockets for this in a later phase) to refresh the feed.
*   **Acceptance Test:** When a new signal is ingested and processed, a new card representing that event should appear at the top of the feed UI within seconds.

### Phase 6: Six-Layer Inspector (UI)

*   **Goal:** Allow a human to inspect the full reasoning chain for any event.
*   **Focus:** Traceability and trust. This screen is the single most important UI component for making the agent's thinking transparent.
*   **Implementation Steps:**
    1.  When a user clicks on a card in the Feed UI, it should open a modal or a new view.
    2.  This view will display the full `ProcessingResult` object associated with that event.
    3.  Format the output clearly with sections for each of the six layers, as specified in `docs/ui_spec.md`.
    4.  Add the `Approve`, `Dismiss`, and `Flag Incorrect` buttons. For now, these buttons can simply log the action to the console.
*   **Acceptance Test:** Clicking any card in the feed should open the Inspector view, which accurately displays the full six-layer breakdown of how that event was processed.

### Phase 7: Review Queue

*   **Goal:** Ensure ambiguity and risk are surfaced to a human for resolution.
*   **Focus:** Implementing the system's core safety and feedback loop. This is where the agent learns from human oversight.
*   **Implementation Steps:**
    1.  Create a `ReviewQueueService` in `src/review/service.ts`.
    2.  This service will subscribe to events that trigger review, such as `contradiction_detected`, `low_confidence_inference`, and `high_risk_action_proposed`.
    3.  When a review-triggering event is received, the service adds an item to a new `state/review_queue.json` file.
    4.  Create a new page in the UI that reads from this file and displays the items needing review, categorized as per `docs/review_workflow.md`.
    5.  Implement the review actions (Approve, Reject, Merge, etc.). Initially, these actions can simply update the status of the item in the `review_queue.json` and log the decision.
*   **Acceptance Test:** Ingesting two signals that contradict each other (e.g., one says a project is "complete," the other says it is "delayed") should create a new item in the Review Queue UI.

### Phase 8: Workspace View (UI)

*   **Goal:** Provide a consolidated view of all information related to a single project or entity.
*   **Focus:** Contextualization. This view moves beyond a simple timeline to show the interconnectedness of information.
*   **Implementation Steps:**
    1.  Create a dynamic page in the UI (e.g., `/workspaces/[id]`)
    2.  When a user navigates to this page, the backend should query all state files (`entity_index.json`, `ingest_log.json`, etc.) to find all artifacts, obligations, tasks, and threads linked to that specific workspace ID.
    3.  Render this information in the sections defined in the UI spec (Timeline, Open Obligations, Artifacts, etc.).
*   **Acceptance Test:** Navigating to the view for a specific workspace should display a complete, filtered history and current state for only that workspace.

### Phase 9: World State Dashboard (UI)

*   **Goal:** Provide a high-level, global overview of the system's current state.
*   **Focus:** Situational awareness. This dashboard answers the question, "What is the most important information right now?"
*   **Implementation Steps:**
    1.  Create a new "State" page in the UI.
    2.  The backend for this page will need to perform more complex queries, such as identifying all obligations where `status` is `open`, or all workspaces where `priority` is `high`.
    3.  Render this data in the dashboard format specified in `docs/ui_spec.md` (Current Focus, Open Obligations, High Priority Workspaces, etc.).
*   **Acceptance Test:** The World State Dashboard should accurately reflect the most critical and active items across the entire system.

### Phase 10: Knowledge Graph

*   **Goal:** Visualize the relationships between all entities in the system.
*   **Focus:** Discovery and analysis. The graph makes it possible to see connections that are not obvious in a list or timeline view.
*   **Implementation Steps:**
    1.  Build a `GraphBuilder` service in `src/graph/builder.ts`.
    2.  This service will periodically read the entire `entity_index.json` and construct a graph data structure (nodes and edges) representing the relationships (e.g., `depends_on`, `owned_by`).
    3.  Use a library like `vis.js` or `d3.js` on the front end to render this graph structure interactively.
*   **Acceptance Test:** The graph should correctly render a person node connected to an organization node, which is in turn connected to several workspace nodes.

### Phase 11: Automation Recipes

*   **Goal:** Allow the system to execute reusable, pre-defined workflows.
*   **Focus:** Efficiency. This is the first step toward true agent-driven automation, building on the foundation of trust and traceability already established.
*   **Implementation Steps:**
    1.  Implement the `RecipeEngine` in `src/automation/engine.ts`.
    2.  The engine subscribes to various events that can act as triggers (e.g., `signal_received` with a specific keyword).
    3.  When a trigger matches a recipe from a `protocols/` file, the engine executes the defined steps (e.g., `draft` a reply, `create` a task).
    4.  Crucially, the engine must respect the `approval_requirement` field. If a recipe is high-risk, its execution must be gated by the Review Queue.
*   **Acceptance Test:** A signal matching the trigger for `protocols/handle_late_payment.md` should cause the system to automatically propose a reminder draft and create a follow-up task, which then appear in the Feed.

### Phase 12: Simulation Engine

*   **Goal:** Forecast the downstream effects of a potential change.
*   **Focus:** Proactive decision-making. The simulation engine allows the agent (and the user) to look into the future.
*   **Implementation Steps:**
    1.  Build the `SimulationEngine` in `src/simulation/engine.ts`.
    2.  The engine will have a method that accepts a hypothetical change (e.g., "What if this project is delayed by 3 days?").
    3.  It will clone the current `world_state.json` in memory, apply the change, and then run the `SixLayerProcessor` on the hypothetical state to compute the downstream effects (e.g., breached deadlines, new risks).
    4.  The results are returned to the user and are never written to the canonical state store.
*   **Acceptance Test:** Simulating a 3-day delay on a project should produce a report showing which future deadlines would be missed as a result.

### Phase 13: System Health Monitor

*   **Goal:** Provide observability into the operational health of the system.
*   **Focus:** Reliability and maintenance. This dashboard ensures the system doesn’t fail silently.
*   **Implementation Steps:**
    1.  Create a `HealthMonitor` service in `src/health/monitor.ts`.
    2.  This service subscribes to a wide range of system events (`signal_processed`, `automation_failed`, `review_item_created`, etc.).
    3.  It aggregates and stores key metrics (e.g., number of unprocessed signals, size of the review backlog).
    4.  A new "Health" page in the UI displays these metrics.
*   **Acceptance Test:** The health dashboard should accurately reflect the number of items currently waiting in the review queue.

---

## 5. Conclusion

This roadmap provides a clear, incremental path to building the Axiom World State system. By following these phases sequentially and adhering to the core principles of provenance, correctness, and transparency, a development team can turn this exceptional blueprint into a powerful and trustworthy AI agent platform.

