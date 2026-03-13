/**
 * WorldStateStore
 *
 * The canonical, append-only record of everything the system knows about the world.
 * Every write is provenance-stamped: it records which signal caused the change,
 * which processing record justified it, and when it happened.
 *
 * Design principles:
 *   - Append-only: mutations are never deleted, only superseded
 *   - Provenance-first: every record traces back to a source signal
 *   - Contradiction-aware: conflicting state is flagged, not silently overwritten
 *   - Queryable: supports reading current state, history, and pending obligations
 *
 * Storage layout (all under storageDir):
 *   obligations.json     — all obligation records
 *   state_updates.json   — all entity field updates
 *   contradictions.json  — all detected contradictions
 *   audit_log.json       — full ordered mutation history
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ObligationStatus = "open" | "fulfilled" | "overdue" | "cancelled" | "disputed";
export type PriorityLevel = "critical" | "high" | "medium" | "low";

export interface Obligation {
  id: string;
  title: string;
  description: string;
  owed_by: string;
  owed_to: string;
  workspace_hint?: string;
  priority: PriorityLevel;
  status: ObligationStatus;
  due_hint?: string;
  /** The signal that created this obligation */
  source_signal_id: string;
  /** The processing record that justified this obligation */
  source_processing_id: string;
  /** The raw fact from Layer 4 that established this obligation */
  source_fact: string;
  created_at: string;
  last_updated_at: string;
  /** Full history of status changes */
  history: Array<{
    status: ObligationStatus;
    changed_at: string;
    reason: string;
    source_signal_id: string;
  }>;
}

export interface StateUpdate {
  id: string;
  /** The canonical entity ID being updated */
  entity_id: string;
  entity_label: string;
  entity_domain: string;
  /** The field that changed */
  field: string;
  previous_value?: string;
  new_value: string;
  /** The raw fact that justified this update */
  source_fact: string;
  source_signal_id: string;
  source_processing_id: string;
  applied_at: string;
}

export interface Contradiction {
  id: string;
  description: string;
  entity_label: string;
  entity_domain: string;
  field?: string;
  existing_value?: string;
  incoming_value?: string;
  source_signal_id: string;
  source_processing_id: string;
  detected_at: string;
  resolved: boolean;
  resolution_note?: string;
}

export interface AuditEntry {
  id: string;
  event_type: "obligation_created" | "obligation_updated" | "state_updated" | "contradiction_detected" | "action_proposed";
  record_id: string;
  summary: string;
  source_signal_id: string;
  source_processing_id: string;
  timestamp: string;
}

// ─── WorldStateStore ──────────────────────────────────────────────────────────

export interface WorldStateStoreOptions {
  storageDir: string;
}

export class WorldStateStore {
  private readonly storageDir: string;
  private obligations: Map<string, Obligation>;
  private stateUpdates: StateUpdate[];
  private contradictions: Map<string, Contradiction>;
  private auditLog: AuditEntry[];

