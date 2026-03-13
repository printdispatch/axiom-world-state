# Provenance Rules

The agent must never update World State without a source reference.

## Forbidden
Project status is now Delayed.

## Required
Project status is now Delayed.
Source: Email_ID_123
Excerpt: Package delayed by storm.

## Required provenance fields
- source_id
- source_kind
- source_label
- observed_at

## Applies to
- workspace state
- obligation state
- task state
- inference record
- event status
- resource status

## Derived Updates
If an update is derived from multiple sources, all sources must be listed.

## No Orphan Interpretations
Any interpretation without provenance must be discarded.
