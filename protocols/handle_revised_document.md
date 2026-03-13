# Protocol: Handle Revised Document

## Trigger
- Signal.signal_kind = file_modified
- or inbound message has attachment
- and new Artifact may supersede prior Artifact

## Process
1. compare checksum, title, and workspace links
2. detect version lineage
3. update prior artifact approval_state if superseded
4. create artifact diff if significant changes found
5. update blocked tasks or obligations
