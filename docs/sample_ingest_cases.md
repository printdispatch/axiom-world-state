# Sample Ingest Cases

## Case 1: Late Payment
Input:
- email from accounting
- invoice #0084 due yesterday
- payment not received

Expected:
- Signal created
- ResourceRecord state updated to late
- Obligation created or updated
- Inference estimates urgency and relationship risk
- Proposed actions:
  - draft polite reminder
  - create 48h follow-up task
  - escalate if repeat delinquency

## Case 2: Revised PDF
Input:
- email from Sarah Roy
- attachment plan_v3.pdf
- mentions revised install schedule

Expected:
- Signal created
- Artifact linked and version lineage detected
- prior artifact superseded if match found
- dependency chain updated
- workspace timeline updated
- proposed actions include review of revision

## Case 3: Upcoming Meeting
Input:
- calendar event within 24h
- workspace linked
- preparation_state != ready

Expected:
- Signal created
- Event linked to workspace
- briefing need inferred
- proposed actions:
  - generate brief
  - identify missing prep items
  - notify operator of unresolved obligations

## Case 4: Missed Reply
Input:
- unresolved thread
- no reply within policy window
- explicit promise exists in prior message

Expected:
- stale or aging signal created or updated
- obligation remains open
- follow-up task created
- reply draft proposed

## Case 5: Contradiction
Input:
- shipment marked delayed
- invoice marked paid
- obligation still open

Expected:
- contradiction flag created
- review queue item created
- no silent auto-resolution
- clarification task optional
