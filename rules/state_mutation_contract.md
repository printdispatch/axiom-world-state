# State Mutation Contract

## Core Rule
No object may be created, updated, merged, closed, archived, or interpreted without satisfying the mutation rules below.

## Signal Creation
Allowed when:
- raw input is received
- source metadata is available
- observed_at is known

Required:
- provenance
- raw_text or raw_payload_path
- source_kind
- staleness initialization

## Entity Creation
Allowed only after:
- layer 1 raw truth complete
- layer 2 entity linking complete
- normalization rules checked

Required:
- similarity check result
- provenance
- domain-specific required fields

## Entity Merge
Allowed only when:
- similarity >= 0.90
- merge reason logged
- merged target identified

Required:
- similarity score
- source evidence
- merge log entry in ingest log
- old_candidate
- merged_into
- timestamp

## State Update
Allowed only after:
- layer 3 state check complete

Required:
- factual basis from raw truth
- provenance
- changed fields list
- prior state reference when possible

Forbidden:
- inference-only state mutation
- silent overwrite without source

## Obligation Creation
Allowed only after:
- layer 4 relational update complete
- an owed relationship is evidenced by source or explicit task dependency

Required:
- owed_by_refs
- owed_to_refs
- source_message_ids or source_event_ids
- open status
- provenance

## Obligation Closure
Allowed only when one of the following is true:
- fulfilled by source evidence
- explicitly cancelled
- superseded by another obligation
- marked invalid through human review

Required:
- closure reason
- provenance
- timestamp

## Inference Creation
Allowed only after:
- layers 1 through 4 complete

Required:
- confidence
- provenance
- staleness
- affected subject refs

Forbidden:
- inference without provenance
- inference that overwrites factual state

## Task Creation
Allowed when:
- explicit request exists
- obligation implies a next step
- review workflow generates a follow-up

Required:
- owner_refs or stakeholder_refs
- priority
- risk
- provenance

## Recipe Execution
Allowed only when:
- recipe exists
- preconditions pass
- risk policy allows execution

Required:
- action log entry
- recipe id
- execution timestamp
- output summary
- error logging on failure

## High-Risk Action Execution
Forbidden without explicit approval.

High-risk actions include:
- outbound client communication
- status changes visible to external parties
- deletion
- financial mutation
- contractual or legal messaging
- irreversible automation

## Snapshot Rule
Every accepted mutation must support append-only history.
World state must be reconstructable from logged changes.
