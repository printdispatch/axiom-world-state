/**
 * Delta Schema
 *
 * A Delta is the pure data object produced by the CognitionService after
 * interpreting an Episode. It represents a *proposed* transaction of changes
 * to the World State.
 *
 * The Orchestrator receives a Delta and commits it via WorldStateStore.
 * The Engine never writes to the state directly — it only proposes Deltas.
 *
 * This is the core contract between the Engine and the World State.
 */

import { UUID, ISODateTime } from "./common.js";
import { ObligationStatus, PriorityLevel } from "../src/state/world_state_store.js";

// ─── Entity Changes ───────────────────────────────────────────────────────────

export interface EntityCreateChange {
  type: "create";
  name: string;
  entity_type: string;                // "organization" | "person" | "artifact" | "domain"
  lookup_key?: string;
  aliases?: string[];
  confidence: number;                  // 0.0–1.0
  source_fact: string;
}

export interface EntityUpdateChange {
  type: "update";
  entity_id: UUID;
  entity_name: string;
  changes: Record<string, unknown>;
  confidence: number;
  source_fact: string;
}

export type EntityChange = EntityCreateChange | EntityUpdateChange;

// ─── Obligation Changes ───────────────────────────────────────────────────────

export interface ObligationCreateChange {
  type: "create";
  title: string;
  description: string;
  owed_by: string;
  owed_to: string;
  priority: PriorityLevel;
  due_hint?: string;
  workspace_hint?: string;
  confidence: number;
  source_fact: string;
}

export interface ObligationUpdateChange {
  type: "update";
  obligation_id: UUID;
  obligation_title: string;
  new_status: ObligationStatus;
  reason: string;
  confidence: number;
}

export type ObligationChange = ObligationCreateChange | ObligationUpdateChange;

// ─── Fact Changes ─────────────────────────────────────────────────────────────

export interface FactChange {
  entity_name: string;               // Canonical name of the entity
  property: string;                  // e.g. "billing_status", "last_seen"
  value: string;
  valid_from: ISODateTime;
  confidence: number;
  source_fact: string;
}

// ─── Contradiction ────────────────────────────────────────────────────────────

export interface ContradictionFound {
  description: string;
  entity_name: string;
  field?: string;
  existing_value?: string;
  incoming_value?: string;
}

// ─── The Delta ────────────────────────────────────────────────────────────────

export interface Delta {
  id: UUID;                            // "delta-{uuid}"
  episode_id: UUID;
  produced_at: ISODateTime;
  is_noise: boolean;
  noise_reason?: string;

  // Proposed changes — none of these are applied until commitDelta() is called
  entity_changes: EntityChange[];
  obligation_changes: ObligationChange[];
  fact_changes: FactChange[];
  contradictions_found: ContradictionFound[];

  // Deliberation output — what the engine recommends doing after commit
  proposed_actions: Array<{
    action_type: string;
    description: string;
    urgency: "low" | "medium" | "high" | "critical";
    requires_approval: boolean;
    rationale: string;
  }>;

  // Metadata
  model: string;
  confidence_overall: number;          // 0.0–1.0
  interpretation_summary: string;      // One sentence: what this episode means
}
