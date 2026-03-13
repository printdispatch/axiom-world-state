/**
 * Phase 7 Integration Tests — Review Queue
 * Tests ReviewStore, ReviewService, and the API decide endpoint
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import { ReviewStore } from "../../src/review/review_store.js";
import { ReviewService } from "../../src/review/review_service.js";
import { EventBus } from "../../src/event_bus.js";

let tmpDir: string;
let store: ReviewStore;
let service: ReviewService;
let bus: EventBus;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-review-test-"));
  store = new ReviewStore(tmpDir);
  bus = new EventBus();
  service = new ReviewService(store, bus);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ReviewStore", () => {
  it("starts with an empty queue", () => {
    expect(store.getAll()).toHaveLength(0);
    expect(store.getPending()).toHaveLength(0);
  });

  it("creates a review item with required fields", () => {
    const item = store.createItem({
      kind: "high_risk_action",
      title: "Send external email",
      description: "Agent proposes sending an email to a client.",
      severity: "high",
      signal_id: "sig-001",
      requires_approval: true,
    });
    expect(item.id).toBeTruthy();
    expect(item.status).toBe("pending");
    expect(item.kind).toBe("high_risk_action");
    expect(item.requires_approval).toBe(true);
    expect(item.created_at).toBeTruthy();
  });

  it("retrieves pending items separately from reviewed items", () => {
    store.createItem({ kind: "entity_conflict", title: "Conflict A", description: "desc", severity: "medium", signal_id: "sig-001", requires_approval: false });
    store.createItem({ kind: "contradiction", title: "Contradiction B", description: "desc", severity: "high", signal_id: "sig-002", requires_approval: false });
    const item3 = store.createItem({ kind: "low_confidence", title: "Low Conf C", description: "desc", severity: "low", signal_id: "sig-003", requires_approval: false });

    // Mark one as reviewed
    store.decide(item3.id, "resolved", "Confirmed as noise");

    expect(store.getAll()).toHaveLength(3);
    expect(store.getPending()).toHaveLength(2);
  });

  it("records a decision correctly", () => {
    const item = store.createItem({ kind: "high_risk_action", title: "Test", description: "desc", severity: "high", signal_id: "sig-001", requires_approval: true });
    const decided = store.decide(item.id, "approved", "Looks good");

    expect(decided).toBeTruthy();
    expect(decided!.status).toBe("reviewed");
    expect(decided!.decision).toBe("approved");
    expect(decided!.decision_note).toBe("Looks good");
    expect(decided!.decided_at).toBeTruthy();
  });

  it("returns null when deciding on a non-existent item", () => {
    const result = store.decide("non-existent-id", "approved");
    expect(result).toBeNull();
  });

  it("supports all four decision types", () => {
    const decisions = ["approved", "rejected", "resolved", "deferred"] as const;
    for (const decision of decisions) {
      const item = store.createItem({ kind: "entity_conflict", title: `Test ${decision}`, description: "desc", severity: "low", signal_id: "sig-001", requires_approval: false });
      const decided = store.decide(item.id, decision);
      expect(decided!.decision).toBe(decision);
    }
  });
});

describe("ReviewService", () => {
  it("creates a review item from a high-risk action in a processing result", () => {
    const mockResult = {
      id: "pr-001",
      signal_id: "sig-001",
      processed_at: new Date().toISOString(),
      model: "gpt-4.1",
      is_noise: false,
      layer_1: { is_noise: false, raw_facts: [] },
      layer_2: { entity_candidates: [], matched_entity_ids: [], proposed_new_entities: [], similarity_conflicts: [] },
      layer_3: { state_updates: [], unchanged_entities: [], ambiguities: [] },
      layer_4: { new_obligations: [], updated_obligations: [], dependency_changes: [] },
      layer_5: { inferences: [], risk_flags: [], priority_estimates: [], missing_information: [] },
      layer_6: {
        proposed_actions: [
          {
            rank: 1,
            kind: "send_email",
            description: "Reply to client confirming invoice receipt",
            target_entities: ["Sarah Chen"],
            risk: "high",
            requires_approval: true,
            rationale: "Client expects confirmation",
            expected_outcome: "Client notified",
          },
        ],
        any_requires_approval: true,
        confidence: 0.92,
      },
    };

    // The ReviewService works via EventBus events — emit a processing_complete event
    const mockSignal = { id: "sig-001", source: "gmail", raw_content: "test", metadata: { from: "test@test.com", subject: "Test", date: new Date().toISOString(), thread_id: "t1" }, received_at: new Date().toISOString(), processed: true, adapter: "gmail" };
    bus.emit("processing_complete", { signal: mockSignal, result: mockResult as never });

    const items = store.getAll();
    expect(items.length).toBeGreaterThan(0);
    const highRiskItem = items.find(i => i.kind === "high_risk_action");
    expect(highRiskItem).toBeTruthy();
    expect(highRiskItem!.requires_approval).toBe(true);
    expect(highRiskItem!.severity).toBe("high");
  });

  it("does not create review items for noise signals", () => {
    const mockResult = {
      id: "pr-002",
      signal_id: "sig-002",
      processed_at: new Date().toISOString(),
      model: "gpt-4.1",
      is_noise: true,
      layer_1: { is_noise: true, raw_facts: [], noise_reason: "Marketing email" },
      layer_2: { entity_candidates: [], matched_entity_ids: [], proposed_new_entities: [], similarity_conflicts: [] },
      layer_3: { state_updates: [], unchanged_entities: [], ambiguities: [] },
      layer_4: { new_obligations: [], updated_obligations: [], dependency_changes: [] },
      layer_5: { inferences: [], risk_flags: [], priority_estimates: [], missing_information: [] },
      layer_6: { proposed_actions: [], any_requires_approval: false, confidence: 0.99 },
    };

    const mockSignal = { id: "sig-002", source: "gmail", raw_content: "spam", metadata: { from: "noreply@spam.com", subject: "Spam", date: new Date().toISOString(), thread_id: "t2" }, received_at: new Date().toISOString(), processed: false, adapter: "gmail" };
    bus.emit("processing_complete", { signal: mockSignal, result: mockResult as never });

    const items = store.getAll();
    expect(items).toHaveLength(0);
  });

  it("creates a review item for entity conflicts via EventBus", () => {
    bus.emit("entities_resolved", {
      signal_id: "sig-003",
      mergedCount: 0,
      createdCount: 0,
      conflictCount: 1,
      conflicts: [{ candidate: "J. Smith", existing: "John Smith", existing_id: "ent-001", score: 0.50 }],
    });
    const items = store.getAll();
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("entity_conflict");
    expect(items[0].signal_id).toBe("sig-003");
    expect(items[0].severity).toBe("medium");
  });
});

describe("Review Queue — Full Workflow", () => {
  it("processes a complete approve/reject cycle", () => {
    const item = store.createItem({
      kind: "high_risk_action",
      title: "Send client email",
      description: "High risk external action",
      severity: "high",
      signal_id: "sig-001",
      requires_approval: true,
    });

    expect(store.getPending()).toHaveLength(1);

    const approved = store.decide(item.id, "approved", "Client confirmed verbally");
    expect(approved!.status).toBe("reviewed");
    expect(store.getPending()).toHaveLength(0);
    expect(store.getAll()).toHaveLength(1);
  });

  it("maintains review history after decisions", () => {
    const item1 = store.createItem({ kind: "entity_conflict", title: "Conflict 1", description: "d", severity: "medium", signal_id: "sig-001", requires_approval: false });
    const item2 = store.createItem({ kind: "contradiction", title: "Contradiction 1", description: "d", severity: "high", signal_id: "sig-002", requires_approval: false });

    store.decide(item1.id, "resolved");
    store.decide(item2.id, "rejected", "False positive");

    const all = store.getAll();
    expect(all).toHaveLength(2);
    expect(all.every(i => i.status === "reviewed")).toBe(true);
    expect(all.find(i => i.id === item2.id)!.decision_note).toBe("False positive");
  });
});
