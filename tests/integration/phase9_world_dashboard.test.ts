import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { WorldStateStore } from "../../src/state/world_state_store.js";
import { EntityStore } from "../../src/entities/entity_store.js";
import { SignalStore } from "../../src/signals/signal_store.js";
import { ReviewStore } from "../../src/review/review_store.js";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;
let worldStore: WorldStateStore;
let entityStore: EntityStore;
let signalStore: SignalStore;
let reviewStore: ReviewStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-phase9-"));
  worldStore = new WorldStateStore({ storageDir: path.join(tmpDir, "world") });
  entityStore = new EntityStore({ storageDir: path.join(tmpDir, "entities") });
  signalStore = new SignalStore({ storageDir: path.join(tmpDir, "signals") });
  reviewStore = new ReviewStore(path.join(tmpDir, "review_queue.json"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Phase 9: World State Dashboard", () => {

  it("should aggregate open obligations from world state", () => {
    worldStore.createObligation({
      title: "Pay Invoice #2024-089",
      priority: "high",
      description: "Invoice payment due",
      owed_by: "Meridian Coffee",
      owed_to: "Vertex Design Co",
      source_signal_id: "sig-1",
      source_processing_id: "proc-1",
      source_fact: "Invoice #2024-089 for $4,200 is due April 11, 2026",
    });
    worldStore.createObligation({
      title: "Deliver logo revisions",
      priority: "high",
      description: "Logo revisions for client",
      owed_by: "You",
      owed_to: "Harborview Restaurant Group",
      source_signal_id: "sig-2",
      source_processing_id: "proc-2",
      source_fact: "Logo revisions requested by March 20",
    });

    const obligations = worldStore.getAllObligations();
    const open = obligations.filter(o => o.status === "open");
    expect(open).toHaveLength(2);
  });

  it("should identify overdue obligations based on due_hint date", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    worldStore.createObligation({
      title: "Overdue task",
      priority: "critical",
      description: "This is overdue",
      owed_by: "Client",
      owed_to: "You",
      due_hint: pastDate,
      source_signal_id: "sig-1",
      source_processing_id: "proc-1",
      source_fact: "Payment was due last week",
    });
    worldStore.createObligation({
      title: "Future task",
      priority: "medium",
      description: "This is upcoming",
      owed_by: "Client",
      owed_to: "You",
      due_hint: futureDate,
      source_signal_id: "sig-2",
      source_processing_id: "proc-2",
      source_fact: "Payment due next week",
    });

    const obligations = worldStore.getAllObligations();
    const now = new Date();
    const overdue = obligations.filter(o =>
      o.status === "open" && o.due_hint && new Date(o.due_hint) < now
    );
    const upcoming = obligations.filter(o =>
      o.status === "open" && o.due_hint && new Date(o.due_hint) >= now
    );

    expect(overdue).toHaveLength(1);
    expect(overdue[0].title).toBe("Overdue task");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].title).toBe("Future task");
  });

  it("should track active contradictions", () => {
    worldStore.recordContradiction({
      description: "Invoice amount conflict: $4,200 vs $3,800",
      entity_label: "Invoice #2024-089",
      entity_domain: "artifact",
      field: "amount",
      existing_value: "$4,200",
      incoming_value: "$3,800",
      source_signal_id: "sig-2",
      source_processing_id: "proc-2",
    });

    const contradictions = worldStore.getUnresolvedContradictions();
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].description).toContain("Invoice amount conflict");
  });

  it("should track entity update counts for most active entities", () => {
    for (let i = 0; i < 3; i++) {
      worldStore.applyStateUpdate({
        entity_id: "ent-1",
        entity_label: "Invoice #2024-089",
        entity_domain: "artifact",
        field: `field_${i}`,
        new_value: `value_${i}`,
        source_fact: `Fact ${i}`,
        source_signal_id: "sig-1",
        source_processing_id: "proc-1",
      });
    }

    const entityUpdates = worldStore.getStateUpdatesForEntity("Invoice #2024-089");
    expect(entityUpdates).toHaveLength(3);
  });

  it("should compute health score as 100 when no issues exist", () => {
    const obligations = worldStore.getAllObligations();
    const activeContradictions = worldStore.getUnresolvedContradictions().length;
    const pendingReviews = reviewStore.getPending();

    const overdueCount = obligations.filter(o =>
      o.status === "open" && o.due_hint && new Date(o.due_hint) < new Date()
    ).length;

    const healthScore = Math.max(0, 100 - (overdueCount * 15) - (activeContradictions * 10) - (pendingReviews.length * 5));
    expect(healthScore).toBe(100);
  });

  it("should degrade health score with overdue obligations and contradictions", () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    worldStore.createObligation({
      title: "Overdue payment",
      priority: "critical",
      description: "Past due",
      owed_by: "Client",
      owed_to: "You",
      due_hint: pastDate,
      source_signal_id: "sig-1",
      source_processing_id: "proc-1",
      source_fact: "Payment was due yesterday",
    });
    worldStore.recordContradiction({
      description: "Data conflict",
      entity_label: "Test Entity",
      entity_domain: "artifact",
      source_signal_id: "sig-1",
      source_processing_id: "proc-1",
    });

    const obligations = worldStore.getAllObligations();
    const overdueCount = obligations.filter(o =>
      o.status === "open" && o.due_hint && new Date(o.due_hint) < new Date()
    ).length;
    const activeContradictions = worldStore.getUnresolvedContradictions().length;

    const healthScore = Math.max(0, 100 - (overdueCount * 15) - (activeContradictions * 10));
    expect(healthScore).toBe(75); // 100 - 15 - 10 = 75
  });

  it("should return recent activity sorted by most recent first", () => {
    for (let i = 0; i < 3; i++) {
      worldStore.applyStateUpdate({
        entity_id: "ent-1",
        entity_label: "Test Entity",
        entity_domain: "person",
        field: `field_${i}`,
        new_value: `value_${i}`,
        source_fact: `Fact ${i}`,
        source_signal_id: "sig-1",
        source_processing_id: "proc-1",
      });
    }

    const updates = worldStore.getStateUpdatesForEntity("Test Entity");
    const sorted = [...updates].sort((a, b) =>
      new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime()
    );

    expect(sorted).toHaveLength(3);
    const fields = sorted.map(u => u.field);
    expect(fields).toContain("field_0");
    expect(fields).toContain("field_1");
    expect(fields).toContain("field_2");
  });

  it("should count signals and entities for the summary", async () => {
    const { gmailMessageToSignal } = await import("../../src/signals/adapters/gmail_adapter.js");
    const signal = gmailMessageToSignal({
      id: "msg-1",
      threadId: "thread-1",
      internalDate: new Date().toISOString(),
      from: "test@example.com",
      to: "me@example.com",
      subject: "Test email",
      bodyText: "Test email body",
    }, "test");
    signalStore.append(signal);
    entityStore.create({
      canonical_name: "Test Person",
      domain: "person",
      source_signal_id: signal.id,
    });

    const signals = signalStore.readAll();
    const entities = entityStore.getAll();

    expect(signals).toHaveLength(1);
    expect(entities).toHaveLength(1);
  });
});
