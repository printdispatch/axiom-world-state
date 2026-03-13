# Protocol: Handle New Lead

## Trigger
- Signal.signal_kind = incoming_message
- no matching active workspace
- sender not linked to active client workspace

## Process
1. link or create person and organization
2. link or create workspace
3. infer lead priority only at layer 5
4. propose exactly 3 actions:
   - create lead workspace
   - draft intake reply
   - create follow-up task
