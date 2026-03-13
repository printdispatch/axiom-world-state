/**
 * EntityResolver
 *
 * The gatekeeper between raw entity candidates (from the Six-Layer Processor)
 * and the canonical entity store. Its job is to ensure that every entity
 * candidate from a ProcessingResult either:
 *   a) Resolves to an existing canonical entity (merge), or
 *   b) Is created as a new canonical entity (create)
 *
 * It enforces the "merge-before-create" rule: before creating any new entity,
 * the resolver must check whether a sufficiently similar entity already exists.
 *
 * Similarity detection strategy (in order of priority):
 *   1. Exact name match (case-insensitive, trimmed) → always merge
 *   2. Email address match (for person entities) → always merge
 *   3. Normalized token overlap score (Jaccard similarity) → merge if ≥ threshold
 *   4. No match → create new entity
 *
 * The threshold for token overlap is configurable (default: 0.65).
 * Conflicts below the threshold but above a lower bound (0.4) are flagged
 * as similarity_conflicts and emitted as review_required events.
 *
 * This is an intentionally offline/synchronous implementation — no LLM calls
 * are made in the resolver itself. The LLM already extracted entity candidates
 * in Layer 2; the resolver's job is purely structural deduplication.
 */

import { EntityStore, CanonicalEntity, EntityDomain } from "./entity_store.js";
import { EventBus } from "../event_bus.js";
import { Layer2EntityLinking } from "../../schema/processing.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityCandidate {
  label: string;
  domain: EntityDomain;
  /** Optional email address (used for exact-match on person entities) */
  email?: string;
  /** Optional attributes to carry forward */
  attributes?: Record<string, string | number | boolean | null>;
}

export interface ResolutionResult {
  candidate: EntityCandidate;
  action: "merged" | "created" | "conflict_flagged";
  entity: CanonicalEntity;
  similarity_score?: number;
  conflict_with?: string;
}

export interface EntityResolutionSummary {
  signal_id: string;
  results: ResolutionResult[];
  merged_count: number;
  created_count: number;
  conflict_count: number;
}

// ─── Similarity Utilities ─────────────────────────────────────────────────────

/**
 * Normalizes a name for comparison:
 * - Lowercase
 * - Remove punctuation except hyphens and apostrophes
 * - Collapse whitespace
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenizes a normalized name into a set of meaningful tokens.
 * Filters out common stop words that add noise (Inc, LLC, Co, etc.)
 */
const STOP_WORDS = new Set([
  "inc", "llc", "ltd", "co", "corp", "the", "and", "of", "for",
  "a", "an", "in", "on", "at", "to", "by", "with", "from",
]);

function tokenize(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  );
}

/**
 * Computes Jaccard similarity between two token sets.
 * Returns a value between 0.0 (no overlap) and 1.0 (identical).
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/**
 * Computes a similarity score between a candidate name and an existing entity.
 * Returns a score between 0.0 and 1.0.
 */
function computeSimilarity(
  candidateName: string,
  entity: CanonicalEntity
): number {
  const candidateNorm = normalizeName(candidateName);
  const entityNorm = normalizeName(entity.canonical_name);

  // Exact match
  if (candidateNorm === entityNorm) return 1.0;

  // Check aliases for exact match
  for (const alias of entity.aliases) {
    if (normalizeName(alias.value) === candidateNorm) return 1.0;
  }

  // Token overlap (Jaccard)
  const candidateTokens = tokenize(candidateNorm);
  const entityTokens = tokenize(entityNorm);
  let maxScore = jaccardSimilarity(candidateTokens, entityTokens);

  // Also check alias token overlap
  for (const alias of entity.aliases) {
    const aliasTokens = tokenize(normalizeName(alias.value));
    const aliasScore = jaccardSimilarity(candidateTokens, aliasTokens);
    if (aliasScore > maxScore) maxScore = aliasScore;
  }

  return maxScore;
}

// ─── EntityResolver ───────────────────────────────────────────────────────────

export interface EntityResolverOptions {
  store: EntityStore;
  eventBus: EventBus;
  /** Similarity score at or above which entities are merged. Default: 0.65 */
  mergeThreshold?: number;
  /** Similarity score above which a conflict is flagged for review. Default: 0.4 */
  conflictThreshold?: number;
}

export class EntityResolver {
  private readonly store: EntityStore;
  private readonly eventBus: EventBus;
  private readonly mergeThreshold: number;
  private readonly conflictThreshold: number;

  constructor(options: EntityResolverOptions) {
    this.store = options.store;
    this.eventBus = options.eventBus;
    this.mergeThreshold = options.mergeThreshold ?? 0.65;
    this.conflictThreshold = options.conflictThreshold ?? 0.4;
  }

