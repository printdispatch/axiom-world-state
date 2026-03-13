# Protocol: Handle Late Payment

## Trigger
- Signal.signal_kind = payment_event
- ResourceRecord.state = late
- invoice due_at < now and state != paid

## Process
1. Extract invoice id, amount, due date, payer, status, source event.
2. Link organization, person, workspace, and resource.
3. Update factual resource state to late.
4. Create or update obligation.
5. Infer urgency and relationship risk.
6. Propose exactly 3 actions:
   - draft polite reminder
   - create follow-up task in 48h
   - escalate for approval if repeat delinquency
