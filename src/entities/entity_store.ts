/**
 * EntityStore
 *
 * Persistent, append-aware storage for canonical Entity objects.
 * Entities are the long-lived, deduplicated records that the world state
 * is built around — people, organizations, projects, artifacts, etc.
 *
 * This store is the single source of truth for all canonical entities.
 * The EntityResolver is the only component that should write to this store.
 *
 * Storage format: a single JSON file (entities.json) containing an array
 * of Entity objects. This is intentionally simple for Phase 3 and will be
 * replaced by a proper database in a later phase.
 *
 * Key invariants:
 *   - Every entity has a unique UUID (id)
 *   - Entities are never deleted — only updated or superseded
 *   - All writes are append-or-update operations (no destructive deletes)
 *   - The store is loaded into memory on construction and flushed on every write
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ─── Entity Types ─────────────────────────────────────────────────────────────

export type EntityDomain =
  | "person"
  | "organization"
  | "project"
  | "artifact"
  | "task"
  | "obligation"
  | "communication"
  | "resource"
  | "unknown";

export interface EntityAlias {
  value: string;
  source_signal_id: string;
  observed_at: string;
}

export interface CanonicalEntity {
  id: string;
  domain: EntityDomain;
  /** The primary, normalized display name */
  canonical_name: string;
  /** All known alternative names/references for this entity */
  aliases: EntityAlias[];
  /** Signal IDs that have contributed to this entity's record */
  source_signal_ids: string[];
  /** ISO 8601 timestamp of first observation */
  first_observed_at: string;
  /** ISO 8601 timestamp of most recent update */
  last_updated_at: string;
  /** Arbitrary key-value metadata extracted from signals */
  attributes: Record<string, string | number | boolean | null>;
  /** Whether this entity has been superseded by a merge */
  superseded_by?: string;
}

// ─── EntityStore ──────────────────────────────────────────────────────────────

export interface EntityStoreOptions {
  storageDir: string;
  filename?: string;
}

export class EntityStore {
  private readonly filePath: string;
  private entities: Map<string, CanonicalEntity>;

  constructor(options: EntityStoreOptions) {
    this.filePath = path.join(
      options.storageDir,
      options.filename ?? "entities.json"
    );

    if (!fs.existsSync(options.storageDir)) {
      fs.mkdirSync(options.storageDir, { recursive: true });
    }

    this.entities = new Map();
    this.load();
  }

  // ─── Read Operations ────────────────────────────────────────────────────────

  /** Returns all active (non-superseded) entities */
  getAll(): CanonicalEntity[] {
    return Array.from(this.entities.values()).filter((e) => !e.superseded_by);
  }

  /** Returns a single entity by ID, including superseded ones */
  findById(id: string): CanonicalEntity | undefined {
    return this.entities.get(id);
  }

  /** Returns all entities in a given domain */
  findByDomain(domain: EntityDomain): CanonicalEntity[] {
    return this.getAll().filter((e) => e.domain === domain);
  }

  /**
   * Returns all entities whose canonical_name or aliases contain the given
   * string (case-insensitive).
   */
  findByName(name: string): CanonicalEntity[] {
    const normalized = name.toLowerCase().trim();
    return this.getAll().filter((e) => {
      if (e.canonical_name.toLowerCase().includes(normalized)) return true;
      return e.aliases.some((a) =>
        a.value.toLowerCase().includes(normalized)
      );
    });
  }

  /** Total count of all entities (including superseded) */
  get size(): number {
    return this.entities.size;
  }

  /** Total count of active (non-superseded) entities */
  get activeCount(): number {
    return this.getAll().length;
  }

  // ─── Write Operations ───────────────────────────────────────────────────────

  /**
   * Creates a new canonical entity and persists it.
   * Returns the created entity.
   */
  create(params: {
    domain: EntityDomain;
    canonical_name: string;
    source_signal_id: string;
    attributes?: Record<string, string | number | boolean | null>;
  }): CanonicalEntity {
    const now = new Date().toISOString();
    const entity: CanonicalEntity = {
      id: crypto.randomUUID(),
      domain: params.domain,
      canonical_name: params.canonical_name,
      aliases: [],
      source_signal_ids: [params.source_signal_id],
      first_observed_at: now,
      last_updated_at: now,
      attributes: params.attributes ?? {},
    };
    this.entities.set(entity.id, entity);
    this.flush();
    return entity;
  }

  /**
   * Updates an existing entity with new information from a signal.
   * Adds the signal to source_signal_ids, adds new aliases, merges attributes.
   * Returns the updated entity.
   */
  update(
    id: string,
    params: {
      source_signal_id: string;
      new_alias?: string;
      attributes?: Record<string, string | number | boolean | null>;
    }
  ): CanonicalEntity {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new Error(`EntityStore: Entity not found: id="${id}"`);
    }

    // Add signal to sources if not already present
    if (!entity.source_signal_ids.includes(params.source_signal_id)) {
      entity.source_signal_ids.push(params.source_signal_id);
    }

    // Add new alias if provided and not already present
    if (params.new_alias) {
      const aliasExists = entity.aliases.some(
        (a) => a.value.toLowerCase() === params.new_alias!.toLowerCase()
      );
      if (
        !aliasExists &&
        params.new_alias.toLowerCase() !==
          entity.canonical_name.toLowerCase()
      ) {
        entity.aliases.push({
          value: params.new_alias,
          source_signal_id: params.source_signal_id,
          observed_at: new Date().toISOString(),
        });
      }
    }

    // Merge attributes (new values overwrite old ones)
    if (params.attributes) {
      entity.attributes = { ...entity.attributes, ...params.attributes };
    }

    entity.last_updated_at = new Date().toISOString();
    this.entities.set(id, entity);
    this.flush();
    return entity;
  }

  /**
   * Marks an entity as superseded by another (used during merges).
   * The superseded entity is kept in the store for provenance but excluded
   * from all active queries.
   */
  supersede(supersededId: string, survivorId: string): void {
    const entity = this.entities.get(supersededId);
    if (!entity) {
      throw new Error(`EntityStore: Entity not found: id="${supersededId}"`);
    }
    entity.superseded_by = survivorId;
    entity.last_updated_at = new Date().toISOString();
    this.entities.set(supersededId, entity);
    this.flush();
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, "utf-8");
    const parsed = JSON.parse(raw) as CanonicalEntity[];
    for (const entity of parsed) {
      this.entities.set(entity.id, entity);
    }
  }

  private flush(): void {
    const data = Array.from(this.entities.values());
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
