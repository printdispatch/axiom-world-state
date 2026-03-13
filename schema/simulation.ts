/**
 * Simulation Schema
 *
 * Defines the structure for hypothetical state forecasting.
 * A simulation clones the current world state, applies a hypothetical change,
 * and computes the predicted downstream effects.
 */

// ─── Hypothetical Change ──────────────────────────────────────────────────────

export type HypotheticalKind =
  | "obligation_resolved"
  | "obligation_created"
  | "entity_attribute_change"
  | "contradiction_resolved"
  | "signal_received"
  | "custom";

export interface HypotheticalChange {
  /** The kind of change being simulated. */
  kind: HypotheticalKind;
  /** Human-readable description of the change. */
  description: string;
  /** The entity or object being changed. */
  target_id?: string;
  /** Key-value pairs representing the state change. */
  params: Record<string, unknown>;
}

// ─── Predicted Effect ─────────────────────────────────────────────────────────

export type EffectKind =
  | "obligation_status_change"
  | "entity_attribute_update"
  | "new_obligation"
  | "contradiction_resolved"
  | "workspace_status_change"
  | "health_score_change"
  | "review_queue_change";

export interface PredictedEffect {
  /** The kind of downstream effect. */
  kind: EffectKind;
  /** Human-readable description of the effect. */
  description: string;
  /** The entity or object affected. */
  target_id?: string;
  /** Predicted new values. */
  predicted_values: Record<string, unknown>;
  /** Confidence level (0–1). */
  confidence: number;
}

// ─── Simulation ───────────────────────────────────────────────────────────────

export type SimulationStatus = "pending" | "running" | "completed" | "failed";

export interface Simulation {
  /** Unique simulation identifier. */
  id: string;
  /** Human-readable name for this simulation. */
  name: string;
  /** The hypothetical change being applied. */
  change: HypotheticalChange;
  /** Current status. */
  status: SimulationStatus;
  /** Snapshot of world state at simulation time. */
  baseline_snapshot: WorldStateSnapshot;
  /** Predicted effects of the change. */
  predicted_effects: PredictedEffect[];
  /** Summary of the simulation outcome. */
  summary?: string;
  /** ISO timestamp when simulation was created. */
  created_at: string;
  /** ISO timestamp when simulation completed. */
  completed_at?: string;
  /** Error message if simulation failed. */
  error?: string;
}

// ─── World State Snapshot ─────────────────────────────────────────────────────

export interface WorldStateSnapshot {
  /** ISO timestamp of the snapshot. */
  captured_at: string;
  /** Number of open obligations. */
  open_obligations: number;
  /** Number of overdue obligations. */
  overdue_obligations: number;
  /** Number of active contradictions. */
  active_contradictions: number;
  /** Number of entities. */
  entity_count: number;
  /** Number of pending review items. */
  pending_review: number;
  /** Computed health score (0–100). */
  health_score: number;
  /** Key obligations for reference. */
  obligations: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    due_date?: string;
    owed_by: string;
    owed_to: string;
  }>;
  /** Key entities for reference. */
  entities: Array<{
    id: string;
    canonical_name: string;
    domain: string;
  }>;
}
