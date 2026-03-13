/**
 * EventBus
 *
 * The nervous system of the Axiom World State system.
 * All components communicate through this bus — no component calls another directly.
 *
 * This is the Phase 1 in-process implementation using Node.js EventEmitter.
 * In a later phase (cloud deployment), this will be replaced by Redis Streams
 * or a similar durable message broker, with no changes required to the components
 * that use it.
 *
 * Supported events in Phase 1:
 *   - signal_received: Emitted by SignalGateway when a new signal is stored
 *
 * Future events (Phase 2+):
 *   - signal_processed: Emitted by Six-Layer Engine after processing
 *   - state_updated: Emitted by State Mutation Engine after a world state write
 *   - review_required: Emitted when a signal or action requires human review
 *   - action_proposed: Emitted by Layer 6 when actions are ready for execution
 */

import { EventEmitter } from "node:events";

// ─── Event Payload Types ──────────────────────────────────────────────────────

export interface SignalReceivedPayload {
  signalId: string;
  sourceKind: string;
  title: string;
  observedAt: string;
}

export interface SignalProcessedPayload {
  signalId: string;
  processingRecordId: string;
  proposedActionCount: number;
  requiresReview: boolean;
}

export interface StateUpdatedPayload {
  signalId: string;
  entityIds: string[];
  mutationCount: number;
}

export interface ReviewRequiredPayload {
  signalId: string;
  reason: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}

// ─── Event Map ────────────────────────────────────────────────────────────────

export interface AxiomEvents {
  signal_received: SignalReceivedPayload;
  signal_processed: SignalProcessedPayload;
  state_updated: StateUpdatedPayload;
  review_required: ReviewRequiredPayload;
}

export type AxiomEventName = keyof AxiomEvents;

// ─── EventBus Class ───────────────────────────────────────────────────────────

export class EventBus {
  private readonly emitter: EventEmitter;
  private readonly eventLog: Array<{ event: string; payload: unknown; timestamp: string }> = [];

  constructor() {
    this.emitter = new EventEmitter();
    // Increase max listeners to avoid warnings in test environments
    this.emitter.setMaxListeners(50);
  }

  /**
   * Emit an event with a typed payload.
   */
  emit<K extends AxiomEventName>(event: K, payload: AxiomEvents[K]): void {
    const entry = { event, payload, timestamp: new Date().toISOString() };
    this.eventLog.push(entry);
    this.emitter.emit(event, payload);
  }

  /**
   * Subscribe to an event.
   */
  on<K extends AxiomEventName>(
    event: K,
    listener: (payload: AxiomEvents[K]) => void
  ): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Subscribe to an event once.
   */
  once<K extends AxiomEventName>(
    event: K,
    listener: (payload: AxiomEvents[K]) => void
  ): void {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Remove a listener.
   */
  off<K extends AxiomEventName>(
    event: K,
    listener: (payload: AxiomEvents[K]) => void
  ): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Returns the full in-memory event log for this session.
   * Useful for debugging and testing.
   */
  getLog(): Array<{ event: string; payload: unknown; timestamp: string }> {
    return [...this.eventLog];
  }

  /**
   * Clears all listeners and the event log. Used in tests.
   */
  reset(): void {
    this.emitter.removeAllListeners();
    this.eventLog.length = 0;
  }
}

// Singleton instance for use across the application
export const eventBus = new EventBus();