  /**
   * Resolves all entity candidates from a Layer 2 result.
   * For each candidate:
   *   - If a matching entity exists → merge (update the existing entity)
   *   - If a near-match exists → flag as conflict, still create/merge
   *   - If no match → create a new canonical entity
   *
   * Emits EventBus events for conflicts.
   */
  resolve(
    signalId: string,
    layer2: Layer2EntityLinking
  ): EntityResolutionSummary {
    const results: ResolutionResult[] = [];

    for (const candidate of layer2.entity_candidates) {
      const result = this.resolveOne(signalId, {
        label: candidate.label,
        domain: candidate.domain as EntityDomain,
        email: candidate.email,
        attributes: candidate.attributes,
      });
      results.push(result);
    }

    const summary: EntityResolutionSummary = {
      signal_id: signalId,
      results,
      merged_count: results.filter((r) => r.action === "merged").length,
      created_count: results.filter((r) => r.action === "created").length,
      conflict_count: results.filter((r) => r.action === "conflict_flagged").length,
    };

    // Emit a summary event on the EventBus
    this.eventBus.emit("entities_resolved", {
      signalId,
      mergedCount: summary.merged_count,
      createdCount: summary.created_count,
      conflictCount: summary.conflict_count,
    });

    return summary;
  }

  /**
   * Resolves a single entity candidate against the store.
   */
  private resolveOne(
    signalId: string,
    candidate: EntityCandidate
  ): ResolutionResult {
    const samedomainEntities = this.store.findByDomain(candidate.domain);

    // ── Step 1: Check for email exact match (person entities only) ──────────
    if (candidate.email && candidate.domain === "person") {
      const emailMatch = samedomainEntities.find(
        (e) =>
          e.attributes["email"] &&
          String(e.attributes["email"]).toLowerCase() ===
            candidate.email!.toLowerCase()
      );
      if (emailMatch) {
        const updated = this.store.update(emailMatch.id, {
          source_signal_id: signalId,
          new_alias: candidate.label,
          attributes: candidate.attributes,
        });
        return {
          candidate,
          action: "merged",
          entity: updated,
          similarity_score: 1.0,
        };
      }
    }

    // ── Step 2: Find the best name-similarity match in the same domain ───────
    let bestMatch: CanonicalEntity | null = null;
    let bestScore = 0;

    for (const entity of samedomainEntities) {
      const score = computeSimilarity(candidate.label, entity);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entity;
      }
    }

    // ── Step 3: Merge if above threshold ─────────────────────────────────────
    if (bestMatch && bestScore >= this.mergeThreshold) {
      const updated = this.store.update(bestMatch.id, {
        source_signal_id: signalId,
        new_alias:
          normalizeName(candidate.label) !==
          normalizeName(bestMatch.canonical_name)
            ? candidate.label
            : undefined,
        attributes: {
          ...(candidate.attributes ?? {}),
          ...(candidate.email ? { email: candidate.email } : {}),
        },
      });
      return {
        candidate,
        action: "merged",
        entity: updated,
        similarity_score: bestScore,
      };
    }

    // ── Step 4: Flag conflict if above conflict threshold ────────────────────
    if (bestMatch && bestScore >= this.conflictThreshold) {
      // Still create the entity, but flag for review
      const newEntity = this.store.create({
        domain: candidate.domain,
        canonical_name: candidate.label,
        source_signal_id: signalId,
        attributes: {
          ...(candidate.attributes ?? {}),
          ...(candidate.email ? { email: candidate.email } : {}),
        },
      });

      this.eventBus.emit("review_required", {
        signalId,
        reason: `Entity similarity conflict: "${candidate.label}" (new) vs "${bestMatch.canonical_name}" (existing) — score ${bestScore.toFixed(2)}. Manual review required to determine if these are the same entity.`,
        riskLevel: "medium",
      });

      return {
        candidate,
        action: "conflict_flagged",
        entity: newEntity,
        similarity_score: bestScore,
        conflict_with: bestMatch.id,
      };
    }

    // ── Step 5: Create new entity ─────────────────────────────────────────────
    const newEntity = this.store.create({
      domain: candidate.domain,
      canonical_name: candidate.label,
      source_signal_id: signalId,
      attributes: {
        ...(candidate.attributes ?? {}),
        ...(candidate.email ? { email: candidate.email } : {}),
      },
    });

    return {
      candidate,
      action: "created",
      entity: newEntity,
      similarity_score: bestScore,
    };
  }

  /**
   * Merges two entities: the survivor keeps all data from both,
   * and the superseded entity is marked as merged.
   * Returns the updated survivor entity.
   */
  merge(survivorId: string, supersededId: string, signalId: string): CanonicalEntity {
    const superseded = this.store.findById(supersededId);
    if (!superseded) {
      throw new Error(`EntityResolver: Cannot merge — entity not found: "${supersededId}"`);
    }
    const survivor = this.store.findById(survivorId);
    if (!survivor) {
      throw new Error(`EntityResolver: Cannot merge — entity not found: "${survivorId}"`);
    }

    // Transfer all aliases from superseded to survivor
    for (const alias of superseded.aliases) {
      this.store.update(survivorId, {
        source_signal_id: signalId,
        new_alias: alias.value,
      });
    }

    // Transfer canonical name as alias if different
    if (
      normalizeName(superseded.canonical_name) !==
      normalizeName(survivor.canonical_name)
    ) {
      this.store.update(survivorId, {
        source_signal_id: signalId,
        new_alias: superseded.canonical_name,
      });
    }

    // Merge attributes
    this.store.update(survivorId, {
      source_signal_id: signalId,
      attributes: superseded.attributes,
    });

    // Mark superseded as merged
    this.store.supersede(supersededId, survivorId);

    return this.store.findById(survivorId)!;
  }
}
