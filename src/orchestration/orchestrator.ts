/**
 * Orchestrator
 *
 * The "Pulse" of the Axiom system. Drives the Ceremonial Loop:
 *
 *   1. OBSERVE   — Load a pending Episode
 *   2. INTERPRET — Call CognitionService to produce a Delta
 *   3. COMMIT    — Apply the Delta to the World State
 *   4. DELIBERATE — Optionally run a deliberation pass
 *
 * The Orchestrator is the ONLY component that writes to the World State.
 * The CognitionService only reads state and produces Deltas.
 * Adapters only produce Episodes.
 *
 * This strict separation prevents "haunted-house plumbing" where state
 * mutations happen from random places in the codebase.
 */

import { randomUUID } from "node:crypto";
import { Episode } from "../../schema/episodes.js";
import { Delta } from "../../schema/delta.js";
import { EpisodeStore } from "../episodes/episode_store.js";
import { DeltaStore } from "../episodes/delta_store.js";
import { CognitionService, WorldContext } from "../engine/cognition_service.js";
import { EventBus } from "../event_bus.js";

// ─── Entity Store interface (matches existing entities.json shape) ────────────

interface EntityRecord {
  id: string;
  name: string;
  type: string;
  lookup_key?: string;
  source_signal_id?: string;
  source_episode_id?: string;
  created_at: string;
  updated_at: string;
  aliases: string[];
  facts?: Array<{ property: string; value: string; valid_from: string; confidence: number; source_fact: string }>;
  confidence?: number;
}

// ─── Obligation Store interface (matches existing obligations.json shape) ──────

interface ObligationRecord {
  id: string;
  title: string;
  description: string;
  owed_by: string;
  owed_to: string;
  workspace_hint?: string;
  priority: string;
  status: string;
  due_hint?: string;
  source_signal_id?: string;
  source_episode_id?: string;
  created_at: string;
  last_updated_at: string;
  history: Array<{ status: string; changed_at: string; reason: string; source_episode_id: string }>;
  confidence?: number;
}

// ─── Commit Result ────────────────────────────────────────────────────────────

export interface CommitResult {
  delta_id: string;
  episode_id: string;
  entities_created: number;
  entities_updated: number;
  obligations_created: number;
  obligations_updated: number;
  facts_recorded: number;
  contradictions_flagged: number;
  committed_at: string;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  episodeStore: EpisodeStore;
  deltaStore: DeltaStore;
  cognitionService: CognitionService;
  eventBus: EventBus;
  entityStore: EntityStore;
  obligationStore: ObligationStore;
}

// Simple interfaces for the stores we need
export interface EntityStore {
  findAll(): EntityRecord[];
  findById(id: string): EntityRecord | undefined;
  create(entity: Omit<EntityRecord, "id" | "created_at" | "updated_at">): EntityRecord;
  update(id: string, changes: Partial<EntityRecord>): EntityRecord;
  findByName(name: string): EntityRecord | undefined;
  findByLookupKey(key: string): EntityRecord | undefined;
}

export interface ObligationStore {
  findAll(): ObligationRecord[];
  findOpen(): ObligationRecord[];
  create(obligation: Omit<ObligationRecord, "id" | "created_at" | "last_updated_at" | "history">): ObligationRecord;
  update(id: string, changes: Partial<ObligationRecord>): ObligationRecord;
  findById(id: string): ObligationRecord | undefined;
}

export class Orchestrator {
  private readonly episodeStore: EpisodeStore;
  private readonly deltaStore: DeltaStore;
  private readonly cognitionService: CognitionService;
  private readonly eventBus: EventBus;
  private readonly entityStore: EntityStore;
  private readonly obligationStore: ObligationStore;
  private isRunning = false;

  constructor(options: OrchestratorOptions) {
    this.episodeStore = options.episodeStore;
    this.deltaStore = options.deltaStore;
    this.cognitionService = options.cognitionService;
    this.eventBus = options.eventBus;
    this.entityStore = options.entityStore;
    this.obligationStore = options.obligationStore;
  }

  /**
   * Start listening for episode_observed events.
   * When an episode arrives, run the full ceremonial loop.
   */
  start(): void {
    this.eventBus.on("episode_observed", async (payload: { episodeId: string }) => {
      await this.runLoop(payload.episodeId);
    });
    console.log("[Orchestrator] Listening for episodes...");
  }