  constructor(options: WorldStateStoreOptions) {
    this.storageDir = options.storageDir;
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.obligations = new Map();
    this.stateUpdates = [];
    this.contradictions = new Map();
    this.auditLog = [];
    this.load();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private load(): void {
    const obligationsPath = path.join(this.storageDir, "obligations.json");
    const stateUpdatesPath = path.join(this.storageDir, "state_updates.json");
    const contradictionsPath = path.join(this.storageDir, "contradictions.json");
    const auditLogPath = path.join(this.storageDir, "audit_log.json");

    if (fs.existsSync(obligationsPath)) {
      const records: Obligation[] = JSON.parse(fs.readFileSync(obligationsPath, "utf8"));
      for (const r of records) this.obligations.set(r.id, r);
    }
    if (fs.existsSync(stateUpdatesPath)) {
      this.stateUpdates = JSON.parse(fs.readFileSync(stateUpdatesPath, "utf8"));
    }
    if (fs.existsSync(contradictionsPath)) {
      const records: Contradiction[] = JSON.parse(fs.readFileSync(contradictionsPath, "utf8"));
      for (const r of records) this.contradictions.set(r.id, r);
    }
    if (fs.existsSync(auditLogPath)) {
      this.auditLog = JSON.parse(fs.readFileSync(auditLogPath, "utf8"));
    }
  }

  private flush(): void {
    fs.writeFileSync(
      path.join(this.storageDir, "obligations.json"),
      JSON.stringify([...this.obligations.values()], null, 2)
    );
    fs.writeFileSync(
      path.join(this.storageDir, "state_updates.json"),
      JSON.stringify(this.stateUpdates, null, 2)
    );
    fs.writeFileSync(
      path.join(this.storageDir, "contradictions.json"),
      JSON.stringify([...this.contradictions.values()], null, 2)
    );
    fs.writeFileSync(
      path.join(this.storageDir, "audit_log.json"),
      JSON.stringify(this.auditLog, null, 2)
    );
  }

  private audit(entry: Omit<AuditEntry, "id" | "timestamp">): void {
    const record: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLog.push(record);
  }

  // ── Obligations ──────────────────────────────────────────────────────────────

  createObligation(
    data: Omit<Obligation, "id" | "status" | "created_at" | "last_updated_at" | "history">
  ): Obligation {
    const now = new Date().toISOString();
    const obligation: Obligation = {
      id: randomUUID(),
      status: "open",
      created_at: now,
      last_updated_at: now,
      history: [],
      ...data,
    };
    this.obligations.set(obligation.id, obligation);
    this.audit({
      event_type: "obligation_created",
      record_id: obligation.id,
      summary: `Obligation created: "${obligation.title}" — ${obligation.owed_by} owes ${obligation.owed_to}`,
      source_signal_id: data.source_signal_id,
      source_processing_id: data.source_processing_id,
    });
    this.flush();
    return obligation;
  }

  updateObligationStatus(
    id: string,
    status: ObligationStatus,
    reason: string,
    sourceSignalId: string
  ): Obligation {
    const obligation = this.obligations.get(id);
    if (!obligation) throw new Error(`WorldStateStore: Obligation not found: "${id}"`);

    obligation.history.push({
      status: obligation.status,
      changed_at: new Date().toISOString(),
      reason,
      source_signal_id: sourceSignalId,
    });
    obligation.status = status;
    obligation.last_updated_at = new Date().toISOString();
    this.obligations.set(id, obligation);
    this.audit({
      event_type: "obligation_updated",
      record_id: id,
      summary: `Obligation "${obligation.title}" status → ${status}: ${reason}`,
      source_signal_id: sourceSignalId,
      source_processing_id: obligation.source_processing_id,
    });
    this.flush();
    return obligation;
  }

  getObligation(id: string): Obligation | undefined {
    return this.obligations.get(id);
  }

  getOpenObligations(): Obligation[] {
    return [...this.obligations.values()].filter((o) => o.status === "open");
  }

  getAllObligations(): Obligation[] {
    return [...this.obligations.values()];
  }

  findObligationsByEntity(entityLabel: string): Obligation[] {
    const label = entityLabel.toLowerCase();
    return [...this.obligations.values()].filter(
      (o) =>
        o.owed_by.toLowerCase().includes(label) ||
        o.owed_to.toLowerCase().includes(label)
    );
  }

  // ── State Updates ────────────────────────────────────────────────────────────

  applyStateUpdate(
    data: Omit<StateUpdate, "id" | "applied_at">
  ): StateUpdate {
    const update: StateUpdate = {
      id: randomUUID(),
      applied_at: new Date().toISOString(),
      ...data,
    };
    this.stateUpdates.push(update);
    this.audit({
      event_type: "state_updated",
      record_id: update.id,
      summary: `State update: ${update.entity_label}.${update.field} → "${update.new_value}"`,
      source_signal_id: data.source_signal_id,
      source_processing_id: data.source_processing_id,
    });
    this.flush();
    return update;
  }

  getStateUpdatesForEntity(entityLabel: string): StateUpdate[] {
    return this.stateUpdates.filter(
      (u) => u.entity_label.toLowerCase() === entityLabel.toLowerCase()
    );
  }

  /** Returns the most recent value of a field for an entity, or undefined if never set. */
  getCurrentFieldValue(entityLabel: string, field: string): string | undefined {
    const updates = this.stateUpdates
      .filter(
        (u) =>
          u.entity_label.toLowerCase() === entityLabel.toLowerCase() &&
          u.field.toLowerCase() === field.toLowerCase()
      )
      .sort((a, b) => b.applied_at.localeCompare(a.applied_at));
    return updates[0]?.new_value;
  }

  // ── Contradictions ───────────────────────────────────────────────────────────

  recordContradiction(
    data: Omit<Contradiction, "id" | "detected_at" | "resolved">
  ): Contradiction {
    const contradiction: Contradiction = {
      id: randomUUID(),
      detected_at: new Date().toISOString(),
      resolved: false,
      ...data,
    };
    this.contradictions.set(contradiction.id, contradiction);
    this.audit({
      event_type: "contradiction_detected",
      record_id: contradiction.id,
      summary: `Contradiction detected: ${contradiction.entity_label} — ${contradiction.description}`,
      source_signal_id: data.source_signal_id,
      source_processing_id: data.source_processing_id,
    });
    this.flush();
    return contradiction;
  }

  resolveContradiction(id: string, resolutionNote: string): Contradiction {
    const contradiction = this.contradictions.get(id);
    if (!contradiction) throw new Error(`WorldStateStore: Contradiction not found: "${id}"`);
    contradiction.resolved = true;
    contradiction.resolution_note = resolutionNote;
    this.contradictions.set(id, contradiction);
    this.flush();
    return contradiction;
  }

  getUnresolvedContradictions(): Contradiction[] {
    return [...this.contradictions.values()].filter((c) => !c.resolved);
  }

  // ── Audit Log ────────────────────────────────────────────────────────────────

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  getAuditLogForSignal(signalId: string): AuditEntry[] {
    return this.auditLog.filter((e) => e.source_signal_id === signalId);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  getSummary(): {
    open_obligations: number;
    total_obligations: number;
    state_updates: number;
    unresolved_contradictions: number;
    audit_entries: number;
  } {
    return {
      open_obligations: this.getOpenObligations().length,
      total_obligations: this.obligations.size,
      state_updates: this.stateUpdates.length,
      unresolved_contradictions: this.getUnresolvedContradictions().length,
      audit_entries: this.auditLog.length,
    };
  }
}
