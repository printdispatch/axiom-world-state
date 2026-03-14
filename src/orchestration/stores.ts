/**
 * JSON-backed EntityStore and ObligationStore
 *
 * These are the concrete implementations of the EntityStore and ObligationStore
 * interfaces used by the Orchestrator. They read/write to the existing
 * data/entities/entities.json and data/state/obligations.json files,
 * maintaining backward compatibility with the existing UI.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EntityStore, ObligationStore } from "./orchestrator.js";

// ─── EntityRecord ─────────────────────────────────────────────────────────────

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

export class JsonEntityStore implements EntityStore {
  private readonly filePath: string;
  private entities: Map<string, EntityRecord>;

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, "entities", "entities.json");
    this.entities = new Map();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as EntityRecord[];
        for (const e of raw) this.entities.set(e.id, e);
      }
    } catch { /* start fresh */ }
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify([...this.entities.values()], null, 2),
      "utf-8"
    );
  }

  findAll(): EntityRecord[] {
    return [...this.entities.values()];
  }

  findByName(name: string): EntityRecord | undefined {
    const lower = name.toLowerCase();
    return [...this.entities.values()].find(
      (e) =>
        e.name.toLowerCase() === lower ||
        e.aliases.some((a) => a.toLowerCase() === lower)
    );
  }

  findByLookupKey(key: string): EntityRecord | undefined {
    const lower = key.toLowerCase();
    return [...this.entities.values()].find(
      (e) => e.lookup_key?.toLowerCase() === lower
    );
  }

  create(input: Omit<EntityRecord, "id" | "created_at" | "updated_at">): EntityRecord {
    const now = new Date().toISOString();
    const entity: EntityRecord = {
      id: `ent-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      created_at: now,
      updated_at: now,
      ...input,
    };
    this.entities.set(entity.id, entity);
    this.flush();
    return entity;
  }

  update(id: string, changes: Partial<EntityRecord>): EntityRecord {
    const existing = this.entities.get(id);
    if (!existing) throw new Error(`EntityStore: Entity not found: ${id}`);
    const updated = { ...existing, ...changes, updated_at: new Date().toISOString() };
    this.entities.set(id, updated);
    this.flush();
    return updated;
  }
}

// ─── ObligationRecord ─────────────────────────────────────────────────────────

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

export class JsonObligationStore implements ObligationStore {
  private readonly filePath: string;
  private obligations: Map<string, ObligationRecord>;

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, "state", "obligations.json");
    this.obligations = new Map();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as ObligationRecord[];
        for (const o of raw) this.obligations.set(o.id, o);
      }
    } catch { /* start fresh */ }
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify([...this.obligations.values()], null, 2),
      "utf-8"
    );
  }

  findAll(): ObligationRecord[] {
    return [...this.obligations.values()];
  }

  findOpen(): ObligationRecord[] {
    return [...this.obligations.values()].filter((o) => o.status === "open");
  }

  findById(id: string): ObligationRecord | undefined {
    return this.obligations.get(id);
  }

  create(input: Omit<ObligationRecord, "id" | "created_at" | "last_updated_at" | "history">): ObligationRecord {
    const now = new Date().toISOString();
    const obligation: ObligationRecord = {
      id: `obl-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      created_at: now,
      last_updated_at: now,
      history: [],
      ...input,
    };
    this.obligations.set(obligation.id, obligation);
    this.flush();
    return obligation;
  }

  update(id: string, changes: Partial<ObligationRecord>): ObligationRecord {
    const existing = this.obligations.get(id);
    if (!existing) throw new Error(`ObligationStore: Obligation not found: ${id}`);
    const updated = { ...existing, ...changes, last_updated_at: new Date().toISOString() };
    this.obligations.set(id, updated);
    this.flush();
    return updated;
  }
}
