/**
 * RecipeEngine
 *
 * Executes automation recipes in response to system events.
 *
 * Architecture:
 * - Listens to EventBus for trigger events
 * - Matches events against enabled recipes
 * - Evaluates trigger conditions
 * - Executes recipe steps in sequence
 * - Enforces risk gating (high/critical recipes require approval)
 * - Records all runs with full provenance
 */

import type { EventBus } from "../event_bus.js";
import type { RecipeStore } from "./recipe_store.js";
import type { Recipe, RecipeRun, RecipeStep, TriggerKind } from "../../schema/recipes.js";

export interface RecipeEngineOptions {
  /** If true, high/critical recipes are always queued for approval. Default: true. */
  enforceApproval?: boolean;
}

export class RecipeEngine {
  private bus: EventBus;
  private store: RecipeStore;
  private enforceApproval: boolean;

  constructor(bus: EventBus, store: RecipeStore, opts: RecipeEngineOptions = {}) {
    this.bus = bus;
    this.store = store;
    this.enforceApproval = opts.enforceApproval ?? true;
    this.registerListeners();
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────

  private registerListeners(): void {
    const triggerKinds: TriggerKind[] = [
      "signal_received",
      "obligation_created",
      "obligation_overdue",
      "contradiction_detected",
      "entity_created",
      "entity_merged",
      "review_required",
      "review_decided",
      "processing_complete",
    ];

    for (const kind of triggerKinds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.bus.on(kind as any, (payload: unknown) => {
        this.handleEvent(kind, payload as Record<string, unknown>);
      });
    }
  }

  // ─── Event Handling ───────────────────────────────────────────────────────

  private handleEvent(kind: TriggerKind, payload: Record<string, unknown>): void {
    const recipes = this.store.findRecipesByTrigger(kind);
    for (const recipe of recipes) {
      if (this.matchesConditions(recipe, payload)) {
        void this.executeRecipe(recipe, payload);
      }
    }
  }

  /**
   * Check if an event payload satisfies all trigger conditions.
   * Conditions are simple equality checks on dot-notation paths.
   */
  private matchesConditions(recipe: Recipe, payload: Record<string, unknown>): boolean {
    const conditions = recipe.trigger.conditions;
    if (!conditions || Object.keys(conditions).length === 0) return true;

    for (const [dotPath, expectedValue] of Object.entries(conditions)) {
      const actualValue = this.getNestedValue(payload, dotPath);
      if (actualValue !== expectedValue) return false;
    }
    return true;
  }

  private getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
    const parts = dotPath.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  /** Execute a recipe, creating a run record and enforcing risk gating. */
  async executeRecipe(
    recipe: Recipe,
    triggerPayload: Record<string, unknown>
  ): Promise<RecipeRun> {
    const needsApproval =
      this.enforceApproval &&
      recipe.approval_required &&
      (recipe.risk_level === "high" || recipe.risk_level === "critical");

    if (needsApproval) {
      // Create a pending run and emit review_required
      const run = this.store.createRun({
        recipe_id: recipe.id,
        trigger_payload: triggerPayload,
        status: "pending_approval",
        step_results: [],
      });

      this.bus.emit("review_required", {
        signal_id: (triggerPayload.signal_id as string) ?? (triggerPayload.signalId as string) ?? "system",
        reason: `Recipe "${recipe.name}" requires approval (risk: ${recipe.risk_level})`,
      });

      return run;
    }

    // Create a running run record
    const run = this.store.createRun({
      recipe_id: recipe.id,
      trigger_payload: triggerPayload,
      status: "running",
      step_results: [],
    });

    const context: Record<string, unknown> = {
      trigger: triggerPayload,
      recipe_id: recipe.id,
      run_id: run.id,
    };

    const stepResults: RecipeRun["step_results"] = [];

    for (const step of recipe.steps) {
      if (this.shouldSkipStep(step, context)) {
        stepResults.push({ step_id: step.id, status: "skipped" });
        continue;
      }

      try {
        const output = await this.executeStep(step, context);
        stepResults.push({ step_id: step.id, status: "completed", output });
        // Make step output available to subsequent steps
        context[`step_${step.id}`] = output;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        stepResults.push({ step_id: step.id, status: "failed", error });
        // Stop execution on step failure
        const failedRun = this.store.updateRun(run.id, {
          status: "failed",
          step_results: stepResults,
          completed_at: new Date().toISOString(),
          error: `Step "${step.id}" failed: ${error}`,
        });
        return failedRun!;
      }
    }

    const now = new Date().toISOString();
    this.store.incrementRunCount(recipe.id, now);

    const completedRun = this.store.updateRun(run.id, {
      status: "completed",
      step_results: stepResults,
      completed_at: now,
    });

    return completedRun!;
  }

  private shouldSkipStep(step: RecipeStep, context: Record<string, unknown>): boolean {
    if (!step.skip_if) return false;
    try {
      // Simple condition evaluation: support "context.key === value" patterns
      const fn = new Function("context", `return !!(${step.skip_if})`);
      return fn(context) as boolean;
    } catch {
      return false;
    }
  }

  /** Execute a single step and return its output. */
  private async executeStep(
    step: RecipeStep,
    context: Record<string, unknown>
  ): Promise<unknown> {
    switch (step.kind) {
      case "log_note": {
        const message = this.interpolate(step.params.message as string ?? "", context);
        return { logged: true, message };
      }

      case "emit_event": {
        const eventName = step.params.event as string;
        const eventPayload = step.params.payload as Record<string, unknown> ?? {};
        const interpolatedPayload = this.interpolateObject(eventPayload, context);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.bus.emit(eventName as any, interpolatedPayload);
        return { emitted: eventName, payload: interpolatedPayload };
      }

      case "flag_for_review": {
        const reason = this.interpolate(step.params.reason as string ?? "Recipe flagged for review", context);
        const signalId = (context.trigger as Record<string, unknown>)?.signal_id as string
          ?? (context.trigger as Record<string, unknown>)?.signalId as string
          ?? "system";
        this.bus.emit("review_required", { signal_id: signalId, reason });
        return { flagged: true, reason };
      }

      case "create_obligation": {
        // Emit an event that the state engine can pick up
        const obligation = this.interpolateObject(step.params as Record<string, unknown>, context);
        this.bus.emit("review_required", {
          signal_id: "recipe-engine",
          reason: `Recipe created obligation: ${obligation.title ?? "Untitled"}`,
        });
        return { obligation_params: obligation };
      }

      case "set_workspace_status": {
        return {
          workspace_id: step.params.workspace_id,
          new_status: step.params.status,
          updated: true,
        };
      }

      case "send_notification": {
        const message = this.interpolate(step.params.message as string ?? "", context);
        return { notification_sent: true, message };
      }

      case "update_entity":
      case "create_workspace":
      default:
        return { step_kind: step.kind, params: step.params, executed: true };
    }
  }

  // ─── Template Interpolation ───────────────────────────────────────────────

  /** Replace {{path.to.value}} placeholders with values from context. */
  private interpolate(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
      const value = this.getNestedValue(context, path.trim());
      return value != null ? String(value) : `{{${path}}}`;
    });
  }

  private interpolateObject(
    obj: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = this.interpolate(value, context);
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        result[key] = this.interpolateObject(value as Record<string, unknown>, context);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // ─── Manual Trigger ───────────────────────────────────────────────────────

  /** Manually trigger a recipe by ID with a custom payload. */
  async triggerManual(
    recipeId: string,
    payload: Record<string, unknown> = {}
  ): Promise<RecipeRun | null> {
    const recipe = this.store.findRecipeById(recipeId);
    if (!recipe || !recipe.enabled) return null;
    return this.executeRecipe(recipe, { ...payload, manual: true });
  }
}
