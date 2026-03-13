/**
 * Phase 3 Integration Tests — Entity Resolver
 *
 * Covers:
 *   - EntityStore: create, read, update, supersede operations
 *   - EntityResolver: exact match, token similarity, email match, conflict flagging
 *   - Merge-before-create enforcement
 *   - Manual merge operation
 *   - Full pipeline: signal → six-layer processing → entity resolution
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EntityStore } from "../../src/entities/entity_store.js";
import { EntityResolver } from "../../src/entities/entity_resolver.js";
import { EventBus } from "../../src/event_bus.js";
import { Layer2EntityLinking } from "../../schema/processing.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLayer2(candidates: Layer2EntityLinking["entity_candidates"]): Layer2EntityLinking {
  return {
    entity_candidates: candidates,
    matched_entity_ids: [],
    proposed_new_entities: [],
    similarity_conflicts: [],
  };
}

// ─── EntityStore Tests ────────────────────────────────────────────────────────

describe("Phase 3 — EntityStore", () => {
  let tmpDir: string;
  let store: EntityStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-phase3-store-"));
    store = new EntityStore({ storageDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initializes with an empty store", () => {
    expect(store.getAll()).toHaveLength(0);
    expect(store.size).toBe(0);
    expect(store.activeCount).toBe(0);
  });

  it("creates a new entity and persists it", () => {
    const entity = store.create({
      domain: "person",
      canonical_name: "Sarah Chen",
      source_signal_id: "sig-001",
    });

    expect(entity.id).toBeTruthy();
    expect(entity.canonical_name).toBe("Sarah Chen");
    expect(entity.domain).toBe("person");
    expect(entity.source_signal_ids).toContain("sig-001");
    expect(entity.aliases).toHaveLength(0);
    expect(store.activeCount).toBe(1);
  });

  it("persists entities to disk and reloads them", () => {
    store.create({ domain: "person", canonical_name: "Sarah Chen", source_signal_id: "sig-001" });
    store.create({ domain: "organization", canonical_name: "Vertex Design Co", source_signal_id: "sig-001" });

    // Create a new store instance pointing to the same directory
    const reloadedStore = new EntityStore({ storageDir: tmpDir });
    expect(reloadedStore.activeCount).toBe(2);
    expect(reloadedStore.findByDomain("person")).toHaveLength(1);
    expect(reloadedStore.findByDomain("organization")).toHaveLength(1);
  });

  it("updates an entity with a new alias and attributes", () => {
    const entity = store.create({
      domain: "person",
      canonical_name: "Sarah Chen",
      source_signal_id: "sig-001",
    });

    const updated = store.update(entity.id, {
      source_signal_id: "sig-002",
      new_alias: "S. Chen",
      attributes: { email: "sarah@vertexdesign.com" },
    });

    expect(updated.aliases).toHaveLength(1);
    expect(updated.aliases[0].value).toBe("S. Chen");
    expect(updated.attributes["email"]).toBe("sarah@vertexdesign.com");
    expect(updated.source_signal_ids).toContain("sig-002");
  });

  it("does not add duplicate aliases", () => {
    const entity = store.create({
      domain: "person",
      canonical_name: "Sarah Chen",
      source_signal_id: "sig-001",
    });

    store.update(entity.id, { source_signal_id: "sig-002", new_alias: "S. Chen" });
    store.update(entity.id, { source_signal_id: "sig-003", new_alias: "S. Chen" });

    const reloaded = store.findById(entity.id)!;
    expect(reloaded.aliases).toHaveLength(1);
  });

  it("marks an entity as superseded", () => {
    const survivor = store.create({ domain: "person", canonical_name: "Sarah Chen", source_signal_id: "sig-001" });
    const duplicate = store.create({ domain: "person", canonical_name: "Sarah C.", source_signal_id: "sig-002" });

    store.supersede(duplicate.id, survivor.id);

    expect(store.findById(duplicate.id)?.superseded_by).toBe(survivor.id);
    // Superseded entity excluded from active queries
    expect(store.getAll()).toHaveLength(1);
    expect(store.activeCount).toBe(1);
  });

  it("finds entities by name (case-insensitive, partial match)", () => {
    store.create({ domain: "organization", canonical_name: "Vertex Design Co", source_signal_id: "sig-001" });
    store.create({ domain: "organization", canonical_name: "Meridian Coffee Co", source_signal_id: "sig-001" });

    const results = store.findByName("vertex");
    expect(results).toHaveLength(1);
    expect(results[0].canonical_name).toBe("Vertex Design Co");
  });
});

// ─── EntityResolver Tests ─────────────────────────────────────────────────────

describe("Phase 3 — EntityResolver", () => {
  let tmpDir: string;
  let store: EntityStore;
  let eventBus: EventBus;
  let resolver: EntityResolver;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-phase3-resolver-"));
    store = new EntityStore({ storageDir: tmpDir });
    eventBus = new EventBus();
    resolver = new EntityResolver({ store, eventBus });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a new entity when no match exists", () => {
    const layer2 = makeLayer2([
      { label: "Sarah Chen", domain: "person", likely_existing: false, lookup_key: "sarah chen" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.created_count).toBe(1);
    expect(summary.merged_count).toBe(0);
    expect(store.activeCount).toBe(1);
    expect(store.findByDomain("person")[0].canonical_name).toBe("Sarah Chen");
  });

  it("merges on exact name match (case-insensitive)", () => {
    // Pre-create the entity
    store.create({ domain: "person", canonical_name: "Sarah Chen", source_signal_id: "sig-000" });

    const layer2 = makeLayer2([
      { label: "sarah chen", domain: "person", likely_existing: true, lookup_key: "sarah chen" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.merged_count).toBe(1);
    expect(summary.created_count).toBe(0);
    // Still only one entity in the store
    expect(store.activeCount).toBe(1);
    // Signal added to source list
    expect(store.findByDomain("person")[0].source_signal_ids).toContain("sig-001");
  });

  it("merges on high token similarity (same person, different format)", () => {
    store.create({ domain: "organization", canonical_name: "Vertex Design Co", source_signal_id: "sig-000" });

    const layer2 = makeLayer2([
      { label: "Vertex Design Company", domain: "organization", likely_existing: true, lookup_key: "vertex design" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.merged_count).toBe(1);
    expect(store.activeCount).toBe(1);
  });

  it("merges on email exact match for person entities", () => {
    store.create({
      domain: "person",
      canonical_name: "Sarah Chen",
      source_signal_id: "sig-000",
      attributes: { email: "sarah@vertexdesign.com" },
    });

    const layer2 = makeLayer2([
      {
        label: "S. Chen",
        domain: "person",
        likely_existing: true,
        lookup_key: "sarah@vertexdesign.com",
        email: "sarah@vertexdesign.com",
      },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.merged_count).toBe(1);
    expect(store.activeCount).toBe(1);
    // "S. Chen" added as an alias
    const entity = store.findByDomain("person")[0];
    expect(entity.aliases.some((a) => a.value === "S. Chen")).toBe(true);
  });

  it("flags a similarity conflict and emits review_required", () => {
    store.create({ domain: "person", canonical_name: "John Smith", source_signal_id: "sig-000" });

    const reviewEvents: unknown[] = [];
    eventBus.on("review_required", (payload) => reviewEvents.push(payload));

    // "J. Smith" scores ~0.5 — above conflict threshold (0.4) but below merge threshold (0.65)
    const layer2 = makeLayer2([
      { label: "J. Smith", domain: "person", likely_existing: false, lookup_key: "j smith" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.conflict_count).toBe(1);
    expect(reviewEvents).toHaveLength(1);
  });

  it("creates distinct entities for clearly different names", () => {
    store.create({ domain: "person", canonical_name: "Sarah Chen", source_signal_id: "sig-000" });

    const layer2 = makeLayer2([
      { label: "Marcus Williams", domain: "person", likely_existing: false, lookup_key: "marcus williams" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.created_count).toBe(1);
    expect(store.activeCount).toBe(2);
  });

  it("resolves multiple candidates in a single call", () => {
    const layer2 = makeLayer2([
      { label: "Sarah Chen", domain: "person", likely_existing: false, lookup_key: "sarah chen" },
      { label: "Vertex Design Co", domain: "organization", likely_existing: false, lookup_key: "vertex design" },
      { label: "Invoice #2024-089", domain: "artifact", likely_existing: false, lookup_key: "invoice-2024-089" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.created_count).toBe(3);
    expect(store.activeCount).toBe(3);
  });

  it("emits entities_resolved event on the EventBus", () => {
    const resolvedEvents: unknown[] = [];
    eventBus.on("entities_resolved", (payload) => resolvedEvents.push(payload));

    const layer2 = makeLayer2([
      { label: "Sarah Chen", domain: "person", likely_existing: false, lookup_key: "sarah chen" },
    ]);

    resolver.resolve("sig-001", layer2);

    expect(resolvedEvents).toHaveLength(1);
    const event = resolvedEvents[0] as { signal_id: string; createdCount: number };
    expect(event.signal_id).toBe("sig-001");
    expect(event.createdCount).toBe(1);
  });

  it("manual merge transfers aliases and supersedes the duplicate", () => {
    const survivor = store.create({ domain: "person", canonical_name: "Sarah Chen", source_signal_id: "sig-000" });
    const duplicate = store.create({ domain: "person", canonical_name: "Sarah C.", source_signal_id: "sig-001" });
    store.update(duplicate.id, { source_signal_id: "sig-001", new_alias: "S. Chen" });

    resolver.merge(survivor.id, duplicate.id, "sig-merge");

    expect(store.findById(duplicate.id)?.superseded_by).toBe(survivor.id);
    expect(store.activeCount).toBe(1);
    const merged = store.findById(survivor.id)!;
    expect(merged.aliases.some((a) => a.value === "Sarah C.")).toBe(true);
  });

  it("merges DBA entity — 'Acme Inc dba Coyote Building Supplies' resolves to 'Acme Inc'", () => {
    store.create({ domain: "organization", canonical_name: "Acme Inc", source_signal_id: "sig-000" });

    const layer2 = makeLayer2([
      { label: "Acme Inc dba Coyote Building Supplies", domain: "organization", likely_existing: true, lookup_key: "acme" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.merged_count).toBe(1);
    expect(summary.created_count).toBe(0);
    expect(store.activeCount).toBe(1);
  });

  it("promotes the longer DBA name to canonical and demotes the shorter to alias", () => {
    store.create({ domain: "organization", canonical_name: "Acme Inc", source_signal_id: "sig-000" });

    const layer2 = makeLayer2([
      { label: "Acme Inc dba Coyote Building Supplies", domain: "organization", likely_existing: true, lookup_key: "acme" },
    ]);

    resolver.resolve("sig-001", layer2);

    const entity = store.findByDomain("organization")[0];
    // The longer/more complete name should be canonical
    expect(entity.canonical_name).toBe("Acme Inc dba Coyote Building Supplies");
    // The shorter name should be an alias
    expect(entity.aliases.some((a) => a.value === "Acme Inc")).toBe(true);
  });

  it("merges via substring containment — 'Acme Building' contained in 'Acme Building Supplies Inc'", () => {
    // Realistic case: a short 2-token name is fully contained in a longer formal name
    store.create({ domain: "organization", canonical_name: "Acme Building Supplies Inc", source_signal_id: "sig-000" });

    const layer2 = makeLayer2([
      { label: "Acme Building", domain: "organization", likely_existing: true, lookup_key: "acme building" },
    ]);

    const summary = resolver.resolve("sig-001", layer2);

    expect(summary.merged_count).toBe(1);
    expect(store.activeCount).toBe(1);
    // Longer name stays canonical
    expect(store.findByDomain("organization")[0].canonical_name).toBe("Acme Building Supplies Inc");
    // Shorter name added as alias
    expect(store.findByDomain("organization")[0].aliases.some((a) => a.value === "Acme Building")).toBe(true);
  });

  it("canonical name promotion — longer name wins when merging", () => {
    store.create({ domain: "organization", canonical_name: "Vertex Design", source_signal_id: "sig-000" });

    const layer2 = makeLayer2([
      { label: "Vertex Design Co", domain: "organization", likely_existing: true, lookup_key: "vertex design" },
    ]);

    resolver.resolve("sig-001", layer2);

    const entity = store.findByDomain("organization")[0];
    expect(entity.canonical_name).toBe("Vertex Design Co");
    expect(entity.aliases.some((a) => a.value === "Vertex Design")).toBe(true);
  });

  it("does not resolve noise signals (skips entity resolution)", () => {
    // This is tested at the ProcessingService level — the resolver itself
    // only receives Layer2 data, so we verify the store stays empty when
    // no candidates are passed
    const layer2 = makeLayer2([]);
    const summary = resolver.resolve("sig-noise", layer2);

    expect(summary.created_count).toBe(0);
    expect(summary.merged_count).toBe(0);
    expect(store.activeCount).toBe(0);
  });
});
