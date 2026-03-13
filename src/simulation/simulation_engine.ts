/**
 * SimulationEngine
 *
 * Forecasts the downstream effects of hypothetical world state changes.
 *
 * Architecture:
 * - Takes a snapshot of the current world state
 * - Applies a hypothetical change to the snapshot
 * - Computes predicted downstream effects using rule-based inference
 * - Returns a complete Simulation record with confidence-weighted predictions
 *
 * This engine is intentionally rule-based (not LLM-powered) for speed and
 * determinism. LLM-powered deep analysis can be added as a future enhancement.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Simulation,
  HypotheticalChange,
  PredictedEffect,
  WorldStateSnapshot,
} from "../../schema/simulation.js";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");
const DEFAULT_STORAGE_DIR = path.resolve(process.cwd(), "data", "simulations");

export interface SimulationEngineOptions {
  dataDir?: string;
  storageDir?: string;
}

export class SimulationEngine {
  private dataDir: string;
  private storageDir: string;

  constructor(opts: SimulationEngineOptions = {}) {
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
    this.storageDir = opts.storageDir ?? DEFAULT_STORAGE_DIR;
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────────

  /** Capture a snapshot of the current world state. */
  captureSnapshot(): WorldStateSnapshot {
    const readJson = <T>(filePath: string, fallback: T): T => {
      try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
      } catch {
        return fallback;
      }
    };

    const obligations = readJson<Array<{
      id: string; title: string; status: string; priority: string;
      due_date?: string; owed_by: string; owed_to: string;
    }>>(path.join(this.dataDir, "state", "obligations.json"), []);

    const contradictions = readJson<Array<{ resolved: boolean }>>(
      path.join(this.dataDir, "state", "contradictions.json"), []
    );

    const entities = readJson<Array<{ id: string; canonical_name: string; domain: string }>>(
      path.join(this.dataDir, "entities", "entities.json"), []
    );

    const reviewItems = readJson<Array<{ status: string }>>(
      path.join(this.dataDir, "review", "review_queue.json"), []
    );

    const openObligations = obligations.filter((o) => o.status === "open");
    const now = new Date();
    const overdueObligations = openObligations.filter((o) => {
      if (!o.due_date) return false;
      return new Date(o.due_date) < now;
    });
    const activeContradictions = contradictions.filter((c) => !c.resolved);
    const pendingReview = reviewItems.filter((r) => r.status === "pending");

    // Compute health score (same formula as dashboard)
    const total = 100;
    const overdueDeduction = Math.min(30, overdueObligations.length * 10);
    const contradictionDeduction = Math.min(20, activeContradictions.length * 7);
    const reviewDeduction = Math.min(15, pendingReview.length * 3);
    const healthScore = Math.max(0, total - overdueDeduction - contradictionDeduction - reviewDeduction);

    return {
      captured_at: new Date().toISOString(),
      open_obligations: openObligations.length,
      overdue_obligations: overdueObligations.length,
      active_contradictions: activeContradictions.length,
      entity_count: entities.length,
      pending_review: pendingReview.length,
      health_score: healthScore,
      obligations: obligations.map((o) => ({
        id: o.id,
        title: o.title,
        status: o.status,
        priority: o.priority,
        due_date: o.due_date,
        owed_by: o.owed_by,
        owed_to: o.owed_to,
      })),
      entities: entities.map((e) => ({
        id: e.id,
        canonical_name: e.canonical_name,
        domain: e.domain,
      })),
    };
  }

  // ─── Effect Prediction ─────────────────────────────────────────────────────

  /** Predict the downstream effects of a hypothetical change. */
  predictEffects(
    snapshot: WorldStateSnapshot,
    change: HypotheticalChange
  ): PredictedEffect[] {
    const effects: PredictedEffect[] = [];

    switch (change.kind) {
      case "obligation_resolved": {
        const obligationId = change.target_id;
        const obligation = snapshot.obligations.find((o) => o.id === obligationId);

        if (obligation) {
          // Direct effect: obligation status changes
          effects.push({
            kind: "obligation_status_change",
            description: `"${obligation.title}" would be marked as resolved`,
            target_id: obligationId,
            predicted_values: { status: "resolved" },
            confidence: 1.0,
          });

          // Health score improvement
          const wasOverdue = obligation.due_date && new Date(obligation.due_date) < new Date();
          if (wasOverdue) {
            const newOverdue = Math.max(0, snapshot.overdue_obligations - 1);
            const overdueDeduction = Math.min(30, newOverdue * 10);
            const contradictionDeduction = Math.min(20, snapshot.active_contradictions * 7);
            const reviewDeduction = Math.min(15, snapshot.pending_review * 3);
            const newHealth = Math.max(0, 100 - overdueDeduction - contradictionDeduction - reviewDeduction);
            effects.push({
              kind: "health_score_change",
              description: `System health score would improve from ${snapshot.health_score} to ${newHealth}`,
              predicted_values: {
                old_score: snapshot.health_score,
                new_score: newHealth,
                delta: newHealth - snapshot.health_score,
              },
              confidence: 0.95,
            });
          }
        }
        break;
      }

      case "obligation_created": {
        const title = change.params.title as string ?? "New obligation";
        const priority = change.params.priority as string ?? "medium";
        const dueDate = change.params.due_date as string | undefined;

        effects.push({
          kind: "new_obligation",
          description: `New obligation "${title}" would be added to the system`,
          predicted_values: { title, priority, status: "open" },
          confidence: 1.0,
        });

        // If high priority, likely to affect review queue
        if (priority === "high" || priority === "critical") {
          effects.push({
            kind: "review_queue_change",
            description: "High-priority obligation may trigger review queue entry",
            predicted_values: { review_items_added: 1 },
            confidence: 0.7,
          });
        }

        // If due date is soon, health score may be affected
        if (dueDate) {
          const daysUntilDue = (new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          if (daysUntilDue < 7) {
            effects.push({
              kind: "health_score_change",
              description: `Obligation due in ${Math.ceil(daysUntilDue)} days — health score at risk if not resolved`,
              predicted_values: {
                risk_window_days: Math.ceil(daysUntilDue),
                potential_health_impact: -10,
              },
              confidence: 0.8,
            });
          }
        }
        break;
      }

      case "contradiction_resolved": {
        const newContradictions = Math.max(0, snapshot.active_contradictions - 1);
        const overdueDeduction = Math.min(30, snapshot.overdue_obligations * 10);
        const contradictionDeduction = Math.min(20, newContradictions * 7);
        const reviewDeduction = Math.min(15, snapshot.pending_review * 3);
        const newHealth = Math.max(0, 100 - overdueDeduction - contradictionDeduction - reviewDeduction);

        effects.push({
          kind: "contradiction_resolved",
          description: `Active contradictions would decrease from ${snapshot.active_contradictions} to ${newContradictions}`,
          target_id: change.target_id,
          predicted_values: {
            old_count: snapshot.active_contradictions,
            new_count: newContradictions,
          },
          confidence: 1.0,
        });

        if (newHealth !== snapshot.health_score) {
          effects.push({
            kind: "health_score_change",
            description: `System health score would improve from ${snapshot.health_score} to ${newHealth}`,
            predicted_values: {
              old_score: snapshot.health_score,
              new_score: newHealth,
              delta: newHealth - snapshot.health_score,
            },
            confidence: 0.95,
          });
        }
        break;
      }

      case "entity_attribute_change": {
        const entityId = change.target_id;
        const entity = snapshot.entities.find((e) => e.id === entityId);
        if (entity) {
          effects.push({
            kind: "entity_attribute_update",
            description: `Entity "${entity.canonical_name}" attributes would be updated`,
            target_id: entityId,
            predicted_values: change.params,
            confidence: 0.9,
          });
        }
        break;
      }

      case "signal_received": {
        // Simulate receiving a new signal
        effects.push({
          kind: "new_obligation",
          description: "New signal may create obligations based on content",
          predicted_values: {
            potential_obligations: 1,
            potential_entities: 2,
          },
          confidence: 0.6,
        });

        if (change.params.source === "gmail") {
          effects.push({
            kind: "entity_attribute_update",
            description: "Gmail signal may update entity contact information",
            predicted_values: { entities_updated: 1 },
            confidence: 0.5,
          });
        }
        break;
      }

      case "custom": {
        effects.push({
          kind: "health_score_change",
          description: "Custom change — effects are speculative",
          predicted_values: { note: change.description },
          confidence: 0.3,
        });
        break;
      }
    }

    return effects;
  }

  // ─── Run Simulation ────────────────────────────────────────────────────────

  /** Run a simulation and persist the result. */
  simulate(name: string, change: HypotheticalChange): Simulation {
    const snapshot = this.captureSnapshot();
    const effects = this.predictEffects(snapshot, change);

    const highConfidenceEffects = effects.filter((e) => e.confidence >= 0.8);
    const summary = this.buildSummary(change, effects, snapshot);

    const simulation: Simulation = {
      id: `sim-${crypto.randomUUID().slice(0, 8)}`,
      name,
      change,
      status: "completed",
      baseline_snapshot: snapshot,
      predicted_effects: effects,
      summary,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };

    this.persistSimulation(simulation);
    return simulation;
  }

  private buildSummary(
    change: HypotheticalChange,
    effects: PredictedEffect[],
    snapshot: WorldStateSnapshot
  ): string {
    const healthEffect = effects.find((e) => e.kind === "health_score_change");
    const highConfidence = effects.filter((e) => e.confidence >= 0.8).length;

    let summary = `Simulating: ${change.description}. `;
    summary += `${effects.length} predicted effect${effects.length !== 1 ? "s" : ""} (${highConfidence} high-confidence). `;

    if (healthEffect) {
      const delta = healthEffect.predicted_values.delta as number;
      if (delta > 0) {
        summary += `Health score would improve by ${delta} points (${snapshot.health_score} → ${healthEffect.predicted_values.new_score}).`;
      } else if (delta < 0) {
        summary += `Health score would decrease by ${Math.abs(delta)} points (${snapshot.health_score} → ${healthEffect.predicted_values.new_score}).`;
      }
    }

    return summary.trim();
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  private persistSimulation(simulation: Simulation): void {
    const simPath = path.join(this.storageDir, `${simulation.id}.json`);
    fs.writeFileSync(simPath, JSON.stringify(simulation, null, 2));
  }

  /** List all simulations, newest first. */
  listSimulations(): Simulation[] {
    if (!fs.existsSync(this.storageDir)) return [];
    const files = fs.readdirSync(this.storageDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    return files.map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(this.storageDir, f), "utf8")) as Simulation;
      } catch {
        return null;
      }
    }).filter(Boolean) as Simulation[];
  }

  /** Find a simulation by ID. */
  findSimulationById(id: string): Simulation | undefined {
    const simPath = path.join(this.storageDir, `${id}.json`);
    if (!fs.existsSync(simPath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(simPath, "utf8")) as Simulation;
    } catch {
      return undefined;
    }
  }
}
