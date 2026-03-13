/**
 * Recipe Schema
 *
 * Defines the structure for automation recipes — reusable, risk-gated
 * workflows that trigger on system events and execute a sequence of steps.
 */

// ─── Trigger Types ────────────────────────────────────────────────────────────

export type TriggerKind =
  | "signal_received"
  | "obligation_created"
  | "obligation_overdue"
  | "contradiction_detected"
  | "entity_created"
  | "entity_merged"
  | "review_required"
  | "review_decided"
  | "processing_complete"
  | "manual";

export interface RecipeTrigger {
  /** The event that activates this recipe. */
  kind: TriggerKind;
  /**
   * Optional filter conditions. The recipe only fires when all conditions match.
   * Keys are dot-notation paths into the event payload, values are expected values.
   * Example: { "signal.source": "gmail", "result.is_noise": false }
   */
  conditions?: Record<string, unknown>;
}

// ─── Step Types ───────────────────────────────────────────────────────────────

export type StepKind =
  | "create_obligation"
  | "update_entity"
  | "flag_for_review"
  | "emit_event"
  | "log_note"
  | "send_notification"
  | "set_workspace_status"
  | "create_workspace";

export interface RecipeStep {
  /** Unique step identifier within the recipe. */
  id: string;
  /** The operation to perform. */
  kind: StepKind;
  /** Step-specific parameters. */
  params: Record<string, unknown>;
  /**
   * Optional condition to skip this step.
   * Dot-notation path into the execution context.
   * Example: "context.entity.domain === 'person'"
   */
  skip_if?: string;
}

// ─── Recipe ───────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface Recipe {
  /** Unique recipe identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this recipe does. */
  description: string;
  /** Whether this recipe is active. */
  enabled: boolean;
  /** The event that triggers this recipe. */
  trigger: RecipeTrigger;
  /** Ordered list of steps to execute. */
  steps: RecipeStep[];
  /** Risk level — determines whether approval is required. */
  risk_level: RiskLevel;
  /** If true, the recipe will not execute until a human approves it. */
  approval_required: boolean;
  /** ISO timestamp when this recipe was created. */
  created_at: string;
  /** ISO timestamp when this recipe was last modified. */
  updated_at: string;
  /** Number of times this recipe has been triggered. */
  run_count: number;
  /** ISO timestamp of the last successful run. */
  last_run_at?: string;
}

// ─── Execution Record ─────────────────────────────────────────────────────────

export type RecipeRunStatus = "pending_approval" | "running" | "completed" | "failed" | "skipped";

export interface RecipeRun {
  /** Unique run identifier. */
  id: string;
  /** The recipe that was executed. */
  recipe_id: string;
  /** The event payload that triggered this run. */
  trigger_payload: Record<string, unknown>;
  /** Current status of this run. */
  status: RecipeRunStatus;
  /** Results from each step. */
  step_results: Array<{
    step_id: string;
    status: "completed" | "skipped" | "failed";
    output?: unknown;
    error?: string;
  }>;
  /** ISO timestamp when this run was created. */
  started_at: string;
  /** ISO timestamp when this run completed. */
  completed_at?: string;
  /** Error message if the run failed. */
  error?: string;
  /** Review item ID if approval was required. */
  review_item_id?: string;
}
