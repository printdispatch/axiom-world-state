# UI Specification

## Primary Navigation
Bottom navigation:
- Feed
- Review
- Search
- State
- Settings

Optional secondary areas:
- Graph
- Recipes
- Health
- Simulation

## Screen 1: Feed
Purpose:
- Show reverse-chronological event stream

Card types:
- Signal
- State Update
- Obligation Change
- Inference
- Proposed Action
- Executed Action
- Contradiction
- Needs Review

Each card must show:
- timestamp
- source
- subject label
- workspace or entity label
- concise summary
- provenance snippet
- confidence if interpreted
- staleness if relevant

Tap behavior:
- tap card body -> Six-Layer Inspector
- tap workspace/entity chip -> Workspace or Entity Profile
- tap details -> Signal Detail

## Screen 2: Six-Layer Inspector
Purpose:
- Show exactly how the system processed an item

Required sections:
- Layer 1 Raw Truth
- Layer 2 Entity Linking
- Layer 3 State Check
- Layer 4 Relational Update
- Layer 5 Inference
- Layer 6 Agency

Required footer actions:
- Approve Action
- Dismiss
- Flag Incorrect

## Screen 3: Workspace Universe
Purpose:
- Show all relevant state for a workspace

Required sections:
- Timeline
- Open Obligations
- Artifacts
- Threads
- Tasks
- Related Events

## Screen 4: Signal Detail
Purpose:
- Show raw source, extracted data, linked entities, provenance, downstream impact

Required sections:
- Raw Text
- Attachments
- Extracted Information
- Linked Entities
- Provenance
- Downstream Impact

## Screen 5: Review Queue
Purpose:
- Surface ambiguity and gated actions

Required sections:
- Entity Review
- Contradictions
- Stale Signals
- High-Risk Actions

## Screen 6: World State
Purpose:
- Show current global situation

Required sections:
- Current Focus
- Open Obligations
- High Priority Workspaces
- Upcoming Events (<72h)
- Contradictions
- Waiting Chains
- Proposed Actions Queue

## Screen 7: Entity Profile
Purpose:
- Show local history and responsibilities for a person or organization

Required sections:
- Relationship Snapshot
- Timeline
- Obligations
- Threads
- Artifacts
- Active Workspaces

## Screen 8: Agent Reasoning Log
Purpose:
- Show chronological reasoning history for debugging

Required fields per entry:
- signal id
- timestamp
- model or agent
- six-layer summary
- resulting state changes
- resulting action proposals

## Screen 9: Knowledge Graph
Purpose:
- Visualize entity relationships and dependencies

Required node families:
- People
- Organizations
- Workspaces
- Artifacts
- Tasks
- Signals

Required edge types:
- sent
- owns
- linked_to
- depends_on
- supersedes
- requires

## Screen 10: Automation Recipes
Purpose:
- Manage reusable workflows

Required fields:
- name
- trigger
- steps
- success count
- failure count
- last used
- risk
- approval requirement

Actions:
- Edit Recipe
- Pause Automation
- View History

## Screen 11: System Health
Purpose:
- Show operational health of the engine

Required sections:
- Signal Flow
- Entity Health
- Interpretation Health
- Staleness
- Error Counts
- Review Backlog

## Screen 12: Simulation Mode
Purpose:
- Forecast downstream state changes from hypothetical changes

Required sections:
- Scenario prompt
- predicted state changes
- impacted obligations
- impacted deadlines
- confidence or uncertainty markers
