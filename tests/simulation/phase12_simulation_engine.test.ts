/**
 * Phase 12: Simulation Engine Tests
 *
 * Tests the SimulationEngine's ability to capture world state snapshots
 * and predict downstream effects of hypothetical changes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SimulationEngine } from "../../src/simulation/simulation_engine.js";
import type { HypotheticalChange, WorldStateSnapshot } from "../../schema/simulation.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function makeObligation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `ob-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test Obligation",
    status: "open",
    priority: "medium",
    owed_by: "Alice",
    owed_to: "Bob",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Phase 12 — SimulationEngine", () => {
  let tmpDir: string;
  let dataDir: string;
  let simDir: string;
  let engine: SimulationEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sim-test-"));
    dataDir = tmpDir;
    simDir = path.join(tmpDir, "simulations");
    engine = new SimulationEngine({ dataDir, storageDir: simDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Snapshot ───────────────────────────────────────────────────────────────

  it("captures a snapshot of empty world state", () => {
    const snapshot = engine.captureSnapshot();
    expect(snapshot.open_obligations).toBe(0);
    expect(snapshot.overdue_obligations).toBe(0);
    expect(snapshot.active_contradictions).toBe(0);
    expect(snapshot.entity_count).toBe(0);
    expect(snapshot.pending_review).toBe(0);
    expect(snapshot.health_score).toBe(100);
    expect(snapshot.captured_at).toBeTruthy();
  });

  it("snapshot reflects open obligations", () => {
    writeJson(path.join(dataDir, "state", "obligations.json"), [
      makeObligation({ status: "open" }),
      makeObligation({ status: "open" }),
      makeObligation({ status: "resolved" }),
    ]);
    const snapshot = engine.captureSnapshot();
    expect(snapshot.open_obligations).toBe(2);
  });

  it("snapshot identifies overdue obligations", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(path.join(dataDir, "state", "obligations.json"), [
      makeObligation({ status: "open", due_date: pastDate }),
      makeObligation({ status: "open", due_date: futureDate }),
      makeObligation({ status: "open" }), // no due date
    ]);
    const snapshot = engine.captureSnapshot();
    expect(snapshot.open_obligations).toBe(3);
    expect(snapshot.overdue_obligations).toBe(1);
  });

  it("snapshot counts active contradictions", () => {
    writeJson(path.join(dataDir, "state", "contradictions.json"), [
      { id: "c1", resolved: false },
      { id: "c2", resolved: true },
      { id: "c3", resolved: false },
    ]);
    const snapshot = engine.captureSnapshot();
    expect(snapshot.active_contradictions).toBe(2);
  });

  it("snapshot computes health score with deductions", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(path.join(dataDir, "state", "obligations.json"), [
      makeObligation({ status: "open", due_date: pastDate }),
    ]);
    writeJson(path.join(dataDir, "state", "contradictions.json"), [
      { id: "c1", resolved: false },
    ]);
    const snapshot = engine.captureSnapshot();
    // 1 overdue = -10, 1 contradiction = -7 → 83
    expect(snapshot.health_score).toBe(83);
  });

  it("snapshot health score is capped at 100 and floored at 0", () => {
    const snapshot = engine.captureSnapshot();
    expect(snapshot.health_score).toBeLessThanOrEqual(100);
    expect(snapshot.health_score).toBeGreaterThanOrEqual(0);
  });

  it("snapshot includes obligation details", () => {
    writeJson(path.join(dataDir, "state", "obligations.json"), [
      makeObligation({ id: "ob-001", title: "Pay invoice", status: "open", owed_by: "Alice", owed_to: "Bob" }),
    ]);
    const snapshot = engine.captureSnapshot();
    expect(snapshot.obligations).toHaveLength(1);
    expect(snapshot.obligations[0].id).toBe("ob-001");
    expect(snapshot.obligations[0].title).toBe("Pay invoice");
  });

  it("snapshot includes entity details", () => {
    writeJson(path.join(dataDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Acme Corp", domain: "organization", aliases: [] },
    ]);
    const snapshot = engine.captureSnapshot();
    expect(snapshot.entity_count).toBe(2);
    expect(snapshot.entities).toHaveLength(2);
  });

  // ── Effect Prediction ──────────────────────────────────────────────────────

  it("predicts obligation_status_change when obligation is resolved", () => {
    const snapshot: WorldStateSnapshot = {
      captured_at: new Date().toISOString(),
      open_obligations: 1,
      overdue_obligations: 0,
      active_contradictions: 0,
      entity_count: 2,
      pending_review: 0,
      health_score: 100,
      obligations: [{ id: "ob-001", title: "Pay invoice", status: "open", priority: "high", owed_by: "Alice", owed_to: "Bob" }],
      entities: [],
    };
    const change: HypotheticalChange = {
      kind: "obligation_resolved",
      description: "Resolve the invoice obligation",
      target_id: "ob-001",
      params: {},
    };
    const effects = engine.predictEffects(snapshot, change);
    const statusChange = effects.find((e) => e.kind === "obligation_status_change");
    expect(statusChange).toBeDefined();
    expect(statusChange!.predicted_values.status).toBe("resolved");
    expect(statusChange!.confidence).toBe(1.0);
  });

  it("predicts health score improvement when overdue obligation is resolved", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const snapshot: WorldStateSnapshot = {
      captured_at: new Date().toISOString(),
      open_obligations: 1,
      overdue_obligations: 1,
      active_contradictions: 0,
      entity_count: 0,
      pending_review: 0,
      health_score: 90, // 100 - 10 for 1 overdue
      obligations: [{ id: "ob-001", title: "Overdue invoice", status: "open", priority: "high", due_date: pastDate, owed_by: "Alice", owed_to: "Bob" }],
      entities: [],
    };
    const change: HypotheticalChange = {
      kind: "obligation_resolved",
      description: "Resolve overdue invoice",
      target_id: "ob-001",
      params: {},
    };
    const effects = engine.predictEffects(snapshot, change);
    const healthEffect = effects.find((e) => e.kind === "health_score_change");
    expect(healthEffect).toBeDefined();
    expect(healthEffect!.predicted_values.delta).toBeGreaterThan(0);
    expect(healthEffect!.predicted_values.new_score).toBeGreaterThan(snapshot.health_score);
  });

  it("predicts contradiction_resolved effect", () => {
    const snapshot: WorldStateSnapshot = {
      captured_at: new Date().toISOString(),
      open_obligations: 0,
      overdue_obligations: 0,
      active_contradictions: 2,
      entity_count: 0,
      pending_review: 0,
      health_score: 86, // 100 - 14 for 2 contradictions
      obligations: [],
      entities: [],
    };
    const change: HypotheticalChange = {
      kind: "contradiction_resolved",
      description: "Resolve entity conflict",
      target_id: "c-001",
      params: {},
    };
    const effects = engine.predictEffects(snapshot, change);
    const contraEffect = effects.find((e) => e.kind === "contradiction_resolved");
    expect(contraEffect).toBeDefined();
    expect(contraEffect!.predicted_values.new_count).toBe(1);
    expect(contraEffect!.predicted_values.old_count).toBe(2);
  });

  it("predicts new_obligation effect when obligation is created", () => {
    const snapshot: WorldStateSnapshot = {
      captured_at: new Date().toISOString(),
      open_obligations: 0,
      overdue_obligations: 0,
      active_contradictions: 0,
      entity_count: 0,
      pending_review: 0,
      health_score: 100,
      obligations: [],
      entities: [],
    };
    const change: HypotheticalChange = {
      kind: "obligation_created",
      description: "Create a new invoice obligation",
      params: { title: "Invoice #123", priority: "high", owed_by: "Client", owed_to: "Us" },
    };
    const effects = engine.predictEffects(snapshot, change);
    const newOb = effects.find((e) => e.kind === "new_obligation");
    expect(newOb).toBeDefined();
    expect(newOb!.confidence).toBe(1.0);
  });

  it("predicts review queue change for high-priority obligation creation", () => {
    const snapshot: WorldStateSnapshot = {
      captured_at: new Date().toISOString(),
      open_obligations: 0,
      overdue_obligations: 0,
      active_contradictions: 0,
      entity_count: 0,
      pending_review: 0,
      health_score: 100,
      obligations: [],
      entities: [],
    };
    const change: HypotheticalChange = {
      kind: "obligation_created",
      description: "High-priority obligation",
      params: { title: "Critical task", priority: "critical" },
    };
    const effects = engine.predictEffects(snapshot, change);
    const reviewEffect = effects.find((e) => e.kind === "review_queue_change");
    expect(reviewEffect).toBeDefined();
  });

  it("predicts entity_attribute_update for entity changes", () => {
    const snapshot: WorldStateSnapshot = {
      captured_at: new Date().toISOString(),
      open_obligations: 0,
      overdue_obligations: 0,
      active_contradictions: 0,
      entity_count: 1,
      pending_review: 0,
      health_score: 100,
      obligations: [],
      entities: [{ id: "ent-001", canonical_name: "Alice", domain: "person" }],
    };
    const change: HypotheticalChange = {
      kind: "entity_attribute_change",
      description: "Update Alice's email",
      target_id: "ent-001",
      params: { email: "alice@example.com" },
    };
    const effects = engine.predictEffects(snapshot, change);
    const attrEffect = effects.find((e) => e.kind === "entity_attribute_update");
    expect(attrEffect).toBeDefined();
    expect(attrEffect!.target_id).toBe("ent-001");
  });

  it("returns speculative effects for custom changes", () => {
    const snapshot: WorldStateSnapshot = {
      captured_at: new Date().toISOString(),
      open_obligations: 0,
      overdue_obligations: 0,
      active_contradictions: 0,
      entity_count: 0,
      pending_review: 0,
      health_score: 100,
      obligations: [],
      entities: [],
    };
    const change: HypotheticalChange = {
      kind: "custom",
      description: "Some custom change",
      params: {},
    };
    const effects = engine.predictEffects(snapshot, change);
    expect(effects).toHaveLength(1);
    expect(effects[0].confidence).toBe(0.3);
  });

  // ── Full Simulation ────────────────────────────────────────────────────────

  it("runs a complete simulation and persists the result", () => {
    const change: HypotheticalChange = {
      kind: "custom",
      description: "Test simulation",
      params: {},
    };
    const sim = engine.simulate("Test Sim", change);
    expect(sim.id).toMatch(/^sim-/);
    expect(sim.status).toBe("completed");
    expect(sim.baseline_snapshot).toBeDefined();
    expect(sim.predicted_effects).toBeDefined();
    expect(sim.summary).toBeTruthy();
    expect(sim.completed_at).toBeTruthy();
  });

  it("persists simulation to disk and retrieves it", () => {
    const change: HypotheticalChange = { kind: "custom", description: "Persist test", params: {} };
    const sim = engine.simulate("Persist Test", change);
    const found = engine.findSimulationById(sim.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(sim.id);
    expect(found!.name).toBe("Persist Test");
  });

  it("lists all simulations newest first", () => {
    engine.simulate("Sim 1", { kind: "custom", description: "First", params: {} });
    engine.simulate("Sim 2", { kind: "custom", description: "Second", params: {} });
    const sims = engine.listSimulations();
    expect(sims.length).toBeGreaterThanOrEqual(2);
  });

  it("returns undefined for unknown simulation ID", () => {
    expect(engine.findSimulationById("sim-unknown")).toBeUndefined();
  });

  it("simulation summary includes effect count", () => {
    const change: HypotheticalChange = { kind: "custom", description: "Summary test", params: {} };
    const sim = engine.simulate("Summary Test", change);
    expect(sim.summary).toContain("predicted effect");
  });
});
