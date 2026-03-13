# Temporal Decay Rules

Every Signal and every Inference must have a staleness score.

## Signal Staleness
- fresh: 0h to 24h
- aging: >24h to 72h
- stale: >72h to 168h
- expired: >168h

## Mandatory Rule
If a Signal is older than 24 hours and has not been moved to State:
- mark it as aging or stale
- create a follow-up task or status-check proposal
- do not silently ignore it

## Inference Staleness
Interpretations older than 24 hours must be re-evaluated if:
- a source entity changed
- contradictory evidence appeared
- a deadline is approaching
- the source signal became stale

## State vs Signal
Signals decay quickly.
State persists until superseded by facts.
Inference decays unless refreshed by new evidence.
