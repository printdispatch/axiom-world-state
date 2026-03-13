/**
 * ProcessingService
 *
 * Orchestrates the full signal processing pipeline:
 *   1. Listens for `signal_received` events on the EventBus
 *   2. Runs the signal through the SixLayerProcessor (Phase 2)
 *   3. Passes Layer 2 entity candidates to the EntityResolver (Phase 3)
 *   4. Applies state mutations via the StateMutationEngine (Phase 4)
 *   5. Emits `signal_processed` when complete
 *   6. Emits `review_required` for high-risk actions or entity conflicts
 *
 * This service keeps all components decoupled — the processor, resolver,
 * mutation engine, and stores never reference each other directly.
 */

import { EventBus } from "../event_bus.js";
import { SignalStore } from "../signals/signal_store.js";
import { SixLayerProcessor, SixLayerProcessorOptions } from "./six_layer_processor.js";
import { EntityResolver, EntityResolutionSummary } from "../entities/entity_resolver.js";
import { StateMutationEngine, MutationSummary } from "../state/state_mutation_engine.js";
import { ProcessingResult } from "../../schema/processing.js";

export interface ProcessingServiceOptions {
  eventBus: EventBus;
  signalStore: SignalStore;
  processor?: SixLayerProcessor;
  processorOptions?: SixLayerProcessorOptions;
  /** Optional EntityResolver. If provided, entity resolution runs after processing. */
  entityResolver?: EntityResolver;
  /** Optional StateMutationEngine. If provided, state mutations run after entity resolution. */
  mutationEngine?: StateMutationEngine;
}

export class ProcessingService {
  private readonly eventBus: EventBus;
  private readonly signalStore: SignalStore;
  private readonly processor: SixLayerProcessor;
  private readonly entityResolver: EntityResolver | null;
  private readonly mutationEngine: StateMutationEngine | null;

  constructor(options: ProcessingServiceOptions) {
    this.eventBus = options.eventBus;
    this.signalStore = options.signalStore;
    this.processor =
      options.processor ?? new SixLayerProcessor(options.processorOptions);
    this.entityResolver = options.entityResolver ?? null;
    this.mutationEngine = options.mutationEngine ?? null;
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
   * Processes a single signal by ID through the full pipeline.
   * Can be called directly for testing or manual processing.
   *
   * Returns the ProcessingResult, EntityResolutionSummary, and MutationSummary.
   */
  async processSignal(signalId: string): Promise<{
    processingResult: ProcessingResult;
    resolutionSummary: EntityResolutionSummary | null;
    mutationSummary: MutationSummary | null;
  }> {
    const signal = this.signalStore.findById(signalId);
    if (!signal) {
      throw new Error(`ProcessingService: Signal not found: id="${signalId}"`);
    }

    // ── Step 1: Six-Layer Processing ─────────────────────────────────────────
    const processingResult = await this.processor.process(signal);

    // Mark the signal as processed in the store
    this.signalStore.markProcessed(signalId);

    // ── Step 2: Entity Resolution (if resolver is configured) ────────────────
    let resolutionSummary: EntityResolutionSummary | null = null;
    if (this.entityResolver && !processingResult.is_noise) {
      resolutionSummary = this.entityResolver.resolve(
        signalId,
        processingResult.layer_2
      );
    }

    // ── Step 3: State Mutation (if engine is configured) ─────────────────────
    let mutationSummary: MutationSummary | null = null;
    if (this.mutationEngine) {
      mutationSummary = this.mutationEngine.apply(processingResult);
    }

    // ── Step 4: Emit signal_processed ────────────────────────────────────────
    this.eventBus.emit("signal_processed", {
      signalId: signal.id,
      processingRecordId: processingResult.id,
      proposedActionCount: processingResult.layer_6.proposed_actions.length,
      requiresReview: processingResult.layer_6.any_requires_approval,
    });

    // ── Step 5: Emit review_required for high-risk actions ───────────────────
    if (processingResult.layer_6.any_requires_approval && !processingResult.is_noise) {
      const highRiskAction = processingResult.layer_6.proposed_actions.find(
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

    return { processingResult, resolutionSummary, mutationSummary };
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
