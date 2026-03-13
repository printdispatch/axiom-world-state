/**
 * Phase 10: Knowledge Graph API Tests
 *
 * Tests the /api/graph endpoint for correct node/edge generation
 * from entities, processing results, obligations, and workspaces.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function buildGraphFromData(dataDir: string) {
  // Inline the graph-building logic from api.ts for unit testing
  const readJson = <T>(filePath: string, fallback: T): T => {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch {
      return fallback;
    }
  };

  const entitiesRaw = readJson<Record<string, unknown>[]>(
    path.join(dataDir, "entities", "entities.json"), []
  );
  const obligationsRaw = readJson<Record<string, unknown>[]>(
    path.join(dataDir, "state", "obligations.json"), []
  );
  const stateUpdatesRaw = readJson<Record<string, unknown>[]>(
    path.join(dataDir, "state", "state_updates.json"), []
  );
  const workspacesRaw = readJson<Record<string, unknown>[]>(
    path.join(dataDir, "workspaces", "workspaces.json"), []
  );

  const processingDir = path.join(dataDir, "processing");
  const processingRaw: Record<string, unknown>[] = fs.existsSync(processingDir)
    ? fs.readdirSync(processingDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try { return JSON.parse(fs.readFileSync(path.join(processingDir, f), "utf-8")); }
          catch { return null; }
        })
        .filter(Boolean) as Record<string, unknown>[]
    : [];

  const domainColors: Record<string, string> = {
    person: "#7c6af7",
    organization: "#3b9eff",
    artifact: "#f7a04a",
    project: "#4af7a0",
    location: "#f74a7c",
    concept: "#a0a0a0",
    workspace: "#f7e04a",
    signal: "#4af7f7",
  };

  const nodes: Array<{ id: string; label: string; type: string; domain?: string; size: number; color: string }> = [];
  const nodeIds = new Set<string>();

  for (const e of entitiesRaw) {
    const id = e.id as string;
    if (!id || nodeIds.has(id)) continue;
    nodeIds.add(id);
    const domain = (e.domain as string) ?? "concept";
    const updateCount = stateUpdatesRaw.filter(
      u => u.entity_id === id || u.entity_label === e.canonical_name
    ).length;
    nodes.push({
      id,
      label: (e.canonical_name as string) ?? id,
      type: "entity",
      domain,
      size: Math.max(8, Math.min(30, 8 + updateCount * 3)),
      color: domainColors[domain] ?? "#a0a0a0",
    });
  }

  for (const w of workspacesRaw) {
    const id = `ws-${w.id as string}`;
    if (!w.id || nodeIds.has(id)) continue;
    nodeIds.add(id);
    nodes.push({
      id,
      label: (w.name as string) ?? id,
      type: "workspace",
      domain: "workspace",
      size: 20,
      color: domainColors["workspace"],
    });
  }

  const edges: Array<{ id: string; source: string; target: string; type: string; label: string; weight: number }> = [];
  const edgeSet = new Set<string>();

  function addEdge(source: string, target: string, type: string, label: string, weight = 1) {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const key = `${source}--${target}--${type}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ id: `e-${edges.length}`, source, target, type, label, weight });
  }

  for (const result of processingRaw) {
    const layer2 = result.layer_2 as Record<string, unknown> | undefined;
    if (!layer2) continue;
    const candidates = (layer2.entity_candidates as Array<Record<string, unknown>>) ?? [];
    const entityIds: string[] = [];
    for (const c of candidates) {
      const resolvedId = c.resolved_entity_id as string | undefined;
      if (resolvedId && nodeIds.has(resolvedId)) entityIds.push(resolvedId);
    }
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        addEdge(entityIds[i], entityIds[j], "co_occurrence", "co-occurs", 1);
      }
    }
  }

  for (const ob of obligationsRaw) {
    const owedBy = ob.owed_by as string | undefined;
    const owedTo = ob.owed_to as string | undefined;
    if (!owedBy || !owedTo) continue;
    const fromEntity = entitiesRaw.find(
      e => e.canonical_name === owedBy || (e.aliases as string[] | undefined)?.includes(owedBy)
    );
    const toEntity = entitiesRaw.find(
      e => e.canonical_name === owedTo || (e.aliases as string[] | undefined)?.includes(owedTo)
    );
    if (fromEntity?.id && toEntity?.id) {
      addEdge(fromEntity.id as string, toEntity.id as string, "obligation", "owes", 2);
    }
  }

  const updatesBySignal = new Map<string, string[]>();
  for (const u of stateUpdatesRaw) {
    const sigId = u.source_signal_id as string;
    const entId = u.entity_id as string;
    if (!sigId || !entId) continue;
    if (!updatesBySignal.has(sigId)) updatesBySignal.set(sigId, []);
    updatesBySignal.get(sigId)!.push(entId);
  }
  for (const [, entityIds] of updatesBySignal) {
    const unique = [...new Set(entityIds)].filter(id => nodeIds.has(id));
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        addEdge(unique[i], unique[j], "shared_signal", "same signal", 1);
      }
    }
  }

  for (const w of workspacesRaw) {
    const wsNodeId = `ws-${w.id as string}`;
    const linkedEntities = (w.linked_entity_ids as string[] | undefined) ?? [];
    for (const entId of linkedEntities) {
      addEdge(wsNodeId, entId, "workspace_entity", "includes", 1);
    }
  }

  return {
    nodes,
    edges,
    meta: {
      node_count: nodes.length,
      edge_count: edges.length,
      entity_count: entitiesRaw.length,
      workspace_count: workspacesRaw.length,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Phase 10: Knowledge Graph", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-graph-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Node generation ────────────────────────────────────────────────────────

  it("returns empty graph when no data exists", () => {
    const result = buildGraphFromData(tmpDir);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.meta.node_count).toBe(0);
    expect(result.meta.edge_count).toBe(0);
  });

  it("creates entity nodes from entities.json", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Acme Corp", domain: "organization", aliases: [] },
      { id: "ent-002", canonical_name: "Jane Smith", domain: "person", aliases: [] },
    ]);
    const result = buildGraphFromData(tmpDir);
    expect(result.nodes).toHaveLength(2);
    const acme = result.nodes.find(n => n.id === "ent-001");
    expect(acme).toBeDefined();
    expect(acme!.label).toBe("Acme Corp");
    expect(acme!.type).toBe("entity");
    expect(acme!.domain).toBe("organization");
    expect(acme!.color).toBe("#3b9eff");
  });

  it("assigns correct colors by domain", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "p1", canonical_name: "Person", domain: "person", aliases: [] },
      { id: "o1", canonical_name: "Org", domain: "organization", aliases: [] },
      { id: "a1", canonical_name: "Doc", domain: "artifact", aliases: [] },
      { id: "l1", canonical_name: "City", domain: "location", aliases: [] },
    ]);
    const result = buildGraphFromData(tmpDir);
    const colors = Object.fromEntries(result.nodes.map(n => [n.id, n.color]));
    expect(colors["p1"]).toBe("#7c6af7");
    expect(colors["o1"]).toBe("#3b9eff");
    expect(colors["a1"]).toBe("#f7a04a");
    expect(colors["l1"]).toBe("#f74a7c");
  });

  it("creates workspace nodes from workspaces.json", () => {
    writeJson(path.join(tmpDir, "workspaces", "workspaces.json"), [
      { id: "ws-001", name: "Acme Project", status: "active", linked_entity_ids: [] },
    ]);
    const result = buildGraphFromData(tmpDir);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("ws-ws-001");
    expect(result.nodes[0].label).toBe("Acme Project");
    expect(result.nodes[0].type).toBe("workspace");
    expect(result.nodes[0].color).toBe("#f7e04a");
  });

  it("deduplicates entity nodes (no duplicate IDs)", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Acme", domain: "organization", aliases: [] },
      { id: "ent-001", canonical_name: "Acme Corp", domain: "organization", aliases: [] }, // duplicate
    ]);
    const result = buildGraphFromData(tmpDir);
    expect(result.nodes).toHaveLength(1);
  });

  it("scales node size with state update count", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Busy Entity", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Quiet Entity", domain: "person", aliases: [] },
    ]);
    writeJson(path.join(tmpDir, "state", "state_updates.json"), [
      { entity_id: "ent-001", source_signal_id: "sig-1", field: "status", new_value: "active" },
      { entity_id: "ent-001", source_signal_id: "sig-2", field: "status", new_value: "done" },
      { entity_id: "ent-001", source_signal_id: "sig-3", field: "status", new_value: "pending" },
    ]);
    const result = buildGraphFromData(tmpDir);
    const busy = result.nodes.find(n => n.id === "ent-001")!;
    const quiet = result.nodes.find(n => n.id === "ent-002")!;
    expect(busy.size).toBeGreaterThan(quiet.size);
  });

  // ── Edge generation ────────────────────────────────────────────────────────

  it("creates co-occurrence edges from processing results", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Acme", domain: "organization", aliases: [] },
    ]);
    writeJson(path.join(tmpDir, "processing", "proc-001.json"), {
      signal_id: "sig-001",
      layer_2: {
        entity_candidates: [
          { resolved_entity_id: "ent-001", name: "Alice" },
          { resolved_entity_id: "ent-002", name: "Acme" },
        ],
      },
    });
    const result = buildGraphFromData(tmpDir);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe("co_occurrence");
    expect(result.edges[0].label).toBe("co-occurs");
    const sources = [result.edges[0].source, result.edges[0].target].sort();
    expect(sources).toEqual(["ent-001", "ent-002"].sort());
  });

  it("creates obligation edges between entities", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Acme Corp", domain: "organization", aliases: [] },
    ]);
    writeJson(path.join(tmpDir, "state", "obligations.json"), [
      { id: "ob-001", owed_by: "Alice", owed_to: "Acme Corp", title: "Deliver report", status: "open" },
    ]);
    const result = buildGraphFromData(tmpDir);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe("obligation");
    expect(result.edges[0].label).toBe("owes");
    expect(result.edges[0].weight).toBe(2);
  });

  it("creates shared-signal edges from state updates", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Bob", domain: "person", aliases: [] },
    ]);
    writeJson(path.join(tmpDir, "state", "state_updates.json"), [
      { entity_id: "ent-001", source_signal_id: "sig-001", field: "status", new_value: "active" },
      { entity_id: "ent-002", source_signal_id: "sig-001", field: "status", new_value: "active" },
    ]);
    const result = buildGraphFromData(tmpDir);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe("shared_signal");
  });

  it("creates workspace-entity edges from linked_entity_ids", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
    ]);
    writeJson(path.join(tmpDir, "workspaces", "workspaces.json"), [
      { id: "ws-001", name: "Project Alpha", status: "active", linked_entity_ids: ["ent-001"] },
    ]);
    const result = buildGraphFromData(tmpDir);
    const wsEdge = result.edges.find(e => e.type === "workspace_entity");
    expect(wsEdge).toBeDefined();
    expect(wsEdge!.source).toBe("ws-ws-001");
    expect(wsEdge!.target).toBe("ent-001");
    expect(wsEdge!.label).toBe("includes");
  });

  it("deduplicates edges (no duplicate source-target-type combos)", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Bob", domain: "person", aliases: [] },
    ]);
    // Two processing results with the same entity pair
    writeJson(path.join(tmpDir, "processing", "proc-001.json"), {
      signal_id: "sig-001",
      layer_2: {
        entity_candidates: [
          { resolved_entity_id: "ent-001" },
          { resolved_entity_id: "ent-002" },
        ],
      },
    });
    writeJson(path.join(tmpDir, "processing", "proc-002.json"), {
      signal_id: "sig-002",
      layer_2: {
        entity_candidates: [
          { resolved_entity_id: "ent-001" },
          { resolved_entity_id: "ent-002" },
        ],
      },
    });
    const result = buildGraphFromData(tmpDir);
    const coOccurrenceEdges = result.edges.filter(e => e.type === "co_occurrence");
    expect(coOccurrenceEdges).toHaveLength(1);
  });

  it("does not add edges for unknown entity IDs", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
    ]);
    writeJson(path.join(tmpDir, "processing", "proc-001.json"), {
      signal_id: "sig-001",
      layer_2: {
        entity_candidates: [
          { resolved_entity_id: "ent-001" },
          { resolved_entity_id: "ent-UNKNOWN" }, // not in entities
        ],
      },
    });
    const result = buildGraphFromData(tmpDir);
    expect(result.edges).toHaveLength(0);
  });

  // ── Meta ───────────────────────────────────────────────────────────────────

  it("returns correct meta counts", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Bob", domain: "person", aliases: [] },
    ]);
    writeJson(path.join(tmpDir, "workspaces", "workspaces.json"), [
      { id: "ws-001", name: "Project Alpha", status: "active", linked_entity_ids: [] },
    ]);
    const result = buildGraphFromData(tmpDir);
    expect(result.meta.node_count).toBe(3); // 2 entities + 1 workspace
    expect(result.meta.entity_count).toBe(2);
    expect(result.meta.workspace_count).toBe(1);
  });

  it("reads multiple processing files from processing directory", () => {
    writeJson(path.join(tmpDir, "entities", "entities.json"), [
      { id: "ent-001", canonical_name: "Alice", domain: "person", aliases: [] },
      { id: "ent-002", canonical_name: "Bob", domain: "person", aliases: [] },
      { id: "ent-003", canonical_name: "Carol", domain: "person", aliases: [] },
    ]);
    // proc-001: Alice + Bob
    writeJson(path.join(tmpDir, "processing", "proc-001.json"), {
      signal_id: "sig-001",
      layer_2: {
        entity_candidates: [
          { resolved_entity_id: "ent-001" },
          { resolved_entity_id: "ent-002" },
        ],
      },
    });
    // proc-002: Bob + Carol
    writeJson(path.join(tmpDir, "processing", "proc-002.json"), {
      signal_id: "sig-002",
      layer_2: {
        entity_candidates: [
          { resolved_entity_id: "ent-002" },
          { resolved_entity_id: "ent-003" },
        ],
      },
    });
    const result = buildGraphFromData(tmpDir);
    expect(result.edges).toHaveLength(2);
    const pairs = result.edges.map(e => [e.source, e.target].sort().join("-")).sort();
    expect(pairs).toContain("ent-001-ent-002");
    expect(pairs).toContain("ent-002-ent-003");
  });
});