  /**
   * Process a single episode by ID.
   * Can be called directly for manual processing or batch runs.
   */
  async runLoop(episodeId: string): Promise<CommitResult | null> {
    if (this.isRunning) {
      console.log(`[Orchestrator] Already running, queuing ${episodeId}`);
    }

    const episode = this.episodeStore.findById(episodeId);
    if (!episode) {
      console.error(`[Orchestrator] Episode not found: ${episodeId}`);
      return null;
    }

    if (episode.status === "committed" || episode.status === "noise") {
      console.log(`[Orchestrator] Episode ${episodeId} already processed (${episode.status}), skipping`);
      return null;
    }

    console.log(`[Orchestrator] Starting loop for episode: ${episode.title}`);

    // ── STEP 1: OBSERVE ────────────────────────────────────────────────────────
    this.episodeStore.updateStatus(episodeId, "interpreting");

    try {
      // ── STEP 2: INTERPRET ──────────────────────────────────────────────────
      const worldContext = this.buildWorldContext();
      const delta = await this.cognitionService.interpret(episode, worldContext);

      // Persist the Delta immediately (even before commit, for audit trail)
      this.deltaStore.append(delta);

      if (delta.is_noise) {
        this.episodeStore.updateStatus(episodeId, "noise", {
          is_noise: true,
          noise_reason: delta.noise_reason,
          delta_id: delta.id,
        });
        console.log(`[Orchestrator] Episode ${episodeId} classified as noise: ${delta.noise_reason}`);
        this.eventBus.emit("episode_processed", { episodeId, deltaId: delta.id, isNoise: true, commitResult: undefined, proposedActions: [] });
        return null;
      }

      // ── STEP 3: COMMIT ─────────────────────────────────────────────────────
      const commitResult = await this.commitDelta(delta, episode);

      // Mark episode as committed
      this.episodeStore.updateStatus(episodeId, "committed", {
        delta_id: delta.id,
        committed_at: commitResult.committed_at,
      });

      // ── STEP 4: DELIBERATE ─────────────────────────────────────────────────
      // Emit event so other services can react (e.g., notify user, update UI)
      this.eventBus.emit("episode_processed", {
        episodeId,
        deltaId: delta.id,
        isNoise: false,
        commitResult: commitResult as unknown as Record<string, unknown>,
        proposedActions: delta.proposed_actions,
      });

      console.log(`[Orchestrator] Loop complete for ${episodeId}: ${commitResult.entities_created} entities created, ${commitResult.obligations_created} obligations created`);

      return commitResult;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Orchestrator] Loop failed for ${episodeId}: ${message}`);
      this.episodeStore.updateStatus(episodeId, "failed", { error: message });
      return null;
    }
  }

  /**
   * Process all pending episodes in order.
   * Used for batch processing of existing signals.
   */
  async processPending(): Promise<{ processed: number; failed: number; noise: number }> {
    const pending = this.episodeStore.findByStatus("pending");
    let processed = 0, failed = 0, noise = 0;

    console.log(`[Orchestrator] Processing ${pending.length} pending episodes...`);

    for (const episode of pending) {
      const result = await this.runLoop(episode.id);
      if (result === null) {
        const updated = this.episodeStore.findById(episode.id);
        if (updated?.status === "noise") noise++;
        else if (updated?.status === "failed") failed++;
      } else {
        processed++;
      }
      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return { processed, failed, noise };
  }

  // ─── COMMIT ────────────────────────────────────────────────────────────────

  private async commitDelta(delta: Delta, episode: Episode): Promise<CommitResult> {
    const result: CommitResult = {
      delta_id: delta.id,
      episode_id: episode.id,
      entities_created: 0,
      entities_updated: 0,
      obligations_created: 0,
      obligations_updated: 0,
      facts_recorded: 0,
      contradictions_flagged: 0,
      committed_at: new Date().toISOString(),
    };

    // ── Apply entity changes ───────────────────────────────────────────────────
    for (const change of delta.entity_changes) {
      if (change.type === "create") {
        // Check for duplicates by name or lookup_key
        const existing = change.lookup_key
          ? this.entityStore.findByLookupKey(change.lookup_key)
          : this.entityStore.findByName(change.name);

        if (existing) {
          // Already exists — update aliases if needed
          const newAliases = [...new Set([...existing.aliases, change.name])];
          this.entityStore.update(existing.id, {
            aliases: newAliases,
            updated_at: new Date().toISOString(),
            source_episode_id: episode.id,
          });
          result.entities_updated++;
        } else {
          this.entityStore.create({
            name: change.name,
            type: change.entity_type,
            lookup_key: change.lookup_key,
            aliases: change.aliases ?? [change.name],
            source_episode_id: episode.id,
            confidence: change.confidence,
          });
          result.entities_created++;
        }
      } else if (change.type === "update") {
        // Gracefully handle stale entity IDs — model may reference an ID that no longer exists
        // after a data wipe. Fall back to a name-match or create.
        const existingById = this.entityStore.findById(change.entity_id);
        if (existingById) {
          this.entityStore.update(change.entity_id, {
            ...change.changes,
            updated_at: new Date().toISOString(),
            source_episode_id: episode.id,
          });
          result.entities_updated++;
        } else {
          // Try to find by name before creating
          const byName = this.entityStore.findByName(change.entity_name ?? "");
          if (byName) {
            this.entityStore.update(byName.id, {
              ...change.changes,
              updated_at: new Date().toISOString(),
              source_episode_id: episode.id,
            });
            result.entities_updated++;
          } else {
            // Entity doesn't exist — treat as create
            this.entityStore.create({
              name: change.entity_name ?? "Unknown Entity",
              type: (change.changes as Record<string, string>)["type"] ?? "organization",
              aliases: [],
              source_episode_id: episode.id,
            });
            result.entities_created++;
          }
        }
      }
    }

    // ── Apply obligation changes ───────────────────────────────────────────────
    for (const change of delta.obligation_changes) {
      if (change.type === "create") {
        this.obligationStore.create({
          title: change.title,
          description: change.description,
          owed_by: change.owed_by,
          owed_to: change.owed_to,
          workspace_hint: change.workspace_hint,
          priority: change.priority,
          status: "open",
          due_hint: change.due_hint,
          source_episode_id: episode.id,
          confidence: change.confidence,
        });
        result.obligations_created++;
      } else if (change.type === "update") {
        const existing = this.obligationStore.findById(change.obligation_id);
        if (existing) {
          this.obligationStore.update(change.obligation_id, {
            status: change.new_status,
            last_updated_at: new Date().toISOString(),
            history: [
              ...existing.history,
              {
                status: existing.status,
                changed_at: new Date().toISOString(),
                reason: change.reason,
                source_episode_id: episode.id,
              },
            ],
          });
          result.obligations_updated++;
        }
      }
    }

    // ── Record facts ──────────────────────────────────────────────────────────
    for (const factChange of delta.fact_changes) {
      // Find the entity and append the fact to its facts array
      const entity = this.entityStore.findByName(factChange.entity_name);
      if (entity) {
        const existingFacts = entity.facts ?? [];
        this.entityStore.update(entity.id, {
          facts: [
            ...existingFacts,
            {
              property: factChange.property,
              value: factChange.value,
              valid_from: factChange.valid_from,
              confidence: factChange.confidence,
              source_fact: factChange.source_fact,
            },
          ],
          updated_at: new Date().toISOString(),
        });
        result.facts_recorded++;
      }
    }

    // ── Flag contradictions ───────────────────────────────────────────────────
    result.contradictions_flagged = delta.contradictions_found.length;

    return result;
  }

  // ─── World Context ─────────────────────────────────────────────────────────

  private buildWorldContext(): WorldContext {
    const entities = this.entityStore.findAll().map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      aliases: e.aliases,
    }));

    const open_obligations = this.obligationStore.findOpen().map((o) => ({
      id: o.id,
      title: o.title,
      owed_by: o.owed_by,
      owed_to: o.owed_to,
      status: o.status,
    }));

    // Recent facts from entity store
    const recent_facts: WorldContext["recent_facts"] = [];
    for (const entity of this.entityStore.findAll()) {
      for (const fact of entity.facts ?? []) {
        recent_facts.push({
          entity_name: entity.name,
          property: fact.property,
          value: fact.value,
          valid_from: fact.valid_from,
        });
      }
    }

    return { entities, open_obligations, recent_facts };
  }
}
