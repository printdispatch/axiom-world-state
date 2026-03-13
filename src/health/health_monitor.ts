/**
 * HealthMonitor
 *
 * Collects and reports operational observability metrics for the Axiom system.
 *
 * Metrics tracked:
 * - signals_processed: Total signals that have been processed
 * - unprocessed_signals: Signals received but not yet processed
 * - merge_candidates: Entities flagged as potential duplicates
 * - contradictions: Active unresolved contradictions
 * - review_backlog: Items in the review queue awaiting decision
 * - automation_failures: Recipe runs that failed
 * - entity_count: Total entities in the system
 * - workspace_count: Total workspaces
 * - open_obligations: Open obligations
 * - overdue_obligations: Overdue obligations
 * - health_score: Computed 0–100 system health score
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");

export interface HealthMetrics {
  /** ISO timestamp when metrics were collected. */
  collected_at: string;
  /** Total signals that have been fully processed. */
  signals_processed: number;
  /** Signals received but not yet processed. */
  unprocessed_signals: number;
  /** Entities flagged as potential duplicates awaiting merge decision. */
  merge_candidates: number;
  /** Active unresolved contradictions in the system. */
  contradictions: number;
  /** Items in the review queue awaiting a human decision. */
  review_backlog: number;
  /** Recipe runs that ended in a failed state. */
  automation_failures: number;
  /** Total entities in the system. */
  entity_count: number;
  /** Total workspaces. */
  workspace_count: number;
  /** Open (unresolved) obligations. */
  open_obligations: number;
  /** Overdue obligations (past due date, still open). */
  overdue_obligations: number;
  /** Computed system health score (0–100). */
  health_score: number;
  /** Breakdown of review items by severity. */
  review_by_severity: Record<string, number>;
  /** Breakdown of obligations by priority. */
  obligations_by_priority: Record<string, number>;
  /** Recent automation activity summary. */
  automation_summary: {
    total_runs: number;
    completed: number;
    failed: number;
    pending_approval: number;
  };
}

export interface HealthStatus {
  /** Overall status: healthy | degraded | critical */
  status: "healthy" | "degraded" | "critical";
  /** Human-readable status message. */
  message: string;
  /** The full metrics snapshot. */
  metrics: HealthMetrics;
  /** List of active alerts. */
  alerts: HealthAlert[];
}

export interface HealthAlert {
  /** Alert severity. */
  severity: "info" | "warning" | "critical";
  /** Alert code for programmatic handling. */
  code: string;
  /** Human-readable alert message. */
  message: string;
  /** The metric value that triggered this alert. */
  value: number;
  /** The threshold that was exceeded. */
  threshold: number;
}

export interface HealthMonitorOptions {
  dataDir?: string;
}

export class HealthMonitor {
  private dataDir: string;

  constructor(opts: HealthMonitorOptions = {}) {
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  }

  // ─── Data Reading ──────────────────────────────────────────────────────────

