/**
 * StateMutationEngine
 *
 * Translates the structured output of the Six-Layer Processor (a ProcessingResult)
 * into durable, provenance-stamped mutations in the WorldStateStore.
 *
 * Responsibilities:
 *   1. Layer 3 → State Updates: Apply entity field changes to the world state store
 *   2. Layer 4 → Obligations: Create or update obligation records
 *   3. Layer 3 → Contradictions: Record ambiguities flagged by the processor
 *   4. Noise signals: Skip mutation entirely — noise signals produce no state changes
 *   5. Emit state_updated on the EventBus when mutations are applied
 *
 * Rules enforced:
 *   - No state mutation without a source signal and processing record (provenance)
 *   - Contradictions are recorded, never silently resolved
 *   - Noise signals are archived without any state changes
 *   - All mutations are idempotent-safe (duplicate processing won't double-create)
 */

import { WorldStateStore } from "./world_state_store.js";
import { EntityStore } from "../entities/entity_store.js";
import { EventBus } from "../event_bus.js";
import { ProcessingResult } from "../../schema/processing.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MutationSummary {
  signal_id: string;
  processing_id: string;
  skipped_noise: boolean;
  obligations_created: number;
  obligations_updated: number;
  state_updates_applied: number;
  contradictions_recorded: number;
  entity_ids_affected: string[];
}

// ─── StateMutationEngine ──────────────────────────────────────────────────────

export interface StateMutationEngineOptions {
  worldStateStore: WorldStateStore;
  entityStore: EntityStore;
  eventBus: EventBus;
}

export class StateMutationEngine {
  private readonly worldStateStore: WorldStateStore;
  private readonly entityStore: EntityStore;
  private readonly eventBus: EventBus;

  constructor(options: StateMutationEngineOptions) {
    this.worldStateStore = options.worldStateStore;
    this.entityStore = options.entityStore;
    this.eventBus = options.eventBus;
  }

  /**
   * Applies all mutations implied by a ProcessingResult to the WorldStateStore.
   * Returns a summary of what was written.
   */
  apply(result: ProcessingResult): MutationSummary {
    const summary: MutationSummary = {
      signal_id: result.signal_id,
      processing_id: result.id,
      skipped_noise: false,
      obligations_created: 0,
      obligations_updated: 0,
      state_updates_applied: 0,
      contradictions_recorded: 0,
      entity_ids_affected: [],
    };

    // ── Noise signals: skip all mutations ────────────────────────────────────
    if (result.is_noise) {
      summary.skipped_noise = true;
      return summary;
    }

    // ── Layer 3: Apply state updates ─────────────────────────────────────────
    for (const update of result.layer_3.state_updates) {
      // Check for contradiction: if the field already has a value that differs
      const existingValue = this.worldStateStore.getCurrentFieldValue(
        update.entity_label,
        update.field
      );

      if (
        existingValue !== undefined &&
        existingValue !== update.new_value
      ) {
        // Record contradiction — do NOT silently overwrite
        this.worldStateStore.recordContradiction({
          description: `Conflicting value for ${update.entity_label}.${update.field}: existing "${existingValue}" vs incoming "${update.new_value}"`,
          entity_label: update.entity_label,
          entity_domain: update.entity_domain,
          field: update.field,
          existing_value: existingValue,
          incoming_value: update.new_value,
          source_signal_id: result.signal_id,
          source_processing_id: result.id,
        });
        summary.contradictions_recorded++;
        // Still apply the update — but it's flagged in contradictions
      }

      this.worldStateStore.applyStateUpdate({
        entity_id: this.resolveEntityId(update.entity_label, update.entity_domain),
        entity_label: update.entity_label,
        entity_domain: update.entity_domain,
        field: update.field,
        previous_value: existingValue,
        new_value: update.new_value,
        source_fact: update.source_fact,
        source_signal_id: result.signal_id,
        source_processing_id: result.id,
      });
      summary.state_updates_applied++;

      // Track affected entity IDs
      const entityId = this.resolveEntityId(update.entity_label, update.entity_domain);
      if (entityId && !summary.entity_ids_affected.includes(entityId)) {
        summary.entity_ids_affected.push(entityId);
      }
    }

    // ── Layer 3: Record ambiguities as contradictions ─────────────────────────
    for (const ambiguity of result.layer_3.ambiguities) {
      this.worldStateStore.recordContradiction({
        description: ambiguity.description,
        entity_label: ambiguity.entities_involved[0] ?? "unknown",
        entity_domain: "unknown",
        source_signal_id: result.signal_id,
        source_processing_id: result.id,
      });
      summary.contradictions_recorded++;
    }

    // ── Layer 4: Create new obligations ──────────────────────────────────────
    for (const obligation of result.layer_4.new_obligations) {
      this.worldStateStore.createObligation({
        title: obligation.title,
        description: obligation.description,
        owed_by: obligation.owed_by,
        owed_to: obligation.owed_to,
        workspace_hint: obligation.workspace_hint,
        priority: obligation.priority as "critical" | "high" | "medium" | "low",
        due_hint: obligation.due_hint,
        source_signal_id: result.signal_id,
        source_processing_id: result.id,
        source_fact: obligation.source_fact,
      });
      summary.obligations_created++;
    }

    // ── Layer 4: Update existing obligations ─────────────────────────────────
    for (const obligation of result.layer_4.updated_obligations) {
      // Find matching open obligation by title similarity
      const existing = this.worldStateStore
        .getAllObligations()
        .find(
          (o) =>
            o.status === "open" &&
            o.title.toLowerCase().includes(obligation.title.toLowerCase().slice(0, 20))
        );

      if (existing) {
        this.worldStateStore.updateObligationStatus(
          existing.id,
          "open",
          `Updated from signal ${result.signal_id}: ${obligation.description}`,
          result.signal_id
        );
        summary.obligations_updated++;
      } else {
        // If no match found, create as new
        this.worldStateStore.createObligation({
          title: obligation.title,
          description: obligation.description,
          owed_by: obligation.owed_by,
          owed_to: obligation.owed_to,
          workspace_hint: obligation.workspace_hint,
          priority: obligation.priority as "critical" | "high" | "medium" | "low",
          due_hint: obligation.due_hint,
          source_signal_id: result.signal_id,
          source_processing_id: result.id,
          source_fact: obligation.source_fact,
        });
        summary.obligations_created++;
      }
    }

    // ── Emit state_updated event ──────────────────────────────────────────────
    if (
      summary.state_updates_applied > 0 ||
      summary.obligations_created > 0 ||
      summary.obligations_updated > 0
    ) {
      this.eventBus.emit("state_updated", {
        signalId: result.signal_id,
        entityIds: summary.entity_ids_affected,
        mutationCount:
          summary.state_updates_applied +
          summary.obligations_created +
          summary.obligations_updated,
      });
    }

    return summary;
  }

  /**
   * Resolves an entity label to its canonical ID in the EntityStore.
   * Returns empty string if not found (entity may not have been resolved yet).
   */
  private resolveEntityId(label: string, domain: string): string {
    const matches = this.entityStore.findByDomain(domain as never);
    const match = matches.find(
      (e) =>
        e.canonical_name.toLowerCase() === label.toLowerCase() ||
        e.aliases.some((a) => a.value.toLowerCase() === label.toLowerCase())
    );
    return match?.id ?? "";
  }
}
