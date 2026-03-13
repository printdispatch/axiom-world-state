# Architecture Notes

## Recommended Runtime Shape
- Signal Gateway
- Ingest Processor
- Entity Resolver
- State Mutation Layer
- Review Queue Service
- World State Snapshotter
- UI Read Layer

## Event Types
- signal_received
- signal_processed
- entity_created
- entity_merged
- state_updated
- obligation_created
- obligation_closed
- contradiction_detected
- recipe_executed
- recipe_failed
- review_required
- review_resolved

## Storage Strategy
Phase 1:
- JSON files in state/
- local read layer for UI
- append-only logs

Phase 2:
- SQLite or Postgres for canonical state
- vector store for retrieval chunks
- object storage for raw payloads and artifacts

## Agent Roles
- Ingest Agent
- Interpreter Agent
- State Agent
- Review Agent
- Automation Agent
- Simulation Agent

## Operational Rules
- agents publish events rather than mutating UI directly
- world state must be reconstructable from event history
- recipe runs must be logged
- every failure must surface in review
