/**
 * ProcessingResult Schema
 *
 * The structured output produced by the Six-Layer Processing Engine
 * for every signal that passes through it.
 *
 * Each field maps directly to one of the six layers defined in
 * rules/six_layer_world_model.md. The layers must be completed in order
 * and no layer may be skipped.
 */

import {
  UUID,
  ISODateTime,
  ConfidenceScore,
  RiskLevel,
  PriorityLevel,
} from "./common.js";

// ─── Layer 1: Raw Truth ───────────────────────────────────────────────────────

export interface RawFact {
  /** The exact fact as extracted from the source — no interpretation */
  fact: string;
  /** The source reference this fact was drawn from */
  source_ref: string;
}

export interface Layer1RawTruth {
  raw_facts: RawFact[];
  /** True if the signal contains no actionable content (spam, marketing, etc.) */
  is_noise: boolean;
  /** Reason for noise classification, if applicable */
  noise_reason?: string;
}

// ─── Layer 2: Entity Linking ──────────────────────────────────────────────────

export type EntityDomain =
  | "person"
  | "organization"
  | "workspace"
  | "artifact"
  | "task"
  | "obligation"
  | "account";

export interface EntityCandidate {
  /** The name or identifier of the candidate entity */
  label: string;
  /** The domain this entity belongs to */
  domain: EntityDomain;
  /** Whether this entity likely already exists in the world state */
  likely_existing: boolean;
  /** Normalized identifier to use for lookup (e.g. email address, company name) */
  lookup_key: string;
  /** Email address for person entities — used for exact-match deduplication */
  email?: string;
  /** Arbitrary key-value attributes extracted from the signal */
  attributes?: Record<string, string | number | boolean | null>;
}

export interface Layer2EntityLinking {
  entity_candidates: EntityCandidate[];
  /** IDs of entities confirmed to exist in the world state */
  matched_entity_ids: UUID[];
  /** Entities that should be created if they don't exist */
  proposed_new_entities: EntityCandidate[];
  /** Pairs of entities that may be the same and need review */
  similarity_conflicts: Array<{ a: string; b: string; reason: string }>;
}

// ─── Layer 3: State Check ─────────────────────────────────────────────────────

export interface StateUpdate {
  /** The entity being updated */
  entity_label: string;
  entity_domain: EntityDomain;
  /** The field or property that changed */
  field: string;
  /** The new value */
  new_value: string;
  /** The previous value, if known */
  previous_value?: string;
  /** The source fact that justifies this update */
  source_fact: string;
}

export interface Layer3StateCheck {
  state_updates: StateUpdate[];
  /** Entities whose state did not change from this signal */
  unchanged_entities: string[];
  /** Facts that are unclear or contradictory */
  ambiguities: Array<{ description: string; entities_involved: string[] }>;
}

// ─── Layer 4: Relational Update ───────────────────────────────────────────────

export interface ObligationCandidate {
  title: string;
  description: string;
  /** Who owes the obligation */
  owed_by: string;
  /** Who the obligation is owed to */
  owed_to: string;
  /** The workspace or project this relates to */
  workspace_hint?: string;
  /** Source fact that establishes this obligation */
  source_fact: string;
  /** Whether this is a new obligation or an update to an existing one */
  is_new: boolean;
  priority: PriorityLevel;
  due_hint?: string;
}

export interface Layer4RelationalUpdate {
  new_obligations: ObligationCandidate[];
  updated_obligations: ObligationCandidate[];
  /** Changes to task dependencies or waiting states */
  dependency_changes: Array<{
    description: string;
    entities_involved: string[];
  }>;
}

// ─── Layer 5: Inference ───────────────────────────────────────────────────────

export interface Inference {
  /** The inference statement */
  statement: string;
  /** Confidence score 0.0–1.0 */
  confidence: ConfidenceScore;
  /** The facts this inference is based on */
  based_on_facts: string[];
  /** Risk level if this inference is wrong */
  risk_if_wrong: RiskLevel;
}

export interface Layer5Inference {
  inferences: Inference[];
  risk_flags: Array<{
    description: string;
    risk_level: RiskLevel;
    entity_label: string;
  }>;
  priority_estimates: Array<{
    entity_label: string;
    priority: PriorityLevel;
    rationale: string;
  }>;
  missing_information: Array<{
    description: string;
    needed_for: string;
  }>;
}

// ─── Layer 6: Agency ─────────────────────────────────────────────────────────

export type ActionKind =
  | "create_task"
  | "create_obligation"
  | "update_entity"
  | "flag_for_review"
  | "draft_reply"
  | "send_reply"
  | "create_workspace"
  | "log_payment"
  | "request_information"
  | "archive_signal"
  | "escalate";

export interface ProposedAction {
  /** Sequential number 1, 2, or 3 */
  rank: 1 | 2 | 3;
  kind: ActionKind;
  /** Human-readable description of the action */
  description: string;
  /** The entity or entities this action targets */
  target_entities: string[];
  risk: RiskLevel;
  /** Whether this action requires explicit human approval before execution */
  requires_approval: boolean;
  /** The reasoning behind proposing this action */
  rationale: string;
  /** Estimated impact if this action is taken */
  expected_outcome: string;
}

export interface Layer6Agency {
  /** Always exactly 3 proposed actions, ranked by usefulness */
  proposed_actions: [ProposedAction, ProposedAction, ProposedAction];
  /** True if any of the three actions require approval */
  any_requires_approval: boolean;
  /** Overall confidence in the agency layer output */
  confidence: ConfidenceScore;
}

// ─── Full ProcessingResult ────────────────────────────────────────────────────

export interface ProcessingResult {
  /** Unique ID for this processing record */
  id: UUID;
  /** The signal that was processed */
  signal_id: UUID;
  /** When processing was completed */
  processed_at: ISODateTime;
  /** The model used for processing */
  model: string;
  /** Total tokens used */
  tokens_used?: number;

  /** Layer outputs */
  layer_1: Layer1RawTruth;
  layer_2: Layer2EntityLinking;
  layer_3: Layer3StateCheck;
  layer_4: Layer4RelationalUpdate;
  layer_5: Layer5Inference;
  layer_6: Layer6Agency;

  /**
   * If true, this signal was classified as noise in Layer 1.
   * Layers 2–6 will contain minimal/empty output.
   * The signal is archived without further processing.
   */
  is_noise: boolean;
}
