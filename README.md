# Axiom World State

> A persistent, provenance-first world-state substrate for LLM agents.

Axiom World State is an open-source system that gives AI agents a **continuous, auditable memory of reality**. Instead of forgetting everything when a session ends, an Axiom-powered agent maintains a living model of people, projects, obligations, communications, and events — and every single fact in that model is traceable back to its source.

The system is designed to answer three questions at any moment:

1. **What actually happened?**
2. **What changed in the world state?**
3. **What should happen next?**

---

## Core Philosophy

Five rules govern everything this system does. They are non-negotiable.

1. **Raw signals are never destroyed.** Every input is preserved exactly as received.
2. **World state must always cite provenance.** No fact exists without a source reference.
3. **Agents may propose actions but cannot execute high-risk changes without review.** The human is always in the loop for consequential decisions.
4. **Facts and interpretations must remain separable.** The system never conflates what happened with what it thinks it means.
5. **Ambiguity must become visible, not hidden.** Uncertainty surfaces in a review queue rather than being silently resolved.

---

## Architecture Overview

The system is composed of twelve interconnected components that communicate through an event bus. No component mutates state directly; all changes flow through the State Mutation Engine with full provenance.

```
External World
    │
    ▼
Signal Gateway          ← Normalizes all incoming data into structured signals
    │
    ▼
Event Bus               ← The nervous system; all components publish and subscribe
    │
    ▼
Six-Layer Processing Engine   ← Transforms signals into structured interpretations
    │
    ▼
Entity Resolver         ← Prevents duplicates; enforces merge-before-create
    │
    ▼
State Mutation Engine   ← Writes provenance-stamped updates to world state
    │
    ▼
World State Store       ← The canonical, append-only record of reality
    │
    ├── UI Read Layer       ← Feed, Inspector, Workspace, Review, Graph, Health
    ├── Automation Engine   ← Reusable JSON workflow recipes
    ├── Simulation Engine   ← Hypothetical state forecasting
    └── Knowledge Graph     ← Derived entity relationship visualization
```

See [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) for the full component specification.

---

## The Six-Layer Processing Model

Every signal ingested by the system passes through six sequential layers. No layer may be skipped. Inference is forbidden before layers 1–4 are complete.

| Layer | Name | Purpose |
| :---: | :--- | :--- |
| 1 | **Raw Truth** | Extract only facts directly present in the input. No interpretation. |
| 2 | **Entity Linking** | Identify and link people, organizations, workspaces, and artifacts. |
| 3 | **State Check** | Determine what changed in the factual state of linked entities. |
| 4 | **Relational Update** | Map obligations, dependencies, and ownership chains. |
| 5 | **Inference** | Estimate priority, risk, and meaning. Every inference must cite confidence and provenance. |
| 6 | **Agency** | Propose exactly three actions. High-risk actions require explicit approval. |

See [`rules/six_layer_world_model.md`](./rules/six_layer_world_model.md) for the full specification.

---

## Repository Structure

