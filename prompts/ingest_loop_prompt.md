# Ingest Loop Prompt

For each new input, run the following sequence exactly:

1. Layer 1 Raw Truth
Return:
- raw_facts[]
- source_refs[]

2. Layer 2 Entity Linking
Return:
- entity_candidates[]
- matched_entities[]
- proposed_new_entities[]
- similarity_candidates[]

3. Layer 3 State Check
Return:
- state_updates[]
- unchanged_entities[]
- ambiguities[]

4. Layer 4 Relational Update
Return:
- new_obligations[]
- updated_obligations[]
- dependency_changes[]

5. Layer 5 Inference
Return:
- inferences[]
- risk_flags[]
- priority_estimates[]
- missing_information[]

6. Layer 6 Agency
Return:
- proposed_actions[3]
- approval_required
- action_rationale[]

Then:
- persist accepted changes
- append ingest event to state/ingest_log.json
- update state/world_state.md
- update state/world_state.json

Do not use freeform prose outside these required fields.
