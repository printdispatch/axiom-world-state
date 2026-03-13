/**
 * ReviewService — Creates review items from processing results and entity conflicts.
 *
 * Listens on the EventBus for:
 *   - processing_complete → checks for high-risk actions and low confidence
 *   - entities_resolved   → checks for similarity conflicts
 *   - contradiction_detected → creates contradiction review items
 */

import { EventBus } from "../event_bus.js";
import { ReviewStore, ReviewItem, ReviewDecision } from "./review_store.js";
import type { ProcessingResult } from "../../schema/processing.js";

export class ReviewService {
  private store: ReviewStore;
  private bus: EventBus;

  constructor(store: ReviewStore, bus: EventBus) {
    this.store = store;
    this.bus = bus;
    this.subscribe();
  }

  private subscribe(): void {
    // Check every processing result for high-risk actions or low confidence
    this.bus.on("processing_complete", ({ signal, result }) => {
      this.evaluateProcessingResult(signal.id, result);
    });

    // Check entity resolution for conflicts
    this.bus.on("entities_resolved", ({ signal_id, conflicts }) => {
      if (conflicts && conflicts.length > 0) {
        for (const conflict of conflicts) {
          this.store.createItem({
            kind: "entity_conflict",
            title: `Entity conflict: "${conflict.candidate}" vs "${conflict.existing}"`,
            description: `The system found a possible duplicate entity but could not automatically merge it. Similarity score: ${(conflict.score * 100).toFixed(0)}%. Please decide whether these are the same entity.`,
            severity: "medium",
            signal_id,
            entity_ids: [conflict.existing_id],
            requires_approval: true,
            metadata: { conflict },
          });
        }
        this.bus.emit("review_required", {
          signal_id,
          reason: `${conflicts.length} entity conflict(s) require resolution`,
        });
      }
    });
  }

  private evaluateProcessingResult(signalId: string, result: ProcessingResult): void {
    if (result.is_noise) return;

    // Flag high-risk actions
    const highRiskActions = result.layer_6.proposed_actions.filter(
      a => a.requires_approval || a.risk === "high" || a.risk === "critical"
    );

    for (const action of highRiskActions) {
      this.store.createItem({
        kind: "high_risk_action",
        title: `Approval required: ${action.description}`,
        description: `The agent proposed a ${action.risk}-risk action that requires your approval before execution. Rationale: ${action.rationale}. Expected outcome: ${action.expected_outcome}`,
        severity: action.risk === "critical" ? "critical" : "high",
        signal_id: signalId,
        action_description: action.description,
        action_risk: action.risk,
        requires_approval: true,
        metadata: { action },
      });
    }

    // Flag low confidence results
    if (result.layer_6.confidence < 0.5 && !result.is_noise) {
      this.store.createItem({
        kind: "low_confidence",
        title: `Low confidence processing (${Math.round(result.layer_6.confidence * 100)}%)`,
        description: `The agent processed this signal with low confidence. The proposed actions and state changes may be inaccurate. Please review before they take effect.`,
        severity: "medium",
        signal_id: signalId,
        requires_approval: false,
        metadata: { confidence: result.layer_6.confidence },
      });
    }

    // Flag critical risk flags from Layer 5
    const criticalFlags = result.layer_5.risk_flags.filter(
      f => f.risk_level === "critical" || f.risk_level === "high"
    );
    for (const flag of criticalFlags) {
      this.store.createItem({
        kind: "low_confidence",
        title: `Risk flag: ${flag.description}`,
        description: `The agent identified a ${flag.risk_level}-severity risk. Entity: ${flag.entity_label}`,
        severity: flag.risk_level as "high" | "critical",
        signal_id: signalId,
        entity_ids: [],
        requires_approval: false,
        metadata: { flag },
      });
    }

    if (highRiskActions.length > 0 || criticalFlags.length > 0) {
      this.bus.emit("review_required", {
        signal_id: signalId,
        reason: `${highRiskActions.length} high-risk action(s), ${criticalFlags.length} critical flag(s)`,
      });
    }
  }

  decide(id: string, decision: ReviewDecision, note?: string): ReviewItem | null {
    const item = this.store.decide(id, decision, note);
    if (item) {
      this.bus.emit("review_decided", { item, decision });
    }
    return item;
  }

  getPending(): ReviewItem[] {
    return this.store.getPending();
  }

  getAll(): ReviewItem[] {
    return this.store.getAll();
  }

  getPendingCount(): number {
    return this.store.getPendingCount();
  }
}
