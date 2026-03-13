/**
 * Phase 2 Integration Test: Six-Layer Processing Engine
 *
 * Acceptance criteria (from BUILD_ORDER.md Phase 2):
 *   ✓ A signal produces a complete six-layer ProcessingResult
 *   ✓ Layer 1 extracts raw facts with source references
 *   ✓ Layer 2 identifies entity candidates
 *   ✓ Layer 3 records state updates
 *   ✓ Layer 4 identifies obligations (who owes what to whom)
 *   ✓ Layer 5 produces inferences with confidence scores
 *   ✓ Layer 6 proposes exactly 3 ranked actions
 *   ✓ Noise/spam emails are classified and skipped
 *   ✓ ProcessingService wires processor to EventBus correctly
 *
 * NOTE: Tests marked [LIVE] make real calls to the OpenAI API.
 * Tests marked [UNIT] use mocked processors and do not require an API key.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignalStore } from "../../src/signals/signal_store.js";
import { SignalGateway } from "../../src/signals/signal_gateway.js";
import { EventBus } from "../../src/event_bus.js";
import {
  gmailMessageToSignal,
  GmailMessage,
} from "../../src/signals/adapters/gmail_adapter.js";
import { SixLayerProcessor } from "../../src/engine/six_layer_processor.js";
import { ProcessingService } from "../../src/engine/processing_service.js";
import { jest } from "@jest/globals";
import { ProcessingResult } from "../../schema/processing.js";

// ─── Test Fixtures ────────────────────────────────────────────────────────────

/** A realistic client project email requesting sign-off */
const CLIENT_EMAIL: GmailMessage = {
  id: "msg_client_001",
  threadId: "thread_001",
  internalDate: "2026-03-12T09:15:00.000Z",
  from: "sarah.chen@vertexdesign.co",
  to: "bob@printdispatch.com",
  subject: "Brand Identity Package — Final Files + Invoice #2024-089",
  bodyText: `Hi Bob,

I've attached the final brand identity package for Meridian Coffee Co. 
This includes the logo suite (primary, secondary, monochrome), brand guidelines PDF, 
and all source files in both AI and EPS format.

Invoice #2024-089 for $4,200 is also attached, due within 30 days (April 11, 2026).
This covers the full brand identity project as agreed in our contract dated January 15, 2026.

Please review and let me know if anything needs adjustment. Once you confirm everything 
looks good, I'll consider the project complete and close out the file.

Looking forward to your feedback!

Best,
Sarah Chen
Lead Designer — Vertex Design Co.
sarah.chen@vertexdesign.co | (415) 555-0192`,
  accountAddress: "bob@printdispatch.com",
};

/** A realistic invoice follow-up email */
const INVOICE_FOLLOWUP_EMAIL: GmailMessage = {
  id: "msg_invoice_002",
  threadId: "thread_002",
  internalDate: "2026-03-12T14:30:00.000Z",
  from: "billing@cloudhost.io",
  to: "bob@printdispatch.com",
  subject: "Payment Reminder: Invoice #CH-7821 — $189.00 overdue",
  bodyText: `Dear Bob,

This is a reminder that Invoice #CH-7821 for $189.00 is now 14 days overdue.

Service: Cloud Hosting — Professional Plan (February 2026)
Due Date: February 26, 2026
Amount: $189.00

Please arrange payment at your earliest convenience to avoid service interruption.
You can pay online at: https://billing.cloudhost.io/pay/CH-7821

If you have already made payment, please disregard this notice.

Thank you,
CloudHost Billing Team`,
  accountAddress: "bob@printdispatch.com",
};

/** A spam/marketing email that should be classified as noise */
const SPAM_EMAIL: GmailMessage = {
  id: "msg_spam_003",
  threadId: "thread_003",
  internalDate: "2026-03-12T08:00:00.000Z",
  from: "deals@shopnow-promo.com",
  to: "bob@printdispatch.com",
  subject: "🔥 FLASH SALE: 70% OFF Everything — Today Only!!!",
  bodyText: `DON'T MISS OUT! Our biggest sale of the year is happening RIGHT NOW!

70% OFF all products — use code FLASH70 at checkout.
Free shipping on orders over $25.
Sale ends TONIGHT at midnight.

Shop now: https://shopnow-promo.com/flash-sale

Unsubscribe | Privacy Policy`,
  accountAddress: "bob@printdispatch.com",
};

