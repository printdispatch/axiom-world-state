/**
 * Phase 4 Integration Tests — State Mutation Engine
 *
 * Covers:
 *   - WorldStateStore: obligations CRUD, state updates, contradictions, audit log
 *   - StateMutationEngine: Layer 3 → state updates, Layer 4 → obligations,
 *     contradiction detection, noise signal skipping, EventBus emission
 *   - Full pipeline: ProcessingResult → mutations → queryable world state
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorldStateStore } from "../../src/state/world_state_store.js";
import { StateMutationEngine } from "../../src/state/state_mutation_engine.js";
import { EntityStore } from "../../src/entities/entity_store.js";
import { EventBus } from "../../src/event_bus.js";
import { ProcessingResult } from "../../schema/processing.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProcessingResult(overrides: Partial<ProcessingResult> = {}): ProcessingResult {
  return {
    id: "proc-001",
    signal_id: "sig-001",
    processed_at: new Date().toISOString(),
    model: "gpt-4.1",
    is_noise: false,
    layer_1: {
      is_noise: false,
      raw_facts: [
        { fact: "Invoice #2024-089 for $4,200 sent by Vertex Design Co", source_ref: "email body" },
        { fact: "Payment due April 11, 2026", source_ref: "email body" },
      ],
    },
    layer_2: {
      entity_candidates: [
        { label: "Sarah Chen", domain: "person", likely_existing: false, lookup_key: "sarah chen", email: "sarah@vertexdesign.com" },
        { label: "Vertex Design Co", domain: "organization", likely_existing: false, lookup_key: "vertex design" },
        { label: "Invoice #2024-089", domain: "artifact", likely_existing: false, lookup_key: "invoice-2024-089" },
      ],
      matched_entity_ids: [],
      proposed_new_entities: [],
      similarity_conflicts: [],
    },
    layer_3: {
      state_updates: [
        {
          entity_label: "Invoice #2024-089",
          entity_domain: "artifact",
          field: "status",
          new_value: "sent",
          source_fact: "Invoice #2024-089 sent by Vertex Design Co",
        },
        {
          entity_label: "Invoice #2024-089",
          entity_domain: "artifact",
          field: "amount",
          new_value: "$4,200",
          source_fact: "Invoice #2024-089 for $4,200",
        },
      ],
      unchanged_entities: ["Sarah Chen"],
      ambiguities: [],
    },
    layer_4: {
      new_obligations: [
        {
          title: "Pay Invoice #2024-089",
          description: "Payment of $4,200 due to Vertex Design Co for Meridian Coffee project",
          owed_by: "Meridian Coffee Co",
          owed_to: "Vertex Design Co",
          workspace_hint: "Meridian Coffee",
          priority: "high",
          due_hint: "April 11, 2026",
          source_fact: "Payment due April 11, 2026",
          is_new: true,
        },
      ],
      updated_obligations: [],
      dependency_changes: [],
    },
    layer_5: {
      inferences: [
        {
          statement: "Invoice is in final delivery stage",
          confidence: 0.85,
          based_on_facts: ["Invoice #2024-089 sent"],
          risk_if_wrong: "medium",
        },
      ],
      risk_flags: [],
      priority_estimates: [],
      missing_information: [],
    },
    layer_6: {
      proposed_actions: [
        {
          rank: 1,
          kind: "create_task",
          description: "Create payment task for Invoice #2024-089",
          target_entities: ["Invoice #2024-089"],
          risk: "low",
          requires_approval: false,
          rationale: "Invoice is due April 11",
          expected_outcome: "Payment tracked",
        },
        {
          rank: 2,
          kind: "log_payment",
          description: "Log the $4,200 payment obligation",
          target_entities: ["Vertex Design Co"],
          risk: "medium",
          requires_approval: false,
          rationale: "Obligation should be recorded",
          expected_outcome: "Obligation in world state",
        },
        {
          rank: 3,
          kind: "draft_reply",
          description: "Draft acknowledgment reply to Sarah Chen",
          target_entities: ["Sarah Chen"],
          risk: "high",
          requires_approval: true,
          rationale: "Client communication requires approval",
          expected_outcome: "Client informed",
        },
      ],
      any_requires_approval: true,
      confidence: 0.9,
    },
    ...overrides,
  };
}

function makeNoiseResult(): ProcessingResult {
  return makeProcessingResult({
    id: "proc-noise",
    signal_id: "sig-noise",
    is_noise: true,
    layer_1: { is_noise: true, raw_facts: [], noise_reason: "Promotional email" },
    layer_3: { state_updates: [], unchanged_entities: [], ambiguities: [] },
    layer_4: { new_obligations: [], updated_obligations: [], dependency_changes: [] },
  });
}

// ─── WorldStateStore Tests ────────────────────────────────────────────────────

describe("Phase 4 — WorldStateStore", () => {
  let tmpDir: string;
  let store: WorldStateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-phase4-store-"));
    store = new WorldStateStore({ storageDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initializes with empty state", () => {
    const summary = store.getSummary();
    expect(summary.open_obligations).toBe(0);
    expect(summary.total_obligations).toBe(0);
    expect(summary.state_updates).toBe(0);
    expect(summary.unresolved_contradictions).toBe(0);
    expect(summary.audit_entries).toBe(0);
  });

  it("creates an obligation with full provenance", () => {
    const obligation = store.createObligation({
      title: "Pay Invoice #2024-089",
      description: "Payment of $4,200 due",
      owed_by: "Meridian Coffee Co",
      owed_to: "Vertex Design Co",
      priority: "high",
      due_hint: "April 11, 2026",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
      source_fact: "Payment due April 11, 2026",
    });

    expect(obligation.id).toBeTruthy();
    expect(obligation.status).toBe("open");
    expect(obligation.source_signal_id).toBe("sig-001");
    expect(obligation.source_processing_id).toBe("proc-001");
    expect(store.getOpenObligations()).toHaveLength(1);
  });

  it("persists obligations to disk and reloads them", () => {
    store.createObligation({
      title: "Pay Invoice #2024-089",
      description: "Payment of $4,200",
      owed_by: "Client",
      owed_to: "Vendor",
      priority: "high",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
      source_fact: "Invoice sent",
    });

    const reloaded = new WorldStateStore({ storageDir: tmpDir });
    expect(reloaded.getOpenObligations()).toHaveLength(1);
    expect(reloaded.getSummary().audit_entries).toBe(1);
  });

  it("updates obligation status with history tracking", () => {
    const obligation = store.createObligation({
      title: "Pay Invoice",
      description: "Payment due",
      owed_by: "Client",
      owed_to: "Vendor",
      priority: "medium",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
      source_fact: "Invoice sent",
    });

    store.updateObligationStatus(obligation.id, "fulfilled", "Payment received", "sig-002");

    const updated = store.getObligation(obligation.id)!;
    expect(updated.status).toBe("fulfilled");
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].status).toBe("open");
    expect(store.getOpenObligations()).toHaveLength(0);
  });

  it("applies state updates and tracks current field value", () => {
    store.applyStateUpdate({
      entity_id: "ent-001",
      entity_label: "Invoice #2024-089",
      entity_domain: "artifact",
      field: "status",
      new_value: "sent",
      source_fact: "Invoice sent",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
    });

    expect(store.getCurrentFieldValue("Invoice #2024-089", "status")).toBe("sent");
    expect(store.getStateUpdatesForEntity("Invoice #2024-089")).toHaveLength(1);
  });

  it("records a contradiction when field value conflicts", () => {
    store.applyStateUpdate({
      entity_id: "ent-001",
      entity_label: "Invoice #2024-089",
      entity_domain: "artifact",
      field: "status",
      new_value: "sent",
      source_fact: "Invoice sent",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
    });

    store.recordContradiction({
      description: "Invoice status conflict: sent vs paid",
      entity_label: "Invoice #2024-089",
      entity_domain: "artifact",
      field: "status",
      existing_value: "sent",
      incoming_value: "paid",
      source_signal_id: "sig-002",
      source_processing_id: "proc-002",
    });

    expect(store.getUnresolvedContradictions()).toHaveLength(1);
  });

  it("resolves a contradiction", () => {
    const contradiction = store.recordContradiction({
      description: "Status conflict",
      entity_label: "Invoice #2024-089",
      entity_domain: "artifact",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
    });

    store.resolveContradiction(contradiction.id, "Confirmed: status is paid");
    expect(store.getUnresolvedContradictions()).toHaveLength(0);
  });

  it("maintains a full audit log with provenance", () => {
    store.createObligation({
      title: "Pay Invoice",
      description: "Payment due",
      owed_by: "Client",
      owed_to: "Vendor",
      priority: "high",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
      source_fact: "Invoice sent",
    });
    store.applyStateUpdate({
      entity_id: "ent-001",
      entity_label: "Invoice",
      entity_domain: "artifact",
      field: "status",
      new_value: "sent",
      source_fact: "Invoice sent",
      source_signal_id: "sig-001",
      source_processing_id: "proc-001",
    });

    const log = store.getAuditLogForSignal("sig-001");
    expect(log).toHaveLength(2);
    expect(log[0].event_type).toBe("obligation_created");
    expect(log[1].event_type).toBe("state_updated");
  });
});

// ─── StateMutationEngine Tests ────────────────────────────────────────────────

describe("Phase 4 — StateMutationEngine", () => {
  let tmpDir: string;
  let worldStateStore: WorldStateStore;
  let entityStore: EntityStore;
  let eventBus: EventBus;
  let engine: StateMutationEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-phase4-engine-"));
    worldStateStore = new WorldStateStore({ storageDir: tmpDir });
    entityStore = new EntityStore({ storageDir: tmpDir });
    eventBus = new EventBus();
    engine = new StateMutationEngine({ worldStateStore, entityStore, eventBus });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips all mutations for noise signals", () => {
    const result = makeNoiseResult();
    const summary = engine.apply(result);

    expect(summary.skipped_noise).toBe(true);
    expect(summary.obligations_created).toBe(0);
    expect(summary.state_updates_applied).toBe(0);
    expect(worldStateStore.getSummary().total_obligations).toBe(0);
  });

  it("creates obligations from Layer 4 new_obligations", () => {
    const result = makeProcessingResult();
    const summary = engine.apply(result);

    expect(summary.obligations_created).toBe(1);
    expect(worldStateStore.getOpenObligations()).toHaveLength(1);

    const obligation = worldStateStore.getOpenObligations()[0];
    expect(obligation.title).toBe("Pay Invoice #2024-089");
    expect(obligation.owed_by).toBe("Meridian Coffee Co");
    expect(obligation.owed_to).toBe("Vertex Design Co");
    expect(obligation.priority).toBe("high");
    expect(obligation.source_signal_id).toBe("sig-001");
    expect(obligation.source_processing_id).toBe("proc-001");
  });

  it("applies state updates from Layer 3", () => {
    const result = makeProcessingResult();
    const summary = engine.apply(result);

    expect(summary.state_updates_applied).toBe(2);
    expect(worldStateStore.getCurrentFieldValue("Invoice #2024-089", "status")).toBe("sent");
    expect(worldStateStore.getCurrentFieldValue("Invoice #2024-089", "amount")).toBe("$4,200");
  });

  it("detects and records contradictions when field value conflicts", () => {
    // First signal sets status to "sent"
    engine.apply(makeProcessingResult());

    // Second signal sets status to "paid" — contradiction
    const result2 = makeProcessingResult({
      id: "proc-002",
      signal_id: "sig-002",
      layer_3: {
        state_updates: [
          {
            entity_label: "Invoice #2024-089",
            entity_domain: "artifact",
            field: "status",
            new_value: "paid",
            source_fact: "Payment confirmed",
          },
        ],
        unchanged_entities: [],
        ambiguities: [],
      },
      layer_4: { new_obligations: [], updated_obligations: [], dependency_changes: [] },
    });

    const summary2 = engine.apply(result2);

    expect(summary2.contradictions_recorded).toBe(1);
    expect(worldStateStore.getUnresolvedContradictions()).toHaveLength(1);
    const contradiction = worldStateStore.getUnresolvedContradictions()[0];
    expect(contradiction.existing_value).toBe("sent");
    expect(contradiction.incoming_value).toBe("paid");
  });

  it("records Layer 3 ambiguities as contradictions", () => {
    const result = makeProcessingResult({
      layer_3: {
        state_updates: [],
        unchanged_entities: [],
        ambiguities: [
          {
            description: "Unclear whether invoice was sent or received",
            entities_involved: ["Invoice #2024-089"],
          },
        ],
      },
    });

    const summary = engine.apply(result);
    expect(summary.contradictions_recorded).toBe(1);
    expect(worldStateStore.getUnresolvedContradictions()).toHaveLength(1);
  });

  it("emits state_updated event on the EventBus when mutations are applied", () => {
    const stateUpdatedEvents: unknown[] = [];
    eventBus.on("state_updated", (payload) => stateUpdatedEvents.push(payload));

    engine.apply(makeProcessingResult());

    expect(stateUpdatedEvents).toHaveLength(1);
    const event = stateUpdatedEvents[0] as { signalId: string; mutationCount: number };
    expect(event.signalId).toBe("sig-001");
    expect(event.mutationCount).toBeGreaterThan(0);
  });

  it("does NOT emit state_updated for noise signals", () => {
    const stateUpdatedEvents: unknown[] = [];
    eventBus.on("state_updated", (payload) => stateUpdatedEvents.push(payload));

    engine.apply(makeNoiseResult());

    expect(stateUpdatedEvents).toHaveLength(0);
  });

  it("full audit trail: every mutation is traceable to source signal", () => {
    engine.apply(makeProcessingResult());

    const auditLog = worldStateStore.getAuditLogForSignal("sig-001");
    // Should have entries for 1 obligation + 2 state updates = 3 entries
    expect(auditLog.length).toBeGreaterThanOrEqual(3);
    for (const entry of auditLog) {
      expect(entry.source_signal_id).toBe("sig-001");
      expect(entry.source_processing_id).toBe("proc-001");
    }
  });

  it("finds obligations by entity label", () => {
    engine.apply(makeProcessingResult());

    const obligations = worldStateStore.findObligationsByEntity("Vertex Design Co");
    expect(obligations).toHaveLength(1);
    expect(obligations[0].title).toBe("Pay Invoice #2024-089");
  });
});
