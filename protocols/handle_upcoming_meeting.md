# Protocol: Handle Upcoming Meeting

## Trigger
- Event.kind = meeting
- Event.start_at within 24h
- Event.preparation_state != ready

## Process
1. gather related threads
2. gather open obligations
3. gather latest artifacts
4. create meeting brief
5. propose exactly 3 actions:
   - generate brief
   - identify missing prep items
   - propose reminder or outreach
