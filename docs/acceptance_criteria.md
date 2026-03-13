# Acceptance Criteria

## Core Build Acceptance

### Ingest
- The system can accept a signal from a defined source.
- The signal is persisted with provenance.
- The signal appears in the Feed.

### Six-Layer Processing
- Every processed signal produces a six-layer record.
- The system does not skip layers.
- The system blocks inference if layers 1 through 4 are incomplete.

### Entity Linking
- The system checks existing entities before creating new ones.
- Merge-before-create logic is enforced.
- Merge events are logged.

### State Mutation
- Every state mutation has provenance.
- High-risk mutations cannot execute without approval.
- Append-only history is preserved.

### UI
- Feed renders ingested items.
- Six-Layer Inspector opens from the Feed.
- Workspace screen shows linked signals, obligations, artifacts, and tasks.
- Review Queue renders contradictions, stale signals, and risky actions.
- World State screen renders current focus and open obligations.

### Reliability
- Failed processing creates a reviewable error state.
- A stale signal is visible and actionable.
- Low-confidence inference is visible and reviewable.

## Demo Acceptance
A successful demo must show:
1. ingest a new email signal
2. link it to an existing workspace
3. update an obligation
4. create an inference with provenance
5. surface one proposed action
6. render the change in Feed, Workspace, Review, and World State
