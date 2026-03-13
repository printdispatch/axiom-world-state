/**
 * Phase 13: System Health Monitor Tests
 *
 * Tests the HealthMonitor's ability to collect metrics, generate alerts,
 * and compute overall system health status.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HealthMonitor } from "../../src/health/health_monitor.js";

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

describe("Phase 13 — HealthMonitor", () => {
  let tmpDir: string;
  let monitor: HealthMonitor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-health-test-"));
    monitor = new HealthMonitor({ dataDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Metrics Collection ─────────────────────────────────────────────────────

  it("returns zero metrics for empty data directory", () => {
    const metrics = monitor.collectMetrics();
    expect(metrics.signals_processed).toBe(0);
    expect(metrics.unprocessed_signals).toBe(0);
    expect(metrics.contradictions).toBe(0);
    expect(metrics.review_backlog).toBe(0);
    expect(metrics.automation_failures).toBe(0);
    expect(metrics.entity_count).toBe(0);
    expect(metrics.workspace_count).toBe(0);
    expect(metrics.open_obligations).toBe(0);
    expect(metrics.overdue_obligations).toBe(0);
    expect(metrics.health_score).toBe(100);
    expect(metrics.collected_at).toBeTruthy();
  });

  it("counts processed and unprocessed signals correctly", () => {
    writeJson(path.join(tmpDir, "signals", "signal_log.json"), [
      { id: "s1", processed: true },
      { id: "s2", processed: true },
      { id: "s3", processed: false },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.signals_processed).toBe(2);
    expect(metrics.unprocessed_signals).toBe(1);
  });

  it("counts active contradictions (excludes resolved)", () => {
    writeJson(path.join(tmpDir, "state", "contradictions.json"), [
      { id: "c1", resolved: false },
      { id: "c2", resolved: false },
      { id: "c3", resolved: true },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.contradictions).toBe(2);
  });

  it("counts review backlog (pending items only)", () => {
    writeJson(path.join(tmpDir, "review", "review_queue.json"), [
      { id: "r1", status: "pending", severity: "high" },
      { id: "r2", status: "pending", severity: "medium" },
      { id: "r3", status: "resolved" },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.review_backlog).toBe(2);
  });

  it("counts automation failures", () => {
    writeJson(path.join(tmpDir, "recipes", "runs.json"), [
      { id: "run-1", status: "completed" },
      { id: "run-2", status: "failed" },
      { id: "run-3", status: "failed" },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.automation_failures).toBe(2);
  });

  it("counts active entities (excludes superseded)", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "e1", canonical_name: "Alice" },
      { id: "e2", canonical_name: "Bob", superseded_by: "e1" },
      { id: "e3", canonical_name: "Corp" },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.entity_count).toBe(2);
  });

  it("counts workspaces", () => {
    writeJson(path.join(tmpDir, "workspaces", "workspaces.json"), [
      { id: "ws-1", status: "active" },
      { id: "ws-2", status: "active" },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.workspace_count).toBe(2);
  });

  it("counts open and overdue obligations", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(path.join(tmpDir, "state", "obligations.json"), [
      makeObligation({ status: "open", due_date: pastDate }),
      makeObligation({ status: "open", due_date: futureDate }),
      makeObligation({ status: "resolved" }),
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.open_obligations).toBe(2);
    expect(metrics.overdue_obligations).toBe(1);
  });

  it("computes health score with all deductions", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(path.join(tmpDir, "state", "obligations.json"), [
      makeObligation({ status: "open", due_date: pastDate }), // -10
    ]);
    writeJson(path.join(tmpDir, "state", "contradictions.json"), [
      { id: "c1", resolved: false }, // -7
    ]);
    writeJson(path.join(tmpDir, "review", "review_queue.json"), [
      { id: "r1", status: "pending" }, // -3
    ]);
    writeJson(path.join(tmpDir, "recipes", "runs.json"), [
      { id: "run-1", status: "failed" }, // -5
    ]);
    const metrics = monitor.collectMetrics();
    // 100 - 10 - 7 - 3 - 5 = 75
    expect(metrics.health_score).toBe(75);
  });

  it("health score is capped at 100 and floored at 0", () => {
    const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const obligations = Array.from({ length: 10 }, () =>
      makeObligation({ status: "open", due_date: pastDate })
    );
    writeJson(path.join(tmpDir, "state", "obligations.json"), obligations);
    const metrics = monitor.collectMetrics();
    expect(metrics.health_score).toBeGreaterThanOrEqual(0);
    expect(metrics.health_score).toBeLessThanOrEqual(100);
  });

  it("groups review items by severity", () => {
    writeJson(path.join(tmpDir, "review", "review_queue.json"), [
      { id: "r1", status: "pending", severity: "critical" },
      { id: "r2", status: "pending", severity: "high" },
      { id: "r3", status: "pending", severity: "high" },
      { id: "r4", status: "resolved", severity: "medium" },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.review_by_severity.critical).toBe(1);
    expect(metrics.review_by_severity.high).toBe(2);
    expect(metrics.review_by_severity.medium).toBeUndefined();
  });

  it("groups open obligations by priority", () => {
    writeJson(path.join(tmpDir, "state", "obligations.json"), [
      makeObligation({ status: "open", priority: "high" }),
      makeObligation({ status: "open", priority: "high" }),
      makeObligation({ status: "open", priority: "medium" }),
      makeObligation({ status: "resolved", priority: "low" }),
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.obligations_by_priority.high).toBe(2);
    expect(metrics.obligations_by_priority.medium).toBe(1);
    expect(metrics.obligations_by_priority.low).toBeUndefined();
  });

  it("includes automation summary", () => {
    writeJson(path.join(tmpDir, "recipes", "runs.json"), [
      { id: "r1", status: "completed" },
      { id: "r2", status: "completed" },
      { id: "r3", status: "failed" },
      { id: "r4", status: "pending_approval" },
    ]);
    const metrics = monitor.collectMetrics();
    expect(metrics.automation_summary.total_runs).toBe(4);
    expect(metrics.automation_summary.completed).toBe(2);
    expect(metrics.automation_summary.failed).toBe(1);
    expect(metrics.automation_summary.pending_approval).toBe(1);
  });

  // ── Alert Generation ───────────────────────────────────────────────────────

  it("generates no alerts for healthy system", () => {
    const metrics = monitor.collectMetrics();
    const alerts = monitor.generateAlerts(metrics);
    expect(alerts).toHaveLength(0);
  });

  it("generates warning alert for 1 overdue obligation", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(path.join(tmpDir, "state", "obligations.json"), [
      makeObligation({ status: "open", due_date: pastDate }),
    ]);
    const metrics = monitor.collectMetrics();
    const alerts = monitor.generateAlerts(metrics);
    const alert = alerts.find((a) => a.code === "OVERDUE_OBLIGATIONS");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
  });

  it("generates critical alert for 3+ overdue obligations", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(path.join(tmpDir, "state", "obligations.json"), [
      makeObligation({ status: "open", due_date: pastDate }),
      makeObligation({ status: "open", due_date: pastDate }),
      makeObligation({ status: "open", due_date: pastDate }),
    ]);
    const metrics = monitor.collectMetrics();
    const alerts = monitor.generateAlerts(metrics);
    const alert = alerts.find((a) => a.code === "OVERDUE_OBLIGATIONS_HIGH");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("critical");
  });

  it("generates warning alert for active contradictions", () => {
    writeJson(path.join(tmpDir, "state", "contradictions.json"), [
      { id: "c1", resolved: false },
    ]);
    const metrics = monitor.collectMetrics();
    const alerts = monitor.generateAlerts(metrics);
    const alert = alerts.find((a) => a.code === "CONTRADICTIONS_ACTIVE");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
  });

  it("generates warning alert for automation failures", () => {
    writeJson(path.join(tmpDir, "recipes", "runs.json"), [
      { id: "r1", status: "failed" },
    ]);
    const metrics = monitor.collectMetrics();
    const alerts = monitor.generateAlerts(metrics);
    const alert = alerts.find((a) => a.code === "AUTOMATION_FAILURES");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
  });

  it("generates warning alert for large review backlog", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`, status: "pending", severity: "medium",
    }));
    writeJson(path.join(tmpDir, "review", "review_queue.json"), items);
    const metrics = monitor.collectMetrics();
    const alerts = monitor.generateAlerts(metrics);
    const alert = alerts.find((a) => a.code === "REVIEW_BACKLOG");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
  });

  it("generates warning alert for unprocessed signals", () => {
    const signals = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, processed: false }));
    writeJson(path.join(tmpDir, "signals", "signal_log.json"), signals);
    const metrics = monitor.collectMetrics();
    const alerts = monitor.generateAlerts(metrics);
    const alert = alerts.find((a) => a.code === "UNPROCESSED_SIGNALS");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
  });

  // ── Status Computation ─────────────────────────────────────────────────────

  it("returns healthy status for clean system", () => {
    const status = monitor.getStatus();
    expect(status.status).toBe("healthy");
    expect(status.metrics.health_score).toBe(100);
    expect(status.alerts).toHaveLength(0);
    expect(status.message).toContain("normally");
  });

  it("returns degraded status when there are warnings", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    writeJson(path.join(tmpDir, "state", "obligations.json"), [
      makeObligation({ status: "open", due_date: pastDate }),
    ]);
    const status = monitor.getStatus();
    expect(status.status).toBe("degraded");
    expect(status.message).toContain("degraded");
  });

  it("returns critical status when health score is below 60", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const obligations = Array.from({ length: 5 }, () =>
      makeObligation({ status: "open", due_date: pastDate })
    );
    writeJson(path.join(tmpDir, "state", "obligations.json"), obligations);
    const contradictions = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, resolved: false }));
    writeJson(path.join(tmpDir, "state", "contradictions.json"), contradictions);
    const status = monitor.getStatus();
    expect(status.status).toBe("critical");
    expect(status.message).toContain("critical");
  });

  it("status includes full metrics and alerts", () => {
    const status = monitor.getStatus();
    expect(status.metrics).toBeDefined();
    expect(status.alerts).toBeDefined();
    expect(Array.isArray(status.alerts)).toBe(true);
  });
});