  private readJson<T>(filePath: string, fallback: T): T {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  // ─── Metrics Collection ────────────────────────────────────────────────────

  /** Collect all system health metrics. */
  collectMetrics(): HealthMetrics {
    const signals = this.readJson<Array<{ processed: boolean }>>(
      path.join(this.dataDir, "signals", "signal_log.json"), []
    );

    const entities = this.readJson<Array<{ superseded_by?: string }>>(
      path.join(this.dataDir, "entities", "entities.json"), []
    );

    const obligations = this.readJson<Array<{ status: string; priority: string; due_date?: string }>>(
      path.join(this.dataDir, "state", "obligations.json"), []
    );

    const contradictions = this.readJson<Array<{ resolved: boolean }>>(
      path.join(this.dataDir, "state", "contradictions.json"), []
    );

    const reviewItems = this.readJson<Array<{ status: string; severity?: string }>>(
      path.join(this.dataDir, "review", "review_queue.json"), []
    );

    const workspaces = this.readJson<Array<{ status: string }>>(
      path.join(this.dataDir, "workspaces", "workspaces.json"), []
    );

    const recipeRuns = this.readJson<Array<{ status: string }>>(
      path.join(this.dataDir, "recipes", "runs.json"), []
    );

    // Signal metrics
    const signalsProcessed = signals.filter((s) => s.processed).length;
    const unprocessedSignals = signals.filter((s) => !s.processed).length;

    // Entity metrics
    const activeEntities = entities.filter((e) => !e.superseded_by);
    const mergeCandidates = reviewItems.filter(
      (r) => r.status === "pending" && (r as Record<string, unknown>).reason &&
        String((r as Record<string, unknown>).reason).toLowerCase().includes("similar")
    ).length;

    // Obligation metrics
    const now = new Date();
    const openObligations = obligations.filter((o) => o.status === "open");
    const overdueObligations = openObligations.filter(
      (o) => o.due_date && new Date(o.due_date) < now
    );

    const obligationsByPriority: Record<string, number> = {};
    for (const ob of openObligations) {
      const p = ob.priority ?? "unknown";
      obligationsByPriority[p] = (obligationsByPriority[p] ?? 0) + 1;
    }

    // Contradiction metrics
    const activeContradictions = contradictions.filter((c) => !c.resolved).length;

    // Review metrics
    const reviewBacklog = reviewItems.filter((r) => r.status === "pending").length;
    const reviewBySeverity: Record<string, number> = {};
    for (const item of reviewItems.filter((r) => r.status === "pending")) {
      const sev = item.severity ?? "medium";
      reviewBySeverity[sev] = (reviewBySeverity[sev] ?? 0) + 1;
    }

    // Automation metrics
    const automationFailures = recipeRuns.filter((r) => r.status === "failed").length;
    const automationSummary = {
      total_runs: recipeRuns.length,
      completed: recipeRuns.filter((r) => r.status === "completed").length,
      failed: automationFailures,
      pending_approval: recipeRuns.filter((r) => r.status === "pending_approval").length,
    };

    // Health score computation
    const overdueDeduction = Math.min(30, overdueObligations.length * 10);
    const contradictionDeduction = Math.min(20, activeContradictions * 7);
    const reviewDeduction = Math.min(15, reviewBacklog * 3);
    const failureDeduction = Math.min(10, automationFailures * 5);
    const healthScore = Math.max(
      0,
      100 - overdueDeduction - contradictionDeduction - reviewDeduction - failureDeduction
    );

    return {
      collected_at: new Date().toISOString(),
      signals_processed: signalsProcessed,
      unprocessed_signals: unprocessedSignals,
      merge_candidates: mergeCandidates,
      contradictions: activeContradictions,
      review_backlog: reviewBacklog,
      automation_failures: automationFailures,
      entity_count: activeEntities.length,
      workspace_count: workspaces.length,
      open_obligations: openObligations.length,
      overdue_obligations: overdueObligations.length,
      health_score: healthScore,
      review_by_severity: reviewBySeverity,
      obligations_by_priority: obligationsByPriority,
      automation_summary: automationSummary,
    };
  }

  // ─── Alert Generation ──────────────────────────────────────────────────────

  /** Generate alerts based on current metrics. */
  generateAlerts(metrics: HealthMetrics): HealthAlert[] {
    const alerts: HealthAlert[] = [];

    if (metrics.overdue_obligations >= 3) {
      alerts.push({
        severity: "critical",
        code: "OVERDUE_OBLIGATIONS_HIGH",
        message: `${metrics.overdue_obligations} obligations are overdue`,
        value: metrics.overdue_obligations,
        threshold: 3,
      });
    } else if (metrics.overdue_obligations >= 1) {
      alerts.push({
        severity: "warning",
        code: "OVERDUE_OBLIGATIONS",
        message: `${metrics.overdue_obligations} obligation${metrics.overdue_obligations > 1 ? "s are" : " is"} overdue`,
        value: metrics.overdue_obligations,
        threshold: 1,
      });
    }

    if (metrics.contradictions >= 3) {
      alerts.push({
        severity: "critical",
        code: "CONTRADICTIONS_HIGH",
        message: `${metrics.contradictions} active contradictions require resolution`,
        value: metrics.contradictions,
        threshold: 3,
      });
    } else if (metrics.contradictions >= 1) {
      alerts.push({
        severity: "warning",
        code: "CONTRADICTIONS_ACTIVE",
        message: `${metrics.contradictions} active contradiction${metrics.contradictions > 1 ? "s" : ""} detected`,
        value: metrics.contradictions,
        threshold: 1,
      });
    }

    if (metrics.review_backlog >= 10) {
      alerts.push({
        severity: "critical",
        code: "REVIEW_BACKLOG_HIGH",
        message: `Review queue has ${metrics.review_backlog} pending items`,
        value: metrics.review_backlog,
        threshold: 10,
      });
    } else if (metrics.review_backlog >= 5) {
      alerts.push({
        severity: "warning",
        code: "REVIEW_BACKLOG",
        message: `Review queue has ${metrics.review_backlog} pending items`,
        value: metrics.review_backlog,
        threshold: 5,
      });
    }

    if (metrics.automation_failures >= 3) {
      alerts.push({
        severity: "critical",
        code: "AUTOMATION_FAILURES_HIGH",
        message: `${metrics.automation_failures} automation recipe runs have failed`,
        value: metrics.automation_failures,
        threshold: 3,
      });
    } else if (metrics.automation_failures >= 1) {
      alerts.push({
        severity: "warning",
        code: "AUTOMATION_FAILURES",
        message: `${metrics.automation_failures} automation recipe run${metrics.automation_failures > 1 ? "s have" : " has"} failed`,
        value: metrics.automation_failures,
        threshold: 1,
      });
    }

    if (metrics.unprocessed_signals >= 5) {
      alerts.push({
        severity: "warning",
        code: "UNPROCESSED_SIGNALS",
        message: `${metrics.unprocessed_signals} signals are awaiting processing`,
        value: metrics.unprocessed_signals,
        threshold: 5,
      });
    }

    if (metrics.merge_candidates >= 3) {
      alerts.push({
        severity: "info",
        code: "MERGE_CANDIDATES",
        message: `${metrics.merge_candidates} entity merge candidates need review`,
        value: metrics.merge_candidates,
        threshold: 3,
      });
    }

    return alerts;
  }

  // ─── Status Computation ────────────────────────────────────────────────────

  /** Get the full health status including metrics and alerts. */
  getStatus(): HealthStatus {
    const metrics = this.collectMetrics();
    const alerts = this.generateAlerts(metrics);

    const hasCritical = alerts.some((a) => a.severity === "critical");
    const hasWarning = alerts.some((a) => a.severity === "warning");

    let status: HealthStatus["status"];
    let message: string;

    if (hasCritical || metrics.health_score < 60) {
      status = "critical";
      message = `System is in a critical state (score: ${metrics.health_score}/100). Immediate attention required.`;
    } else if (hasWarning || metrics.health_score < 80) {
      status = "degraded";
      message = `System is degraded (score: ${metrics.health_score}/100). Review active alerts.`;
    } else {
      status = "healthy";
      message = `System is operating normally (score: ${metrics.health_score}/100).`;
    }

    return { status, message, metrics, alerts };
  }
}