// ─── Test Setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let store: SignalStore;
let eventBus: EventBus;
let gateway: SignalGateway;
let processor: SixLayerProcessor;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-phase2-test-"));
  store = new SignalStore({ storageDir: tmpDir });
  eventBus = new EventBus();
  gateway = new SignalGateway({ store, eventBus });
  processor = new SixLayerProcessor({ storageDir: tmpDir, model: 'gpt-4.1' });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  eventBus.reset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Phase 2 — Six-Layer Processing Engine", () => {
  describe("[LIVE] Client project email — full six-layer processing", () => {
    it("produces a complete ProcessingResult with all six layers populated", async () => {
      const signal = gmailMessageToSignal(CLIENT_EMAIL, "test");
      const result = await processor.process(signal);

      // Top-level shape
      expect(result.id).toBeTruthy();
      expect(result.signal_id).toBe(signal.id);
      expect(result.is_noise).toBe(false);
      expect(result.model).toBeTruthy();

      // Layer 1: Raw facts
      expect(result.layer_1.is_noise).toBe(false);
      expect(result.layer_1.raw_facts.length).toBeGreaterThan(0);
      result.layer_1.raw_facts.forEach((f) => {
        expect(f.fact).toBeTruthy();
        expect(f.source_ref).toBeTruthy();
      });

      // Layer 2: Entity candidates
      expect(result.layer_2.entity_candidates.length).toBeGreaterThan(0);
      const entityLabels = result.layer_2.entity_candidates.map((e) => e.label);
      // Should identify Sarah Chen and/or Vertex Design Co.
      const hasPerson = result.layer_2.entity_candidates.some(
        (e) => e.domain === "person"
      );
      expect(hasPerson).toBe(true);

      // Layer 3: State updates
      expect(result.layer_3.state_updates.length).toBeGreaterThan(0);

      // Layer 4: Obligations — invoice creates an obligation
      const allObligations = [
        ...result.layer_4.new_obligations,
        ...result.layer_4.updated_obligations,
      ];
      expect(allObligations.length).toBeGreaterThan(0);
      // At least one obligation should mention payment
      const paymentObligation = allObligations.find(
        (o) =>
          o.description.toLowerCase().includes("payment") ||
          o.description.toLowerCase().includes("invoice") ||
          o.title.toLowerCase().includes("invoice")
      );
      expect(paymentObligation).toBeDefined();

      // Layer 5: Inferences with confidence scores
      expect(result.layer_5.inferences.length).toBeGreaterThan(0);
      result.layer_5.inferences.forEach((inf) => {
        expect(inf.confidence).toBeGreaterThanOrEqual(0);
        expect(inf.confidence).toBeLessThanOrEqual(1);
        expect(inf.based_on_facts.length).toBeGreaterThan(0);
      });

      // Layer 6: Exactly 3 proposed actions
      expect(result.layer_6.proposed_actions).toHaveLength(3);
      expect(result.layer_6.proposed_actions[0].rank).toBe(1);
      expect(result.layer_6.proposed_actions[1].rank).toBe(2);
      expect(result.layer_6.proposed_actions[2].rank).toBe(3);
      result.layer_6.proposed_actions.forEach((action) => {
        expect(action.kind).toBeTruthy();
        expect(action.description).toBeTruthy();
        expect(action.rationale).toBeTruthy();
        expect(action.expected_outcome).toBeTruthy();
        expect(["low", "medium", "high", "critical"]).toContain(action.risk);
      });
    }, 90000); // 90s timeout for live API call
  });

  describe("[LIVE] Invoice follow-up email — overdue payment detection", () => {
    it("detects an overdue payment and flags it as a risk", async () => {
      const signal = gmailMessageToSignal(INVOICE_FOLLOWUP_EMAIL, "test");
      const result = await processor.process(signal);

      expect(result.is_noise).toBe(false);

      // Should detect the overdue payment as a risk flag
      const hasRiskFlag =
        result.layer_5.risk_flags.length > 0 ||
        result.layer_5.inferences.some(
          (i) =>
            i.statement.toLowerCase().includes("overdue") ||
            i.statement.toLowerCase().includes("payment")
        );
      expect(hasRiskFlag).toBe(true);

      // Should propose an action related to payment
      const paymentAction = result.layer_6.proposed_actions.find(
        (a) =>
          a.description.toLowerCase().includes("pay") ||
          a.description.toLowerCase().includes("invoice") ||
          a.kind === "log_payment"
      );
      expect(paymentAction).toBeDefined();
    }, 90000);
  });

  describe("[LIVE] Spam email — noise classification", () => {
    it("classifies a promotional email as noise and returns minimal output", async () => {
      const signal = gmailMessageToSignal(SPAM_EMAIL, "test");
      const result = await processor.process(signal);

      expect(result.is_noise).toBe(true);
      expect(result.layer_1.is_noise).toBe(true);
      expect(result.layer_1.noise_reason).toBeTruthy();

      // Noise signals should have no real obligations or inferences
      expect(result.layer_4.new_obligations).toHaveLength(0);
      expect(result.layer_5.inferences).toHaveLength(0);
    }, 90000);
  });

  describe("[UNIT] ProcessingService — EventBus wiring", () => {
    it("auto-processes a signal when signal_received fires on the EventBus", async () => {
      // Use a mock processor that returns a canned result without calling the API
      const mockResult: ProcessingResult = {
        id: "mock-result-id",
        signal_id: "mock-signal-id",
        processed_at: new Date().toISOString(),
        model: "mock",
        is_noise: false,
        layer_1: { raw_facts: [{ fact: "test", source_ref: "body" }], is_noise: false },
        layer_2: {
          entity_candidates: [],
          matched_entity_ids: [],
          proposed_new_entities: [],
          similarity_conflicts: [],
        },
        layer_3: { state_updates: [], unchanged_entities: [], ambiguities: [] },
        layer_4: {
          new_obligations: [],
          updated_obligations: [],
          dependency_changes: [],
        },
        layer_5: {
          inferences: [],
          risk_flags: [],
          priority_estimates: [],
          missing_information: [],
        },
        layer_6: {
          proposed_actions: [
            {
              rank: 1,
              kind: "create_task",
              description: "Mock action 1",
              target_entities: [],
              risk: "low",
              requires_approval: false,
              rationale: "test",
              expected_outcome: "test",
            },
            {
              rank: 2,
              kind: "create_task",
              description: "Mock action 2",
              target_entities: [],
              risk: "low",
              requires_approval: false,
              rationale: "test",
              expected_outcome: "test",
            },
            {
              rank: 3,
              kind: "archive_signal",
              description: "Mock action 3",
              target_entities: [],
              risk: "low",
              requires_approval: false,
              rationale: "test",
              expected_outcome: "test",
            },
          ],
          any_requires_approval: false,
          confidence: 0.9,
        },
      };

      const mockProcessor = {
        process: (jest.fn() as jest.MockedFunction<() => Promise<ProcessingResult>>).mockResolvedValue(mockResult),
      } as unknown as SixLayerProcessor;

      const service = new ProcessingService({
        eventBus,
        signalStore: store,
        processor: mockProcessor,
      });
      service.start();

      // Ingest a signal through the gateway
      const signal = gmailMessageToSignal(CLIENT_EMAIL, "test");
      // Override the signal ID to match mock result
      (signal as { id: string }).id = "mock-signal-id";
      store.append(signal);

      // Collect events
      const processedEvents: string[] = [];
      eventBus.on("signal_processed", (p) => {
        processedEvents.push(p.processingRecordId);
      });

      // Manually trigger the event (simulating what gateway.ingest would do)
      eventBus.emit("signal_received", {
        signalId: signal.id,
        sourceKind: "email",
        title: signal.title,
        observedAt: signal.observed_at,
      });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockProcessor.process).toHaveBeenCalledTimes(1);
      expect(processedEvents).toContain("mock-result-id");
    });

    it("emits review_required when a proposed action requires approval", async () => {
      const mockResultWithApproval: ProcessingResult = {
        id: "mock-result-approval",
        signal_id: "mock-signal-approval",
        processed_at: new Date().toISOString(),
        model: "mock",
        is_noise: false,
        layer_1: { raw_facts: [{ fact: "test", source_ref: "body" }], is_noise: false },
        layer_2: {
          entity_candidates: [],
          matched_entity_ids: [],
          proposed_new_entities: [],
          similarity_conflicts: [],
        },
        layer_3: { state_updates: [], unchanged_entities: [], ambiguities: [] },
        layer_4: {
          new_obligations: [],
          updated_obligations: [],
          dependency_changes: [],
        },
        layer_5: {
          inferences: [],
          risk_flags: [],
          priority_estimates: [],
          missing_information: [],
        },
        layer_6: {
          proposed_actions: [
            {
              rank: 1,
              kind: "send_reply",
              description: "Send reply to client",
              target_entities: ["client@example.com"],
              risk: "high",
              requires_approval: true,
              rationale: "Sending external email requires approval",
              expected_outcome: "Client receives confirmation",
            },
            {
              rank: 2,
              kind: "create_task",
              description: "Create follow-up task",
              target_entities: [],
              risk: "low",
              requires_approval: false,
              rationale: "Internal task",
              expected_outcome: "Task created",
            },
            {
              rank: 3,
              kind: "archive_signal",
              description: "Archive after processing",
              target_entities: [],
              risk: "low",
              requires_approval: false,
              rationale: "Cleanup",
              expected_outcome: "Signal archived",
            },
          ],
          any_requires_approval: true,
          confidence: 0.85,
        },
      };

      const mockProcessor = {
        process: (jest.fn() as jest.MockedFunction<() => Promise<ProcessingResult>>).mockResolvedValue(mockResultWithApproval),
      } as unknown as SixLayerProcessor;

      const service = new ProcessingService({
        eventBus,
        signalStore: store,
        processor: mockProcessor,
      });
      service.start();

      const signal = gmailMessageToSignal(CLIENT_EMAIL, "test");
      (signal as { id: string }).id = "mock-signal-approval";
      store.append(signal);

      const reviewEvents: string[] = [];
      eventBus.on("review_required", (p) => {
        reviewEvents.push(p.signalId);
      });

      eventBus.emit("signal_received", {
        signalId: signal.id,
        sourceKind: "email",
        title: signal.title,
        observedAt: signal.observed_at,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(reviewEvents).toContain("mock-signal-approval");
    });
  });
});
