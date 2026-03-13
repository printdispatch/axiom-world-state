/**
 * Phase 1 Integration Test: Core Signal Pipeline
 *
 * Acceptance criteria (from BUILD_ORDER.md Phase 1):
 *   ✓ Ingest a sample Gmail email
 *   ✓ Signal appears in storage with correct fields
 *   ✓ Signal has provenance
 *   ✓ signal_received event is emitted on the EventBus
 *   ✓ Duplicate signals are rejected
 *   ✓ Signals without provenance are rejected
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignalStore } from "../../src/signals/signal_store.js";
import { SignalGateway } from "../../src/signals/signal_gateway.js";
import { EventBus, SignalReceivedPayload } from "../../src/event_bus.js";
import {
  gmailMessageToSignal,
  GmailMessage,
} from "../../src/signals/adapters/gmail_adapter.js";

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const SAMPLE_GMAIL_MESSAGE: GmailMessage = {
  id: "18e4a1b2c3d4e5f6",
  threadId: "18e4a1b2c3d4e5f6",
  internalDate: "2026-03-12T10:00:00.000Z",
  from: "alice@example.com",
  to: "bob@printdispatch.com",
  subject: "Re: Q1 proposal — final version attached",
  bodyText:
    "Hi Bob,\n\nPlease find the final Q1 proposal attached. " +
    "I need your sign-off by Friday EOD so we can move forward with the client.\n\n" +
    "Let me know if you have any questions.\n\nBest,\nAlice",
  accountAddress: "bob@printdispatch.com",
};

// ─── Test Setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let store: SignalStore;
let eventBus: EventBus;
let gateway: SignalGateway;

beforeEach(() => {
  // Use a fresh temp directory for each test to ensure isolation
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-test-"));
  store = new SignalStore({ storageDir: tmpDir });
  eventBus = new EventBus();
  gateway = new SignalGateway({ store, eventBus });
});

afterEach(() => {
  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
  eventBus.reset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Phase 1 — Core Signal Pipeline", () => {
  describe("GmailAdapter", () => {
    it("converts a Gmail message into a valid Signal object", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");

      expect(signal.type).toBe("signal");
      expect(signal.signal_kind).toBe("incoming_message");
      expect(signal.source_kind).toBe("email");
      expect(signal.source_external_id).toBe(SAMPLE_GMAIL_MESSAGE.id);
      expect(signal.title).toBe(SAMPLE_GMAIL_MESSAGE.subject);
      expect(signal.raw_text).toBe(SAMPLE_GMAIL_MESSAGE.bodyText);
      expect(signal.observed_at).toBe(SAMPLE_GMAIL_MESSAGE.internalDate);
      expect(signal.parsed).toBe(false);
      expect(signal.moved_to_state).toBe(false);
      expect(signal.staleness).toBe("fresh");
    });

    it("attaches provenance to the signal", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");

      expect(signal.provenance).toHaveLength(1);
      expect(signal.provenance[0].source_id).toBe(SAMPLE_GMAIL_MESSAGE.id);
      expect(signal.provenance[0].source_kind).toBe("email");
      expect(signal.provenance[0].source_label).toContain(
        SAMPLE_GMAIL_MESSAGE.subject
      );
    });

    it("generates a unique UUID for each signal", () => {
      const s1 = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      const s2 = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe("SignalStore", () => {
    it("initializes with an empty signal log", () => {
      expect(store.count()).toBe(0);
      expect(store.readAll()).toEqual([]);
    });

    it("persists a signal to the log", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      store.append(signal);

      expect(store.count()).toBe(1);
      const stored = store.findById(signal.id);
      expect(stored).toBeDefined();
      expect(stored!.id).toBe(signal.id);
    });

    it("rejects duplicate signals with the same external_id", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      store.append(signal);

      const duplicate = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      expect(() => store.append(duplicate)).toThrow(/Duplicate signal/);
    });

    it("marks a signal as processed", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      store.append(signal);

      expect(store.findUnprocessed()).toHaveLength(1);
      store.markProcessed(signal.id);
      expect(store.findUnprocessed()).toHaveLength(0);
    });
  });

  describe("SignalGateway", () => {
    it("successfully ingests a Gmail signal end-to-end", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      const result = gateway.ingest(signal);

      expect(result.success).toBe(true);
      expect(result.signalId).toBe(signal.id);
      expect(result.error).toBeUndefined();
    });

    it("persists the signal to the store after ingestion", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      gateway.ingest(signal);

      expect(store.count()).toBe(1);
      const stored = store.findById(signal.id);
      expect(stored).toBeDefined();
      expect(stored!.title).toBe(SAMPLE_GMAIL_MESSAGE.subject);
    });

    it("emits a signal_received event on the EventBus after ingestion", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");

      let receivedPayload: SignalReceivedPayload | null = null;
      eventBus.on("signal_received", (payload) => {
        receivedPayload = payload;
      });

      gateway.ingest(signal);

      expect(receivedPayload).not.toBeNull();
      expect(receivedPayload!.signalId).toBe(signal.id);
      expect(receivedPayload!.sourceKind).toBe("email");
      expect(receivedPayload!.title).toBe(SAMPLE_GMAIL_MESSAGE.subject);
    });

    it("records the event in the EventBus log", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      gateway.ingest(signal);

      const log = eventBus.getLog();
      expect(log).toHaveLength(1);
      expect(log[0].event).toBe("signal_received");
    });

    it("returns an error result (not throws) when provenance is missing", () => {
      const signal = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      // Forcibly remove provenance to simulate a bad signal
      (signal as { provenance: unknown[] }).provenance = [];

      const result = gateway.ingest(signal);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Provenance required/);
      // The signal should NOT have been stored
      expect(store.count()).toBe(0);
    });

    it("returns an error result when a duplicate signal is ingested", () => {
      const signal1 = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");
      const signal2 = gmailMessageToSignal(SAMPLE_GMAIL_MESSAGE, "test");

      gateway.ingest(signal1);
      const result = gateway.ingest(signal2);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Duplicate signal/);
      expect(store.count()).toBe(1);
    });
  });
});
