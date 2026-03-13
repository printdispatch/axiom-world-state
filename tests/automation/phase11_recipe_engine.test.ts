/**
 * Phase 11: Automation Recipes Tests
 *
 * Tests the RecipeStore, RecipeEngine, and recipe execution logic.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RecipeStore } from "../../src/automation/recipe_store.js";
import { RecipeEngine } from "../../src/automation/recipe_engine.js";
import { EventBus } from "../../src/event_bus.js";
import type { Recipe } from "../../schema/recipes.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRecipeData(overrides: Partial<Omit<Recipe, "id" | "created_at" | "updated_at" | "run_count">> = {}): Omit<Recipe, "id" | "created_at" | "updated_at" | "run_count"> {
  return {
    name: "Test Recipe",
    description: "A test automation recipe",
    enabled: true,
    trigger: { kind: "signal_received" },
    steps: [
      { id: "step-1", kind: "log_note", params: { message: "Signal received: {{trigger.signalId}}" } },
    ],
    risk_level: "low",
    approval_required: false,
    ...overrides,
  };
}

// ─── RecipeStore Tests ────────────────────────────────────────────────────────

describe("Phase 11 — RecipeStore", () => {
  let tmpDir: string;
  let store: RecipeStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-recipe-test-"));
    store = new RecipeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initializes with empty recipe and run lists", () => {
    expect(store.listRecipes()).toHaveLength(0);
    expect(store.listRuns()).toHaveLength(0);
  });

  it("creates a recipe with auto-generated ID and timestamps", () => {
    const recipe = store.createRecipe(makeRecipeData());
    expect(recipe.id).toMatch(/^recipe-/);
    expect(recipe.created_at).toBeTruthy();
    expect(recipe.updated_at).toBeTruthy();
    expect(recipe.run_count).toBe(0);
  });

  it("persists recipes to disk and reloads them", () => {
    store.createRecipe(makeRecipeData({ name: "Recipe A" }));
    const store2 = new RecipeStore(tmpDir);
    const recipes = store2.listRecipes();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe("Recipe A");
  });

  it("finds a recipe by ID", () => {
    const recipe = store.createRecipe(makeRecipeData());
    const found = store.findRecipeById(recipe.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(recipe.id);
  });

  it("returns undefined for unknown recipe ID", () => {
    expect(store.findRecipeById("recipe-unknown")).toBeUndefined();
  });

  it("finds recipes by trigger kind", () => {
    store.createRecipe(makeRecipeData({ trigger: { kind: "signal_received" } }));
    store.createRecipe(makeRecipeData({ trigger: { kind: "obligation_created" } }));
    const signalRecipes = store.findRecipesByTrigger("signal_received");
    expect(signalRecipes).toHaveLength(1);
    expect(signalRecipes[0].trigger.kind).toBe("signal_received");
  });

  it("only returns enabled recipes from findRecipesByTrigger", () => {
    store.createRecipe(makeRecipeData({ enabled: true }));
    store.createRecipe(makeRecipeData({ enabled: false }));
    const results = store.findRecipesByTrigger("signal_received");
    expect(results).toHaveLength(1);
    expect(results[0].enabled).toBe(true);
  });

  it("updates a recipe", () => {
    const recipe = store.createRecipe(makeRecipeData());
    const updated = store.updateRecipe(recipe.id, { name: "Updated Name", enabled: false });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Name");
    expect(updated!.enabled).toBe(false);
    // Verify persisted
    const found = store.findRecipeById(recipe.id);
    expect(found!.name).toBe("Updated Name");
  });

  it("returns null when updating unknown recipe", () => {
    const result = store.updateRecipe("recipe-unknown", { name: "X" });
    expect(result).toBeNull();
  });

  it("increments run count", () => {
    const recipe = store.createRecipe(makeRecipeData());
    expect(recipe.run_count).toBe(0);
    store.incrementRunCount(recipe.id, new Date().toISOString());
    const updated = store.findRecipeById(recipe.id);
    expect(updated!.run_count).toBe(1);
  });

  it("creates a run record", () => {
    const recipe = store.createRecipe(makeRecipeData());
    const run = store.createRun({
      recipe_id: recipe.id,
      trigger_payload: { signalId: "sig-001" },
      status: "completed",
      step_results: [],
    });
    expect(run.id).toMatch(/^run-/);
    expect(run.recipe_id).toBe(recipe.id);
    expect(run.status).toBe("completed");
  });

  it("lists runs by recipe ID", () => {
    const r1 = store.createRecipe(makeRecipeData());
    const r2 = store.createRecipe(makeRecipeData());
    store.createRun({ recipe_id: r1.id, trigger_payload: {}, status: "completed", step_results: [] });
    store.createRun({ recipe_id: r2.id, trigger_payload: {}, status: "completed", step_results: [] });
    expect(store.listRunsByRecipe(r1.id)).toHaveLength(1);
    expect(store.listRunsByRecipe(r2.id)).toHaveLength(1);
  });

  it("updates a run record", () => {
    const recipe = store.createRecipe(makeRecipeData());
    const run = store.createRun({
      recipe_id: recipe.id,
      trigger_payload: {},
      status: "running",
      step_results: [],
    });
    const updated = store.updateRun(run.id, { status: "completed", completed_at: new Date().toISOString() });
    expect(updated!.status).toBe("completed");
    expect(updated!.completed_at).toBeTruthy();
  });
});

// ─── RecipeEngine Tests ───────────────────────────────────────────────────────

describe("Phase 11 — RecipeEngine", () => {
  let tmpDir: string;
  let store: RecipeStore;
  let bus: EventBus;
  let engine: RecipeEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-engine-test-"));
    store = new RecipeStore(tmpDir);
    bus = new EventBus();
    engine = new RecipeEngine(bus, store, { enforceApproval: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes a recipe when its trigger event fires", async () => {
    store.createRecipe(makeRecipeData({
      trigger: { kind: "signal_received" },
      steps: [{ id: "s1", kind: "log_note", params: { message: "hello" } }],
    }));

    bus.emit("signal_received", { signalId: "sig-001", sourceKind: "email", title: "Test", observedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));

    const runs = store.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].status).toBe("completed");
  });

  it("creates a pending_approval run for high-risk recipes", async () => {
    store.createRecipe(makeRecipeData({
      risk_level: "high",
      approval_required: true,
      trigger: { kind: "signal_received" },
      steps: [{ id: "s1", kind: "log_note", params: { message: "risky" } }],
    }));

    bus.emit("signal_received", { signalId: "sig-001", sourceKind: "email", title: "Test", observedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));

    const runs = store.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].status).toBe("pending_approval");
  });

  it("does not fire recipe when trigger conditions do not match", async () => {
    store.createRecipe(makeRecipeData({
      trigger: {
        kind: "signal_received",
        conditions: { "sourceKind": "sms" }, // only fires for SMS
      },
      steps: [{ id: "s1", kind: "log_note", params: { message: "sms only" } }],
    }));

    bus.emit("signal_received", { signalId: "sig-001", sourceKind: "email", title: "Test", observedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));

    expect(store.listRuns()).toHaveLength(0);
  });

  it("fires recipe when trigger conditions match", async () => {
    store.createRecipe(makeRecipeData({
      trigger: {
        kind: "signal_received",
        conditions: { "sourceKind": "email" },
      },
      steps: [{ id: "s1", kind: "log_note", params: { message: "email only" } }],
    }));

    bus.emit("signal_received", { signalId: "sig-001", sourceKind: "email", title: "Test", observedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));

    const runs = store.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].status).toBe("completed");
  });

  it("does not execute disabled recipes", async () => {
    store.createRecipe(makeRecipeData({
      enabled: false,
      trigger: { kind: "signal_received" },
    }));

    bus.emit("signal_received", { signalId: "sig-001", sourceKind: "email", title: "Test", observedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));

    expect(store.listRuns()).toHaveLength(0);
  });

  it("records step results in the run", async () => {
    store.createRecipe(makeRecipeData({
      steps: [
        { id: "s1", kind: "log_note", params: { message: "step 1" } },
        { id: "s2", kind: "log_note", params: { message: "step 2" } },
      ],
    }));

    bus.emit("signal_received", { signalId: "sig-001", sourceKind: "email", title: "Test", observedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));

    const runs = store.listRuns();
    expect(runs[0].step_results).toHaveLength(2);
    expect(runs[0].step_results[0].status).toBe("completed");
    expect(runs[0].step_results[1].status).toBe("completed");
  });

  it("increments recipe run_count after successful execution", async () => {
    const recipe = store.createRecipe(makeRecipeData());
    expect(recipe.run_count).toBe(0);

    bus.emit("signal_received", { signalId: "sig-001", sourceKind: "email", title: "Test", observedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));

    const updated = store.findRecipeById(recipe.id);
    expect(updated!.run_count).toBe(1);
  });

  it("manually triggers a recipe via triggerManual", async () => {
    const recipe = store.createRecipe(makeRecipeData());
    const run = await engine.triggerManual(recipe.id, { custom: "payload" });
    expect(run).toBeDefined();
    expect(run!.status).toBe("completed");
    expect(run!.trigger_payload.manual).toBe(true);
  });

  it("returns null when manually triggering unknown recipe", async () => {
    const result = await engine.triggerManual("recipe-unknown");
    expect(result).toBeNull();
  });

  it("returns null when manually triggering disabled recipe", async () => {
    const recipe = store.createRecipe(makeRecipeData({ enabled: false }));
    const result = await engine.triggerManual(recipe.id);
    expect(result).toBeNull();
  });

  it("emits review_required when high-risk recipe fires", async () => {
    const reviewEvents: unknown[] = [];
    bus.on("review_required", (p) => reviewEvents.push(p));

    store.createRecipe(makeRecipeData({
      risk_level: "critical",
      approval_required: true,
      trigger: { kind: "contradiction_detected" },
    }));

    bus.emit("contradiction_detected", { signal_id: "sig-001", description: "Conflict", entities: [] });
    await new Promise((r) => setTimeout(r, 50));

    expect(reviewEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("interpolates template variables in step params", async () => {
    const recipe = store.createRecipe(makeRecipeData({
      steps: [
        { id: "s1", kind: "log_note", params: { message: "Signal: {{trigger.signalId}}" } },
      ],
    }));

    const run = await engine.executeRecipe(
      store.findRecipeById(recipe.id)!,
      { signalId: "sig-test-123" }
    );

    expect(run.step_results[0].output).toEqual({
      logged: true,
      message: "Signal: sig-test-123",
    });
  });
});
