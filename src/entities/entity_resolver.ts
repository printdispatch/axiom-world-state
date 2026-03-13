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
 * Similarity detection strategy (applied in priority order):
 *   1. Email address exact match (person entities only) → always merge
 *   2. Exact name match (case-insensitive, trimmed) → always merge
 *   3. DBA decomposition — "Acme dba Coyote Building Supplies" is split into
 *      two lookup keys; either matching triggers a merge
 *   4. Substring containment — if one entity's primary token is fully contained
 *      within the other's name, treat as a strong merge signal
 *   5. Jaccard token overlap ≥ mergeThreshold (default 0.65) → merge
 *   6. Jaccard token overlap ≥ conflictThreshold (default 0.40) → conflict flagged
 *   7. No match → create new entity
 *
 * Canonical name promotion:
 *   When merging, the longer (more complete/formal) name is promoted to canonical.
 *   The shorter name is demoted to an alias. This ensures the most informative
 *   name is always the canonical record.
 */

import { EntityStore, CanonicalEntity, EntityDomain } from "./entity_store.js";
import { EventBus } from "../event_bus.js";
import { Layer2EntityLinking } from "../../schema/processing.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityCandidate {
  label: string;
  domain: EntityDomain;
  email?: string;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface ResolutionResult {
  candidate: EntityCandidate;
  action: "merged" | "created" | "conflict_flagged";
  entity: CanonicalEntity;
  similarity_score?: number;
  conflict_with?: string;
  canonical_promoted?: boolean;
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
 * Filters out common stop words and legal suffixes.
 */
const STOP_WORDS = new Set([
  "inc", "llc", "ltd", "co", "corp", "the", "and", "of", "for",
  "a", "an", "in", "on", "at", "to", "by", "with", "from",
  "dba", "doing", "business", "as", "company", "companies",
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
 * Detects and extracts DBA (doing business as) components from a name.
 * Returns an array of name variants to check against the store.
 *
 * Examples:
 *   "Acme Inc dba Coyote Building Supplies" → ["Acme Inc", "Coyote Building Supplies"]
 *   "Coyote Building Supplies (Acme Inc)"   → ["Coyote Building Supplies", "Acme Inc"]
 *   "Acme Inc"                              → ["Acme Inc"]
 */
function extractDbaVariants(name: string): string[] {
  // Pattern: "X dba Y" or "X d/b/a Y" or "X doing business as Y"
  const dbaMatch = name.match(/^(.+?)\s+(?:dba|d\/b\/a|doing business as)\s+(.+)$/i);
  if (dbaMatch) {
    return [dbaMatch[1].trim(), dbaMatch[2].trim()];
  }
  // Pattern: "X (Y)" — parenthetical alternate name
  const parenMatch = name.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (parenMatch) {
    return [parenMatch[1].trim(), parenMatch[2].trim()];
  }
  return [name];
}

/**
 * Checks if one name's primary tokens are fully contained within another name.
 * This catches cases like "Acme" being a subset of "Acme Building Supplies Inc".
 *
 * Returns a score between 0.0 and 1.0 representing containment strength.
 * A score of 1.0 means all tokens of the shorter name appear in the longer name.
 */
function containmentScore(shorter: string, longer: string): number {
  const shorterTokens = tokenize(normalizeName(shorter));
  const longerTokens = tokenize(normalizeName(longer));
  if (shorterTokens.size === 0) return 0;
  const contained = [...shorterTokens].filter((t) => longerTokens.has(t));
  return contained.length / shorterTokens.size;
}

/**
 * Determines which of two names is more "canonical" (more complete/formal).
 * The longer name after stop-word removal wins.
 * Returns "a" if a should be canonical, "b" if b should be canonical.
 */
function selectCanonicalName(a: string, b: string): "a" | "b" {
  const aTokens = tokenize(normalizeName(a));
  const bTokens = tokenize(normalizeName(b));
  if (bTokens.size > aTokens.size) return "b";
  if (aTokens.size > bTokens.size) return "a";
  // Equal token count — prefer the longer raw string (more detail)
  return b.length > a.length ? "b" : "a";
}

/**
 * Computes a composite similarity score between a candidate name and an entity.
 * Incorporates Jaccard similarity, DBA variants, and containment.
 */
function computeSimilarity(
  candidateName: string,
  entity: CanonicalEntity
): { score: number; matchedVariant?: string } {
  const candidateNorm = normalizeName(candidateName);
  const entityNorm = normalizeName(entity.canonical_name);

  // Exact match
  if (candidateNorm === entityNorm) return { score: 1.0 };

  // Check aliases for exact match
  for (const alias of entity.aliases) {
    if (normalizeName(alias.value) === candidateNorm) return { score: 1.0, matchedVariant: alias.value };
  }

  // DBA decomposition — check all variants of the candidate against entity
  const candidateVariants = extractDbaVariants(candidateName);
  const entityVariants = [entity.canonical_name, ...entity.aliases.map((a) => a.value)];

  for (const cv of candidateVariants) {
    const cvNorm = normalizeName(cv);
    for (const ev of entityVariants) {
      const evNorm = normalizeName(ev);
      if (cvNorm === evNorm) return { score: 1.0, matchedVariant: cv };
    }
  }

  // Jaccard token overlap (best across all variant combinations)
  let maxScore = 0;
  let bestVariant: string | undefined;

  for (const cv of candidateVariants) {
    const cvTokens = tokenize(normalizeName(cv));
    for (const ev of entityVariants) {
      const evTokens = tokenize(normalizeName(ev));
      const jScore = jaccardSimilarity(cvTokens, evTokens);
      if (jScore > maxScore) {
        maxScore = jScore;
        bestVariant = cv !== candidateName ? cv : undefined;
      }
    }
  }

  // Containment check — boost score if one name contains all tokens of the other.
  // Requires the shorter name to have at least 2 meaningful tokens to avoid
  // single-token false positives (e.g. "J. Smith" sharing only "smith" with "John Smith").
  for (const cv of candidateVariants) {
    for (const ev of entityVariants) {
      const shorter = cv.length <= ev.length ? cv : ev;
      const longer = cv.length <= ev.length ? ev : cv;
      const shorterTokens = tokenize(normalizeName(shorter));
      // Only apply containment boost when the shorter name has 2+ meaningful tokens
      if (shorterTokens.size >= 2) {
        const cScore = containmentScore(shorter, longer);
        // Full containment of the shorter name = strong signal (treat as 0.7 minimum)
        if (cScore >= 1.0 && maxScore < 0.7) {
          maxScore = 0.7;
          bestVariant = cv !== candidateName ? cv : undefined;
        }
      }
    }
  }

  return { score: maxScore, matchedVariant: bestVariant };
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

    this.eventBus.emit("entities_resolved", {
      signal_id: signalId,
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
    const sameDomainEntities = this.store.findByDomain(candidate.domain);

    // ── Step 1: Email exact match (person entities only) ─────────────────────
    if (candidate.email && candidate.domain === "person") {
      const emailMatch = sameDomainEntities.find(
        (e) =>
          e.attributes["email"] &&
          String(e.attributes["email"]).toLowerCase() ===
            candidate.email!.toLowerCase()
      );
      if (emailMatch) {
        const updated = this.mergeInto(emailMatch, candidate, signalId);
        return { candidate, action: "merged", entity: updated, similarity_score: 1.0 };
      }
    }

    // ── Step 2: Find best similarity match across all same-domain entities ───
    let bestMatch: CanonicalEntity | null = null;
    let bestScore = 0;

    for (const entity of sameDomainEntities) {
      const { score } = computeSimilarity(candidate.label, entity);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entity;
      }
    }

    // ── Step 3: Merge if above threshold ─────────────────────────────────────
    if (bestMatch && bestScore >= this.mergeThreshold) {
      const updated = this.mergeInto(bestMatch, candidate, signalId);
      const promoted = updated.canonical_name !== bestMatch.canonical_name;
      return {
        candidate,
        action: "merged",
        entity: updated,
        similarity_score: bestScore,
        canonical_promoted: promoted,
      };
    }

    // ── Step 4: Flag conflict if above conflict threshold ────────────────────
    if (bestMatch && bestScore >= this.conflictThreshold) {
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
        signal_id: signalId,
        reason: `Entity similarity conflict: "${candidate.label}" (new) vs "${bestMatch.canonical_name}" (existing) — score ${bestScore.toFixed(2)}. Manual review required.`,
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

    return { candidate, action: "created", entity: newEntity, similarity_score: bestScore };
  }

  /**
   * Merges a candidate into an existing entity.
   * Applies canonical name promotion: the more complete name wins as canonical.
   * The less complete name is added as an alias.
   */
  private mergeInto(
    existing: CanonicalEntity,
    candidate: EntityCandidate,
    signalId: string
  ): CanonicalEntity {
    const preferred = selectCanonicalName(existing.canonical_name, candidate.label);

    if (preferred === "b") {
      // Candidate name is more complete — promote it to canonical
      // Demote the current canonical name to an alias first
      this.store.update(existing.id, {
        source_signal_id: signalId,
        new_alias: existing.canonical_name,
        attributes: {
          ...(candidate.attributes ?? {}),
          ...(candidate.email ? { email: candidate.email } : {}),
        },
      });
      // Promote the candidate label to canonical
      this.store.promoteCanonicalName(existing.id, candidate.label);
    } else {
      // Existing name is more complete — add candidate as alias
      this.store.update(existing.id, {
        source_signal_id: signalId,
        new_alias: candidate.label,
        attributes: {
          ...(candidate.attributes ?? {}),
          ...(candidate.email ? { email: candidate.email } : {}),
        },
      });
    }

    // Also add all DBA variants as aliases
    const variants = extractDbaVariants(candidate.label);
    for (const variant of variants) {
      if (variant !== candidate.label) {
        this.store.update(existing.id, {
          source_signal_id: signalId,
          new_alias: variant,
        });
      }
    }

    return this.store.findById(existing.id)!;
  }

  /**
   * Manually merges two entities: survivor absorbs all data from superseded.
   * Applies canonical name promotion between the two.
   * Returns the updated survivor entity.
   */
  merge(survivorId: string, supersededId: string, signalId: string): CanonicalEntity {
    const superseded = this.store.findById(supersededId);
    if (!superseded) throw new Error(`EntityResolver: Entity not found: "${supersededId}"`);
    const survivor = this.store.findById(survivorId);
    if (!survivor) throw new Error(`EntityResolver: Entity not found: "${survivorId}"`);

    // Determine which canonical name to keep
    const preferred = selectCanonicalName(survivor.canonical_name, superseded.canonical_name);
    if (preferred === "b") {
      this.store.update(survivorId, { source_signal_id: signalId, new_alias: survivor.canonical_name });
      this.store.promoteCanonicalName(survivorId, superseded.canonical_name);
    } else {
      this.store.update(survivorId, { source_signal_id: signalId, new_alias: superseded.canonical_name });
    }

    // Transfer all aliases from superseded to survivor
    for (const alias of superseded.aliases) {
      this.store.update(survivorId, { source_signal_id: signalId, new_alias: alias.value });
    }

    // Merge attributes
    this.store.update(survivorId, { source_signal_id: signalId, attributes: superseded.attributes });

    // Mark superseded as merged
    this.store.supersede(supersededId, survivorId);

    return this.store.findById(survivorId)!;
  }
}
