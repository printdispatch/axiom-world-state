# Review Workflow

## Purpose
Review is where ambiguity, contradictions, risky actions, and uncertain merges are resolved by a human.

## Review Queue Categories
- Entity Review
- Contradictions
- Stale Signals
- High-Risk Actions
- Low-Confidence Inferences
- Failed Automations

## Human Review Actions
- Approve
- Reject
- Merge
- Keep Separate
- Mark Incorrect
- Reopen
- Escalate
- Snooze
- Convert to Task

## Entity Review
When shown:
- similarity between 0.75 and 0.90
- conflicting organization or email data
- candidate duplicate workspace

Reviewer must choose:
- merge
- keep separate
- edit canonical fields first

## Contradiction Review
When shown:
- two sources conflict
- state and signal conflict
- obligation and resource record conflict

Reviewer options:
- select source of truth
- mark both unresolved
- create clarification task

## Stale Signal Review
When shown:
- signal older than 24h not moved to state
- signal remains unresolved
- signal likely still relevant

Reviewer options:
- move to state
- mark stale informational
- create follow-up task
- dismiss with reason

## High-Risk Action Review
When shown:
- action risk is high or critical

Reviewer options:
- approve execution
- convert to draft only
- reject
- request more context

## Review Logging
Every review decision must store:
- reviewer
- timestamp
- reviewed item id
- decision
- reason
- resulting state changes
