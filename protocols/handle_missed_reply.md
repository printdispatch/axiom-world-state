# Protocol: Handle Missed Reply

## Trigger
- thread unresolved = true
- no outbound response within SLA window
- open obligation exists

## Process
1. find latest inbound message
2. verify whether a reply was promised
3. update obligation if commitment exists
4. create follow-up task
5. propose reply draft if risk >= medium
