# Normalization Rules

Before adding a new object, the agent must check for semantic similarity against existing objects.

## Thresholds
- similarity >= 0.90: MERGE
- similarity >= 0.75 and < 0.90: NEEDS_REVIEW
- similarity < 0.75: CREATE_NEW

## Mandatory Rule
If a match is found at similarity >= 0.90, MERGE, do not CREATE.

## Matching Keys

### Person
- full_name
- email
- phone
- organization
- aliases

### Organization
- legal_name
- display_name
- domains
- aliases

### Workspace
- title
- participant overlap
- related artifact overlap
- date overlap
- organization overlap

### Artifact
- checksum
- canonical_uri
- title similarity
- file_path
- version lineage

### CommunicationThread
- participants
- subject
- channel
- date proximity

## Merge Logging
Every merge must be appended to:
- state/entity_index.json
- state/ingest_log.json

Required fields:
- old_candidate
- merged_into
- similarity_score
- reason
- timestamp
