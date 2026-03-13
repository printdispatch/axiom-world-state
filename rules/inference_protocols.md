# Inference Protocols

## General
- Inference is forbidden before layers 1 through 4 are complete.
- All inferences must cite provenance.
- Confidence must be numeric from 0.0 to 1.0.
- Confidence above 0.85 requires at least 2 independent sources or 1 explicit source of truth.
- Never overwrite factual state with inference.

## Priority Heuristics
- urgent: direct deadline within 24h, explicit escalation, or high breach risk
- high: due within 72h, unresolved dependency, payment late, shipment delayed
- normal: active but not time-critical
- low: informational only

## Risk Heuristics
- critical: legal, financial, contractual, irreversible
- high: client delay, broken commitment, severe blocker
- medium: ambiguity, stale thread, follow-up likely needed
- low: informational or reversible

## Contradiction Handling
- If sources conflict, do not auto-resolve.
- Create contradiction_flags[].
- Propose a clarification action.

## Missing Information
- Missing information must be explicit.
- Missing information must not replace factual state.
