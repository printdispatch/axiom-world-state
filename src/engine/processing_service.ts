/**
 * ProcessingService
 *
 * Wires the SixLayerProcessor to the EventBus.
 * Listens for `signal_received` events and automatically triggers processing.
 * Emits `signal_processed` when complete, or `review_required` if the result
 * contains high-risk actions or ambiguities.
 *
 * This is the glue layer between the Signal Pipeline (Phase 1) and the
 * Six-Layer Engine (Phase 2). It keeps both components decoupled.
 */

import { EventBus } from "../event_bus.js";
import { SignalStore } from "../signals/signal_store.js";
import { SixLayerProcessor, SixLayerProcessorOptions } from "./six_layer_processor.js";
import { ProcessingResult } from "../../schema/processing.js";

export interface ProcessingServiceOptions {
  eventBus: EventBus;
  signalStore: SignalStore;
  processor?: SixLayerProcessor;
  processorOptions?: SixLayerProcessorOptions;
}

export class ProcessingService {
  private readonly eventBus: EventBus;
  private readonly signalStore: SignalStore;
  private readonly processor: SixLayerProcessor;

  constructor(options: ProcessingServiceOptions) {
    this.eventBus = options.eventBus;
    this.signalStore = options.signalStore;
    this.processor =
      options.processor ?? new SixLayerProcessor(options.processorOptions);
  }

  /**
   * Starts listening for `signal_received` events on the EventBus.
   * Call this once at application startup.
   */
  start(): void {
    this.eventBus.on("signal_received", async (payload) => {
      await this.handleSignalReceived(payload.signalId);
    });
  }

  /**
   * Processes a single signal by ID.
   * Can be called directly for testing or manual processing.
   */
  async processSignal(signalId: string): Promise<ProcessingResult> {
    const signal = this.signalStore.findById(signalId);
    if (!signal) {
      throw new Error(`ProcessingService: Signal not found: id="${signalId}"`);
    }

    const result = await this.processor.process(signal);

    // Mark the signal as processed in the store
    this.signalStore.markProcessed(signalId);

    // Emit signal_processed event
    this.eventBus.emit("signal_processed", {
      signalId: signal.id,
      processingRecordId: result.id,
      proposedActionCount: result.layer_6.proposed_actions.length,
      requiresReview: result.layer_6.any_requires_approval,
    });

    // If any proposed action requires approval, also emit review_required
    if (result.layer_6.any_requires_approval && !result.is_noise) {
      const highRiskAction = result.layer_6.proposed_actions.find(
        (a) => a.requires_approval
      );
      if (highRiskAction) {
        this.eventBus.emit("review_required", {
          signalId: signal.id,
          reason: highRiskAction.rationale,
          riskLevel: highRiskAction.risk as "low" | "medium" | "high" | "critical",
        });
      }
    }

    return result;
  }

  /**
   * Internal handler for signal_received events.
   */
  private async handleSignalReceived(signalId: string): Promise<void> {
    try {
      await this.processSignal(signalId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[ProcessingService] Failed to process signal ${signalId}: ${message}`
      );
    }
  }
}
