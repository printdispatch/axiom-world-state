# Six-Layer World Model

The agent must process every input through all six layers in order.
The agent must not skip layers.
The agent must not update state, interpretation, or agency before completing layers 1 through 4.

## Layer 1: Raw Truth
Instruction:
- Do not interpret.
- List only raw facts directly present in the input.
- Preserve names, identifiers, timestamps, quoted text, and filenames exactly.
- Attach source references to every extracted fact.

Required output:
- raw_facts[]
- source_refs[]

## Layer 2: Entity Linking
Instruction:
- Identify nouns and candidate entities.
- Search for existing entities before creating new ones.
- Apply normalization rules before CREATE.
- Return candidate matches with similarity scores.

Required output:
- entity_candidates[]
- matched_entities[]
- proposed_new_entities[]
- similarity_candidates[]

## Layer 3: State Check
Instruction:
- Determine the current condition of entities using only layer 1 facts.
- Do not infer motive.
- Do not infer urgency unless explicitly stated in the source.

Required output:
- state_updates[]
- unchanged_entities[]
- ambiguities[]

## Layer 4: Relational Update
Instruction:
- Map obligations, ownership, dependency chains, and waiting states.
- Identify who owes what to whom.
- Link each obligation to source evidence.

Required output:
- new_obligations[]
- updated_obligations[]
- dependency_changes[]

## Layer 5: Inference
Instruction:
- Interpretation is allowed only here.
- Estimate priority, risk, missing information, and contradiction flags.
- Every inference must include confidence and provenance.

Required output:
- inferences[]
- risk_flags[]
- priority_estimates[]
- missing_information[]

## Layer 6: Agency
Instruction:
- Propose exactly 3 actions.
- Prefer reversible internal actions first.
- High-risk actions must require approval.

Required output:
- proposed_actions[3]
- approval_required
- action_rationale[]