```
axiom-world-state/
├── schema/                  # TypeScript type definitions for all world-state entities
│   ├── common.ts            # Shared base types, provenance, audit fields
│   ├── identity.ts          # Person, Organization, Account
│   ├── workspaces.ts        # Workspace, WorkspaceSnapshot
│   ├── communications.ts    # CommunicationThread, Message
│   ├── artifacts.ts         # Artifact, ArtifactVersion
│   ├── execution.ts         # Task, Obligation, WorkflowRecipe
│   ├── signals.ts           # Signal
│   ├── resources.ts         # ResourceRecord (invoices, payments, shipments)
│   ├── time.ts              # CalendarEvent
│   ├── interpretation.ts    # InferenceRecord, InterpretationPolicy
│   ├── memory.ts            # MemoryRecord
│   └── index.ts             # Barrel export
├── src/                     # Core engine source code (TypeScript)
│   ├── signals/             # Signal Gateway implementation
│   ├── engine/              # Six-Layer Processor, Entity Resolver
│   ├── state/               # State Mutation Engine, World State Updater
│   ├── review/              # Review Queue Service
│   ├── automation/          # Recipe Engine
│   ├── simulation/          # Simulation Engine
│   ├── graph/               # Knowledge Graph Builder
│   ├── health/              # System Health Monitor
│   ├── ingest.ts            # Ingest loop interface
│   ├── normalize.ts         # Entity normalization utilities
│   ├── provenance.ts        # Provenance enforcement utilities
│   ├── staleness.ts         # Temporal decay utilities
│   └── types.ts             # Re-exports from schema
├── rules/                   # The system's operating constitution
│   ├── six_layer_world_model.md
│   ├── normalization_rules.md
│   ├── provenance_rules.md
│   ├── action_safety_rules.md
│   ├── inference_protocols.md
│   ├── temporal_decay_rules.md
│   └── state_mutation_contract.md
├── protocols/               # Domain-specific ingest protocols
│   ├── handle_late_payment.md
│   ├── handle_missed_reply.md
│   ├── handle_new_lead.md
│   ├── handle_revised_document.md
│   └── handle_upcoming_meeting.md
├── prompts/                 # LLM system and ingest prompts
│   ├── system_prompt.md
│   └── ingest_loop_prompt.md
├── docs/                    # Product and developer documentation
│   ├── product_brief.md
│   ├── ui_spec.md
│   ├── architecture_notes.md
│   ├── review_workflow.md
│   ├── acceptance_criteria.md
│   └── sample_ingest_cases.md
├── state/                   # Live world state files (runtime data)
│   ├── world_state.md
│   ├── world_state.json
│   ├── entity_index.json
│   ├── action_log.json
│   └── ingest_log.json
├── tests/
│   ├── unit/
│   └── integration/
├── scripts/                 # Developer utility scripts
├── AXIOM_AGENT_PROMPT.md    # Full behavioral specification for the Axiom agent
├── SYSTEM_ARCHITECTURE.md   # Component-level architecture specification
├── BUILD_ORDER.md           # Phased implementation plan (13 phases)
├── axiom_philosophy.md      # The five non-negotiable principles
├── CONTRIBUTING.md          # Contribution guidelines
├── package.json
└── tsconfig.json
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (recommended) or npm

### Installation

```bash
git clone https://github.com/your-org/axiom-world-state.git
cd axiom-world-state
pnpm install
```

### Type Check

```bash
pnpm check
```

### Build

```bash
pnpm build
```

---

## Build Roadmap

The project is implemented in 13 sequential phases, each with defined acceptance criteria. See [`BUILD_ORDER.md`](./BUILD_ORDER.md) for the complete specification.

| Phase | Name | Status |
| :---: | :--- | :--- |
| 1 | Core Signal Pipeline | Planned |
| 2 | Six-Layer Processing Engine | Planned |
| 3 | Entity Resolver | Planned |
| 4 | State Mutation Engine | Planned |
| 5 | Feed Interface (UI) | Planned |
| 6 | Six-Layer Inspector (UI) | Planned |
| 7 | Review Queue | Planned |
| 8 | Workspace View (UI) | Planned |
| 9 | World State Dashboard (UI) | Planned |
| 10 | Knowledge Graph | Planned |
| 11 | Automation Recipes | Planned |
| 12 | Simulation Engine | Planned |
| 13 | System Health Monitor | Planned |

---

## Key Documents

| Document | Purpose |
| :--- | :--- |
| [`axiom_philosophy.md`](./axiom_philosophy.md) | The five core principles that govern all system behavior |
| [`AXIOM_AGENT_PROMPT.md`](./AXIOM_AGENT_PROMPT.md) | The complete behavioral contract for any agent operating within this system |
| [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) | Full component-level architecture with data flows and deployment strategy |
| [`BUILD_ORDER.md`](./BUILD_ORDER.md) | The 13-phase implementation roadmap with acceptance tests for each phase |
| [`docs/ui_spec.md`](./docs/ui_spec.md) | Specification for all 12 UI screens |
| [`docs/product_brief.md`](./docs/product_brief.md) | What this system is, what it is not, and who it is for |
| [`docs/sample_ingest_cases.md`](./docs/sample_ingest_cases.md) | Five canonical test cases for validating the ingest pipeline |

---

## License

MIT
