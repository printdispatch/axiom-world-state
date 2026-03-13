/**
 * SignalGateway
 *
 * The single entry point for all incoming signals into the Axiom system.
 * Responsibilities:
 *   1. Accept raw input from any supported source adapter
 *   2. Validate that the signal has provenance
 *   3. Persist the signal to the SignalStore (append-only)
 *   4. Emit a `signal_received` event on the EventBus
 *
 * The gateway does NOT interpret signals. It only normalizes and stores them.
 * Interpretation is the responsibility of the Six-Layer Processing Engine (Phase 2).
 */

import { Signal } from "../../schema/signals.js";
import { requireProvenance } from "../provenance.js";
import { SignalStore } from "./signal_store.js";
import { EventBus } from "../event_bus.js";

export interface SignalGatewayOptions {
  store: SignalStore;
  eventBus: EventBus;
}

export interface IngestResult {
  success: boolean;
  signalId: string;
  error?: string;
}

export class SignalGateway {
  private readonly store: SignalStore;
  private readonly eventBus: EventBus;

  constructor(options: SignalGatewayOptions) {
    this.store = options.store;
    this.eventBus = options.eventBus;
  }

  /**
   * Ingests a pre-formed Signal object into the system.
   *
   * This method is called by source adapters (e.g. GmailAdapter) after they
   * have converted a raw external message into a Signal.
   *
   * @param signal - A fully-formed Signal object from an adapter
   * @returns An IngestResult indicating success or failure
   */
  ingest(signal: Signal): IngestResult {
    try {
      // Rule: provenance is required for every signal
      requireProvenance(signal.provenance);

      // Persist to the append-only signal log
      this.store.append(signal);

      // Notify all listeners that a new signal has arrived
      this.eventBus.emit("signal_received", {
        signalId: signal.id,
        sourceKind: signal.source_kind,
        title: signal.title,
        observedAt: signal.observed_at,
      });

      return { success: true, signalId: signal.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, signalId: signal.id, error };
    }
  }
}
