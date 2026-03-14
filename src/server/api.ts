/**
 * Axiom World State — API Server
 *
 * Exposes the live world state, signal feed, and processing results
 * over HTTP for the Feed UI and future integrations.
 *
 * Endpoints:
 *   GET  /api/signals              — All signals (newest first)
 *   GET  /api/signals/:id          — Single signal by ID
 *   GET  /api/signals/:id/result   — Processing result for a signal
 *   GET  /api/entities             — All canonical entities
 *   GET  /api/obligations          — All obligations (open first)
 *   GET  /api/state-updates        — All state updates
 *   GET  /api/contradictions       — All unresolved contradictions
 *   GET  /api/audit                — Full audit log
 *   GET  /api/summary              — World state summary counts
 */

import express, { type Express } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAuthUrl,
  exchangeCodeForToken,
  syncGmailEmails,
  getSyncStatus,
  recordSync,
  deleteToken,
} from "../adapters/gmail_adapter.js";
import { processBatch, processSingle } from "../engine/signal_processor_service.js";
import { createOrchestrationRouter } from "./orchestration_routes.js";
import {
  applyReviewDecision,
  resolveObligation,
  snoozeObligation,
  getEntityContext,
  getLearnedNoise,
} from "../engine/action_engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Data paths ───────────────────────────────────────────────────────────────
// In development, data lives in /home/ubuntu/axiom-world-state/data/
// This can be overridden via DATA_DIR environment variable

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../../data");

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app: Express = express();
app.use(cors());
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

// ── Orchestration Loop (new) ─────────────────────────────────────────────────
app.use("/api", createOrchestrationRouter(DATA_DIR));

// GET /api/summary
app.get("/api/summary", (_req, res) => {
  const signals = readJson<unknown[]>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  const obligations = readJson<unknown[]>(path.join(DATA_DIR, "state", "obligations.json"), []);
  const stateUpdates = readJson<unknown[]>(path.join(DATA_DIR, "state", "state_updates.json"), []);
  const contradictions = readJson<Array<{ resolved: boolean }>>(path.join(DATA_DIR, "state", "contradictions.json"), []);
  const entities = readJson<unknown[]>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const auditLog = readJson<unknown[]>(path.join(DATA_DIR, "state", "audit_log.json"), []);

  res.json({
    signals: signals.length,
    entities: entities.length,
    open_obligations: (obligations as Array<{ status: string }>).filter((o) => o.status === "open").length,
    total_obligations: obligations.length,
    state_updates: stateUpdates.length,
    unresolved_contradictions: contradictions.filter((c) => !c.resolved).length,
    audit_entries: auditLog.length,
  });
});

// GET /api/signals
app.get("/api/signals", (_req, res) => {
  const signals = readJson<unknown[]>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  // Newest first
  const sorted = [...signals].reverse();
  res.json(sorted);
});

// GET /api/signals/:id
app.get("/api/signals/:id", (req, res) => {
  const signals = readJson<Array<{ id: string }>>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  const signal = signals.find((s) => s.id === req.params.id);
  if (!signal) return res.status(404).json({ error: "Signal not found" });
  return res.json(signal);
});

// GET /api/signals/:id/result
app.get("/api/signals/:id/result", (req, res) => {
  const resultsDir = path.join(DATA_DIR, "processing");
  if (!fs.existsSync(resultsDir)) return res.status(404).json({ error: "No processing results" });

  const files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const result = readJson<{ signal_id: string }>(path.join(resultsDir, file), { signal_id: "" });
    if (result.signal_id === req.params.id) return res.json(result);
  }
  return res.status(404).json({ error: "Processing result not found" });
});

// GET /api/entities
app.get("/api/entities", (_req, res) => {
  const entities = readJson<unknown[]>(path.join(DATA_DIR, "entities", "entities.json"), []);
  res.json(entities);
});

// GET /api/obligations
app.get("/api/obligations", (_req, res) => {
  const obligations = readJson<Array<{ status: string; created_at: string }>>(
    path.join(DATA_DIR, "state", "obligations.json"), []
  );
  // Open first, then by created_at desc
  const sorted = [...obligations].sort((a, b) => {
    if (a.status === "open" && b.status !== "open") return -1;
    if (a.status !== "open" && b.status === "open") return 1;
    return b.created_at.localeCompare(a.created_at);
  });
  res.json(sorted);
});

// GET /api/state-updates
app.get("/api/state-updates", (_req, res) => {
  const updates = readJson<unknown[]>(path.join(DATA_DIR, "state", "state_updates.json"), []);
  res.json([...updates].reverse());
});

// GET /api/contradictions
app.get("/api/contradictions", (_req, res) => {
  const contradictions = readJson<Array<{ resolved: boolean }>>(
    path.join(DATA_DIR, "state", "contradictions.json"), []
  );
  res.json(contradictions.filter((c) => !c.resolved));
});

// GET /api/entities/:id — Single entity with full alias history and provenance
app.get("/api/entities/:id", (req, res) => {
  const entities = readJson<Array<{ id: string }>>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const entity = entities.find((e) => e.id === req.params.id);
  if (!entity) return res.status(404).json({ error: "Entity not found" });
  return res.json(entity);
});

// GET /api/entities/:id/provenance — All signals and state changes that touched this entity
app.get("/api/entities/:id/provenance", (req, res) => {
  const entityId = req.params.id;
  const entities = readJson<Array<{ id: string; canonical_name?: string; name?: string; source_signal_id?: string }>>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const entity = entities.find((e) => e.id === entityId);
  if (!entity) return res.status(404).json({ error: "Entity not found" });

  // Resolve the display name — new entities use 'name', old ones use 'canonical_name'
  const entityName = (entity.name || entity.canonical_name || "").toLowerCase();

  // Find all state updates referencing this entity
  const stateUpdates = readJson<Array<{ entity_label: string; signal_id: string; mutated_at: string; field: string; new_value: string; source_fact: string }>>(path.join(DATA_DIR, "state", "state_updates.json"), []);
  const entityUpdates = stateUpdates.filter((u) =>
    u.entity_label?.toLowerCase() === entityName
  );

  // Find all signals that produced those updates PLUS the source signal that created the entity
  const signals = readJson<Array<{ id: string; metadata: { subject: string; from: string; date: string }; received_at: string; source: string }>>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  const signalIds = new Set(entityUpdates.map((u) => u.signal_id));
  if (entity.source_signal_id) signalIds.add(entity.source_signal_id);
  const relatedSignals = signals.filter((s) => signalIds.has(s.id));

  // Find obligations related to this entity by name match
  const obligations = readJson<Array<{ id: string; owed_by: string; owed_to: string; title: string; status: string; priority: string; created_at: string; source_signal_id?: string }>>(path.join(DATA_DIR, "state", "obligations.json"), []);
  const entityObligations = obligations.filter((o) =>
    o.owed_by?.toLowerCase().includes(entityName) ||
    o.owed_to?.toLowerCase().includes(entityName) ||
    (entity.source_signal_id && o.source_signal_id === entity.source_signal_id)
  );

  res.json({
    entity,
    state_updates: entityUpdates,
    signals: relatedSignals,
    obligations: entityObligations,
  });
});

// GET /api/audit
app.get("/api/audit", (_req, res) => {
  const log = readJson<unknown[]>(path.join(DATA_DIR, "state", "audit_log.json"), []);
  res.json([...log].reverse());
});

// ─── Review Queue Endpoints ─────────────────────────────────────────────────

// GET /api/review — All review items (pending first)
app.get("/api/review", (_req, res) => {
  const items = readJson<Array<{ status: string; severity: string; created_at: string }>>(
    path.join(DATA_DIR, "review", "review_queue.json"), []
  );
  const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const sorted = [...items].sort((a, b) => {
    // Pending first
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    // Then by severity
    return (sevOrder[b.severity] || 0) - (sevOrder[a.severity] || 0);
  });
  res.json(sorted);
});

// GET /api/review/pending — Only pending items
app.get("/api/review/pending", (_req, res) => {
  const items = readJson<Array<{ status: string; severity: string; created_at: string }>>(
    path.join(DATA_DIR, "review", "review_queue.json"), []
  );
  const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const pending = items
    .filter(i => i.status === "pending")
    .sort((a, b) => (sevOrder[b.severity] || 0) - (sevOrder[a.severity] || 0));
  res.json(pending);
});

// POST /api/review/:id/decide — Approve, reject, resolve, or defer a review item
// This now triggers real consequences via the action engine:
//   approve  → creates an obligation (task) from the review item
//   resolve  → closes the review item and any linked obligation
//   reject   → dismisses and teaches the noise filter
//   defer    → snoozes for 7 days
app.post("/api/review/:id/decide", (req, res) => {
  const { decision, note } = req.body as { decision: string; note?: string };
  const validDecisions = ["approve", "resolve", "reject", "defer"];
  if (!validDecisions.includes(decision)) {
    return res.status(400).json({ error: `Invalid decision. Must be one of: ${validDecisions.join(", ")}` });
  }

  const result = applyReviewDecision(DATA_DIR, req.params.id, decision as any, note || "");
  if (!result.success) return res.status(404).json({ error: result.message });
  return res.json({ item: result.item, obligation: result.obligation, message: result.message });
});

// POST /api/obligations/:id/resolve — Mark a task as done directly from Tasks tab
app.post("/api/obligations/:id/resolve", (req, res) => {
  const { note } = req.body as { note?: string };
  const result = resolveObligation(DATA_DIR, req.params.id, note);
  if (!result.success) return res.status(404).json({ error: result.message });
  return res.json({ success: true, message: result.message });
});

// POST /api/obligations/:id/snooze — Push due date forward
app.post("/api/obligations/:id/snooze", (req, res) => {
  const { days } = req.body as { days?: number };
  const result = snoozeObligation(DATA_DIR, req.params.id, days || 3);
  if (!result.success) return res.status(404).json({ error: result.message });
  return res.json({ success: true, message: result.message });
});

// GET /api/entities/:name/context — Full context for an entity
app.get("/api/entities/:name/context", (req, res) => {
  const context = getEntityContext(DATA_DIR, decodeURIComponent(req.params.name));
  return res.json(context);
});

// GET /api/noise/learned — Get the learned noise list
app.get("/api/noise/learned", (_req, res) => {
  return res.json(getLearnedNoise(DATA_DIR));
});

// ─── Workspaces ──────────────────────────────────────────────────────────────

// GET /api/workspaces — All workspaces sorted by last activity
app.get("/api/workspaces", (_req, res) => {
  const workspaces = readJson<Array<Record<string, unknown>>>(
    path.join(DATA_DIR, "workspaces", "workspaces.json"), []
  );
  return res.json(workspaces);
});

// GET /api/workspaces/active — Only active workspaces
app.get("/api/workspaces/active", (_req, res) => {
  const workspaces = readJson<Array<{ status: string }>>(path.join(DATA_DIR, "workspaces", "workspaces.json"), []);
  return res.json(workspaces.filter(w => w.status === "active"));
});

// GET /api/workspaces/:id — Single workspace with enriched data
app.get("/api/workspaces/:id", (req, res) => {
  const workspaces = readJson<Array<{ id: string; signal_ids?: string[]; entity_ids?: string[]; obligation_ids?: string[] }>>(
    path.join(DATA_DIR, "workspaces", "workspaces.json"), []
  );
  const ws = workspaces.find(w => w.id === req.params.id);
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  // Enrich with related signals
  const allSignals = readJson<Array<{ id: string }>>(path.join(DATA_DIR, "signals.json"), []);
  const signals = allSignals.filter(s => (ws.signal_ids ?? []).includes(s.id));

  // Enrich with related entities
  const allEntities = readJson<Array<{ id: string }>>(path.join(DATA_DIR, "entities.json"), []);
  const entities = allEntities.filter(e => (ws.entity_ids ?? []).includes(e.id));

  // Enrich with related obligations
  const allObligations = readJson<Array<{ id: string }>>(path.join(DATA_DIR, "obligations.json"), []);
  const obligations = allObligations.filter(o => (ws.obligation_ids ?? []).includes(o.id));

  // Enrich with related state updates
  const allUpdates = readJson<Array<{ entity_id?: string }>>(path.join(DATA_DIR, "state_updates.json"), []);
  const stateUpdates = allUpdates.filter(u => (ws.entity_ids ?? []).includes(u.entity_id ?? ""));

  return res.json({ ...ws, signals, entities, obligations, state_updates: stateUpdates });
});

// POST /api/workspaces — Create a new workspace
app.post("/api/workspaces", (req, res) => {
  const { name, description, client_name, tags } = req.body as { name: string; description?: string; client_name?: string; tags?: string[] };
  if (!name) return res.status(400).json({ error: "name is required" });
  const workspaces = readJson<Array<Record<string, unknown>>>(path.join(DATA_DIR, "workspaces", "workspaces.json"), []);
  const now = new Date().toISOString();
  const newWs = {
    id: `ws-${Date.now().toString(36)}`,
    name,
    description: description ?? "",
    status: "active",
    client_name: client_name ?? "",
    entity_ids: [],
    signal_ids: [],
    obligation_ids: [],
    tags: tags ?? [],
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };
  workspaces.push(newWs);
  const dir = path.join(DATA_DIR, "workspaces");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(workspaces, null, 2));
  return res.status(201).json(newWs);
});

// ─── World State Dashboard ──────────────────────────────────────────────────

// GET /api/world — Aggregated world state intelligence for the dashboard
app.get("/api/world", (_req, res) => {
  const obligations = readJson<Array<{
    id: string; title: string; status: string; priority: string;
    due_date?: string; owed_by?: string; owed_to?: string;
    created_at: string; source_signal_id?: string;
  }>>(path.join(DATA_DIR, "state", "obligations.json"), []);

  const contradictions = readJson<Array<{
    id: string; description: string; resolved: boolean;
    entity_label?: string; signal_ids?: string[]; created_at: string;
  }>>(path.join(DATA_DIR, "state", "contradictions.json"), []);

  const entities = readJson<Array<{
    id: string; canonical_name: string; domain: string;
    aliases?: string[]; updated_at: string;
  }>>(path.join(DATA_DIR, "entities", "entities.json"), []);

  const stateUpdates = readJson<Array<{
    id: string; entity_label: string; field: string;
    new_value: string; mutated_at: string; signal_id: string;
  }>>(path.join(DATA_DIR, "state", "state_updates.json"), []);

  const signals = readJson<Array<{ id: string; received_at: string; source: string }>>(path.join(DATA_DIR, "signals", "signal_log.json"), []);

  const reviewItems = readJson<Array<{ status: string; severity: string }>>(path.join(DATA_DIR, "review", "review_queue.json"), []);

  const workspaces = readJson<Array<{ id: string; name: string; status: string; client_name?: string }>>(path.join(DATA_DIR, "workspaces", "workspaces.json"), []);

  // Priority order for sorting
  const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

  // Open obligations sorted by priority then due date
  const openObligations = obligations
    .filter(o => o.status === "open")
    .sort((a, b) => {
      const pd = (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
      if (pd !== 0) return pd;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });

  // Overdue obligations (due_date in the past)
  const now = new Date().toISOString();
  const overdueObligations = openObligations.filter(o => o.due_date && o.due_date < now);

  // Active contradictions
  const activeContradictions = contradictions.filter(c => !c.resolved);

  // Most active entities (those with the most recent state updates)
  const entityUpdateCounts: Record<string, number> = {};
  for (const update of stateUpdates) {
    entityUpdateCounts[update.entity_label] = (entityUpdateCounts[update.entity_label] || 0) + 1;
  }
  const mostActiveEntities = entities
    .map(e => ({ ...e, update_count: entityUpdateCounts[e.canonical_name] || 0 }))
    .sort((a, b) => b.update_count - a.update_count)
    .slice(0, 5);

  // Recent activity timeline (last 10 state updates)
  const recentActivity = [...stateUpdates]
    .sort((a, b) => (b.mutated_at ?? "").localeCompare(a.mutated_at ?? ""))
    .slice(0, 10);

  // Pending review items by severity
  const pendingReview = reviewItems.filter(r => r.status === "pending");
  const reviewBySeverity = {
    critical: pendingReview.filter(r => r.severity === "critical").length,
    high: pendingReview.filter(r => r.severity === "high").length,
    medium: pendingReview.filter(r => r.severity === "medium").length,
    low: pendingReview.filter(r => r.severity === "low").length,
  };

  // System health score (0-100)
  const totalSignals = signals.length;
  const processedSignals = stateUpdates.length > 0 ? Math.min(totalSignals, stateUpdates.length) : 0;
  const processingRate = totalSignals > 0 ? Math.round((processedSignals / totalSignals) * 100) : 100;
  const contradictionPenalty = Math.min(activeContradictions.length * 10, 30);
  const overduePenalty = Math.min(overdueObligations.length * 5, 20);
  const healthScore = Math.max(0, processingRate - contradictionPenalty - overduePenalty);

  res.json({
    summary: {
      total_signals: totalSignals,
      total_entities: entities.length,
      open_obligations: openObligations.length,
      overdue_obligations: overdueObligations.length,
      active_contradictions: activeContradictions.length,
      pending_review: pendingReview.length,
      active_workspaces: workspaces.filter(w => w.status === "active").length,
      health_score: healthScore,
    },
    open_obligations: openObligations,
    overdue_obligations: overdueObligations,
    active_contradictions: activeContradictions,
    most_active_entities: mostActiveEntities,
    recent_activity: recentActivity,
    review_by_severity: reviewBySeverity,
    workspaces: workspaces.filter(w => w.status === "active"),
  });
});

// ─── Knowledge Graph ────────────────────────────────────────────────────────────
// GET /api/graph — returns nodes and edges for the knowledge graph visualization
app.get("/api/graph", (_req, res) => {
  // Load all data sources
  const signalsRaw = readJson<Record<string, unknown>[]>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  const entitiesRaw = readJson<Record<string, unknown>[]>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const obligationsRaw = readJson<Record<string, unknown>[]>(path.join(DATA_DIR, "state", "obligations.json"), []);
  const stateUpdatesRaw = readJson<Record<string, unknown>[]>(path.join(DATA_DIR, "state", "state_updates.json"), []);
  // Read all individual processing result files
  const processingDir = path.join(DATA_DIR, "processing");
  const processingRaw: Record<string, unknown>[] = fs.existsSync(processingDir)
    ? fs.readdirSync(processingDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(processingDir, f), "utf-8")); } catch { return null; } })
        .filter(Boolean) as Record<string, unknown>[]
    : [];
  const workspacesRaw = readJson<Record<string, unknown>[]>(path.join(DATA_DIR, "workspaces", "workspaces.json"), []);

  // Build nodes
  const nodes: Array<{
    id: string;
    label: string;
    type: string;
    domain?: string;
    size: number;
    color: string;
  }> = [];

  const nodeIds = new Set<string>();

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

  // Entity nodes
  for (const e of entitiesRaw) {
    const id = e.id as string;
    if (!id || nodeIds.has(id)) continue;
    nodeIds.add(id);
    const domain = (e.domain as string) ?? "concept";
    // Count how many state updates reference this entity
    const updateCount = stateUpdatesRaw.filter(u => u.entity_id === id || u.entity_label === e.canonical_name).length;
    nodes.push({
      id,
      label: (e.canonical_name as string) ?? id,
      type: "entity",
      domain,
      size: Math.max(8, Math.min(30, 8 + updateCount * 3)),
      color: domainColors[domain] ?? "#a0a0a0",
    });
  }

  // Workspace nodes
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

  // Build edges
  const edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    label: string;
    weight: number;
  }> = [];

  const edgeSet = new Set<string>();

  function addEdge(source: string, target: string, type: string, label: string, weight = 1) {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const key = `${source}--${target}--${type}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({
      id: `e-${edges.length}`,
      source,
      target,
      type,
      label,
      weight,
    });
  }

  // Edges from processing results: entity co-occurrence in same signal
  for (const result of processingRaw) {
    const layer2 = result.layer_2 as Record<string, unknown> | undefined;
    if (!layer2) continue;
    const candidates = (layer2.entity_candidates as Array<Record<string, unknown>>) ?? [];
    const entityIds: string[] = [];
    for (const c of candidates) {
      const resolvedId = c.resolved_entity_id as string | undefined;
      if (resolvedId && nodeIds.has(resolvedId)) entityIds.push(resolvedId);
    }
    // Connect all co-occurring entities in the same signal
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        addEdge(entityIds[i], entityIds[j], "co_occurrence", "co-occurs", 1);
      }
    }
  }

  // Edges from obligations: owed_by → owed_to
  for (const ob of obligationsRaw) {
    const owedBy = ob.owed_by as string | undefined;
    const owedTo = ob.owed_to as string | undefined;
    if (!owedBy || !owedTo) continue;
    // Find entity ids by label
    const fromEntity = entitiesRaw.find(e => e.canonical_name === owedBy || (e.aliases as string[] | undefined)?.includes(owedBy));
    const toEntity = entitiesRaw.find(e => e.canonical_name === owedTo || (e.aliases as string[] | undefined)?.includes(owedTo));
    if (fromEntity?.id && toEntity?.id) {
      addEdge(fromEntity.id as string, toEntity.id as string, "obligation", "owes", 2);
    }
  }

  // Edges from state updates: entity → entity (same signal)
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

  // Edges from workspaces: workspace → linked entities
  for (const w of workspacesRaw) {
    const wsNodeId = `ws-${w.id as string}`;
    const linkedEntities = (w.linked_entity_ids as string[] | undefined) ?? [];
    for (const entId of linkedEntities) {
      addEdge(wsNodeId, entId, "workspace_entity", "includes", 1);
    }
  }

  res.json({
    nodes,
    edges,
    meta: {
      node_count: nodes.length,
      edge_count: edges.length,
      entity_count: entitiesRaw.length,
      workspace_count: workspacesRaw.length,
    },
  });
});

// ─── Automation Recipes ─────────────────────────────────────────────────────

// GET /api/recipes — All recipes
app.get("/api/recipes", (_req, res) => {
  const recipes = readJson<unknown[]>(path.join(DATA_DIR, "recipes", "recipes.json"), []);
  res.json(recipes);
});

// GET /api/recipes/enabled — Only enabled recipes
app.get("/api/recipes/enabled", (_req, res) => {
  const recipes = readJson<Array<{ enabled: boolean }>>(path.join(DATA_DIR, "recipes", "recipes.json"), []);
  res.json(recipes.filter((r) => r.enabled));
});

// GET /api/recipes/:id — Single recipe
app.get("/api/recipes/:id", (req, res) => {
  const recipes = readJson<Array<{ id: string }>>(path.join(DATA_DIR, "recipes", "recipes.json"), []);
  const recipe = recipes.find((r) => r.id === req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  return res.json(recipe);
});

// POST /api/recipes — Create a new recipe
app.post("/api/recipes", (req, res) => {
  const data = req.body as Record<string, unknown>;
  if (!data.name || !data.trigger || !data.steps) {
    return res.status(400).json({ error: "name, trigger, and steps are required" });
  }
  const recipes = readJson<Record<string, unknown>[]>(path.join(DATA_DIR, "recipes", "recipes.json"), []);
  const now = new Date().toISOString();
  const recipe = {
    ...data,
    id: `recipe-${Date.now().toString(36)}`,
    enabled: data.enabled ?? true,
    risk_level: data.risk_level ?? "low",
    approval_required: data.approval_required ?? false,
    run_count: 0,
    created_at: now,
    updated_at: now,
  };
  recipes.push(recipe);
  const dir = path.join(DATA_DIR, "recipes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "recipes.json"), JSON.stringify(recipes, null, 2));
  return res.status(201).json(recipe);
});

// PATCH /api/recipes/:id — Update a recipe (enable/disable, edit steps)
app.patch("/api/recipes/:id", (req, res) => {
  const recipesPath = path.join(DATA_DIR, "recipes", "recipes.json");
  const recipes = readJson<Array<{ id: string; updated_at?: string }>>(recipesPath, []);
  const idx = recipes.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Recipe not found" });
  recipes[idx] = { ...recipes[idx], ...req.body, updated_at: new Date().toISOString() };
  fs.writeFileSync(recipesPath, JSON.stringify(recipes, null, 2));
  return res.json(recipes[idx]);
});

// POST /api/recipes/:id/trigger — Manually trigger a recipe
app.post("/api/recipes/:id/trigger", (req, res) => {
  const recipesPath = path.join(DATA_DIR, "recipes", "recipes.json");
  const recipes = readJson<Array<{ id: string; enabled: boolean; name: string; run_count: number; approval_required: boolean; risk_level: string }>>(recipesPath, []);
  const recipe = recipes.find((r) => r.id === req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  if (!recipe.enabled) return res.status(400).json({ error: "Recipe is disabled" });

  const now = new Date().toISOString();
  const needsApproval = recipe.approval_required && (recipe.risk_level === "high" || recipe.risk_level === "critical");
  const run = {
    id: `run-${Date.now().toString(36)}`,
    recipe_id: recipe.id,
    trigger_payload: { ...req.body, manual: true },
    status: needsApproval ? "pending_approval" : "completed",
    step_results: [],
    started_at: now,
    completed_at: needsApproval ? undefined : now,
  };

  const runsPath = path.join(DATA_DIR, "recipes", "runs.json");
  const runs = readJson<unknown[]>(runsPath, []);
  runs.push(run);
  fs.writeFileSync(runsPath, JSON.stringify(runs, null, 2));

  if (!needsApproval) {
    const idx2 = recipes.findIndex((r) => r.id === req.params.id);
    recipes[idx2].run_count = (recipes[idx2].run_count ?? 0) + 1;
    fs.writeFileSync(recipesPath, JSON.stringify(recipes, null, 2));
  }

  return res.json(run);
});

// GET /api/recipes/:id/runs — Run history for a recipe
app.get("/api/recipes/:id/runs", (req, res) => {
  const runs = readJson<Array<{ recipe_id: string }>>(path.join(DATA_DIR, "recipes", "runs.json"), []);
  res.json(runs.filter((r) => r.recipe_id === req.params.id));
});

// GET /api/runs — All recipe runs
app.get("/api/runs", (_req, res) => {
  const runs = readJson<unknown[]>(path.join(DATA_DIR, "recipes", "runs.json"), []);
  res.json([...runs].reverse());
});

// ─── Simulation Engine ─────────────────────────────────────────────────────

// GET /api/simulations — All simulations (newest first)
app.get("/api/simulations", (_req, res) => {
  const simDir = path.join(DATA_DIR, "simulations");
  if (!fs.existsSync(simDir)) return res.json([]);
  const files = fs.readdirSync(simDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  const sims = files.map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(simDir, f), "utf8")); }
    catch { return null; }
  }).filter(Boolean);
  return res.json(sims);
});

// GET /api/simulations/:id — Single simulation
app.get("/api/simulations/:id", (req, res) => {
  const simPath = path.join(DATA_DIR, "simulations", `${req.params.id}.json`);
  if (!fs.existsSync(simPath)) return res.status(404).json({ error: "Simulation not found" });
  try {
    return res.json(JSON.parse(fs.readFileSync(simPath, "utf8")));
  } catch {
    return res.status(500).json({ error: "Failed to read simulation" });
  }
});

// POST /api/simulations — Run a new simulation
app.post("/api/simulations", (req, res) => {
  const { name, change } = req.body as { name?: string; change?: Record<string, unknown> };
  if (!change || !change.kind) {
    return res.status(400).json({ error: "change.kind is required" });
  }

  // Build snapshot inline
  const obligations = readJson<Array<{ id: string; title: string; status: string; priority: string; due_date?: string; owed_by: string; owed_to: string }>>(path.join(DATA_DIR, "state", "obligations.json"), []);
  const contradictions = readJson<Array<{ resolved: boolean }>>(path.join(DATA_DIR, "state", "contradictions.json"), []);
  const entities = readJson<Array<{ id: string; canonical_name: string; domain: string }>>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const reviewItems = readJson<Array<{ status: string }>>(path.join(DATA_DIR, "review", "review_queue.json"), []);

  const openObligations = obligations.filter((o) => o.status === "open");
  const now2 = new Date();
  const overdueObligations = openObligations.filter((o) => o.due_date && new Date(o.due_date) < now2);
  const activeContradictions = contradictions.filter((c) => !c.resolved);
  const pendingReview = reviewItems.filter((r) => r.status === "pending");
  const overdueDeduction = Math.min(30, overdueObligations.length * 10);
  const contradictionDeduction = Math.min(20, activeContradictions.length * 7);
  const reviewDeduction = Math.min(15, pendingReview.length * 3);
  const healthScore = Math.max(0, 100 - overdueDeduction - contradictionDeduction - reviewDeduction);

  const snapshot = {
    captured_at: new Date().toISOString(),
    open_obligations: openObligations.length,
    overdue_obligations: overdueObligations.length,
    active_contradictions: activeContradictions.length,
    entity_count: entities.length,
    pending_review: pendingReview.length,
    health_score: healthScore,
    obligations: obligations.map((o) => ({ id: o.id, title: o.title, status: o.status, priority: o.priority, due_date: o.due_date, owed_by: o.owed_by, owed_to: o.owed_to })),
    entities: entities.map((e) => ({ id: e.id, canonical_name: e.canonical_name, domain: e.domain })),
  };

  // Compute predicted effects
  const effects: Array<{ kind: string; description: string; target_id?: string; predicted_values: Record<string, unknown>; confidence: number }> = [];

  if (change.kind === "obligation_resolved") {
    const ob = obligations.find((o) => o.id === change.target_id);
    if (ob) {
      effects.push({ kind: "obligation_status_change", description: `"${ob.title}" would be marked as resolved`, target_id: ob.id, predicted_values: { status: "resolved" }, confidence: 1.0 });
      const wasOverdue = ob.due_date && new Date(ob.due_date) < now2;
      if (wasOverdue) {
        const newOverdue = Math.max(0, overdueObligations.length - 1);
        const newHealth = Math.max(0, 100 - Math.min(30, newOverdue * 10) - contradictionDeduction - reviewDeduction);
        effects.push({ kind: "health_score_change", description: `Health score would improve from ${healthScore} to ${newHealth}`, predicted_values: { old_score: healthScore, new_score: newHealth, delta: newHealth - healthScore }, confidence: 0.95 });
      }
    }
  } else if (change.kind === "contradiction_resolved") {
    const newContra = Math.max(0, activeContradictions.length - 1);
    const newHealth = Math.max(0, 100 - overdueDeduction - Math.min(20, newContra * 7) - reviewDeduction);
    effects.push({ kind: "contradiction_resolved", description: `Active contradictions would decrease from ${activeContradictions.length} to ${newContra}`, target_id: change.target_id as string, predicted_values: { old_count: activeContradictions.length, new_count: newContra }, confidence: 1.0 });
    if (newHealth !== healthScore) {
      effects.push({ kind: "health_score_change", description: `Health score would improve from ${healthScore} to ${newHealth}`, predicted_values: { old_score: healthScore, new_score: newHealth, delta: newHealth - healthScore }, confidence: 0.95 });
    }
  } else if (change.kind === "obligation_created") {
    const title = change.params as Record<string, unknown>;
    effects.push({ kind: "new_obligation", description: `New obligation "${title.title ?? "Untitled"}" would be added`, predicted_values: title, confidence: 1.0 });
  } else {
    effects.push({ kind: "health_score_change", description: "Custom change — effects are speculative", predicted_values: { note: change.description }, confidence: 0.3 });
  }

  const highConfidence = effects.filter((e) => e.confidence >= 0.8).length;
  const healthEffect = effects.find((e) => e.kind === "health_score_change");
  let summary = `Simulating: ${change.description ?? change.kind}. ${effects.length} predicted effect${effects.length !== 1 ? "s" : ""} (${highConfidence} high-confidence).`;
  if (healthEffect) {
    const delta = healthEffect.predicted_values.delta as number;
    if (delta > 0) summary += ` Health score would improve by ${delta} points.`;
    else if (delta < 0) summary += ` Health score would decrease by ${Math.abs(delta)} points.`;
  }

  const simId = `sim-${Date.now().toString(36)}`;
  const simulation = {
    id: simId,
    name: name ?? `Simulation ${new Date().toLocaleString()}`,
    change,
    status: "completed",
    baseline_snapshot: snapshot,
    predicted_effects: effects,
    summary,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };

  const simDir2 = path.join(DATA_DIR, "simulations");
  if (!fs.existsSync(simDir2)) fs.mkdirSync(simDir2, { recursive: true });
  fs.writeFileSync(path.join(simDir2, `${simId}.json`), JSON.stringify(simulation, null, 2));

  return res.status(201).json(simulation);
});

// ─── System Health Monitor ───────────────────────────────────────────────────

// GET /api/health — Full system health status with metrics and alerts
app.get("/api/health", (_req, res) => {
  const signals = readJson<Array<{ processed: boolean }>>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  const entities = readJson<Array<{ superseded_by?: string }>>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const obligations = readJson<Array<{ status: string; priority: string; due_date?: string }>>(path.join(DATA_DIR, "state", "obligations.json"), []);
  const contradictions = readJson<Array<{ resolved: boolean }>>(path.join(DATA_DIR, "state", "contradictions.json"), []);
  const reviewItems = readJson<Array<{ status: string; severity?: string; reason?: string }>>(path.join(DATA_DIR, "review", "review_queue.json"), []);
  const workspaces = readJson<Array<{ status: string }>>(path.join(DATA_DIR, "workspaces", "workspaces.json"), []);
  const recipeRuns = readJson<Array<{ status: string }>>(path.join(DATA_DIR, "recipes", "runs.json"), []);

  const signalsProcessed = signals.filter((s) => s.processed).length;
  const unprocessedSignals = signals.filter((s) => !s.processed).length;
  const activeEntities = entities.filter((e) => !e.superseded_by);
  const now3 = new Date();
  const openObligations = obligations.filter((o) => o.status === "open");
  const overdueObligations = openObligations.filter((o) => o.due_date && new Date(o.due_date) < now3);
  const activeContradictions = contradictions.filter((c) => !c.resolved).length;
  const reviewBacklog = reviewItems.filter((r) => r.status === "pending").length;
  const automationFailures = recipeRuns.filter((r) => r.status === "failed").length;

  const obligationsByPriority: Record<string, number> = {};
  for (const ob of openObligations) {
    const p = (ob.priority as string) ?? "unknown";
    obligationsByPriority[p] = (obligationsByPriority[p] ?? 0) + 1;
  }
  const reviewBySeverity: Record<string, number> = {};
  for (const item of reviewItems.filter((r) => r.status === "pending")) {
    const sev = item.severity ?? "medium";
    reviewBySeverity[sev] = (reviewBySeverity[sev] ?? 0) + 1;
  }

  const overdueDeduction = Math.min(30, overdueObligations.length * 10);
  const contradictionDeduction = Math.min(20, activeContradictions * 7);
  const reviewDeduction = Math.min(15, reviewBacklog * 3);
  const failureDeduction = Math.min(10, automationFailures * 5);
  const healthScore = Math.max(0, 100 - overdueDeduction - contradictionDeduction - reviewDeduction - failureDeduction);

  const metrics = {
    collected_at: new Date().toISOString(),
    signals_processed: signalsProcessed,
    unprocessed_signals: unprocessedSignals,
    merge_candidates: reviewItems.filter((r) => r.status === "pending" && r.reason && r.reason.toLowerCase().includes("similar")).length,
    contradictions: activeContradictions,
    review_backlog: reviewBacklog,
    automation_failures: automationFailures,
    entity_count: activeEntities.length,
    workspace_count: workspaces.length,
    open_obligations: openObligations.length,
    overdue_obligations: overdueObligations.length,
    health_score: healthScore,
    review_by_severity: reviewBySeverity,
    obligations_by_priority: obligationsByPriority,
    automation_summary: {
      total_runs: recipeRuns.length,
      completed: recipeRuns.filter((r) => r.status === "completed").length,
      failed: automationFailures,
      pending_approval: recipeRuns.filter((r) => r.status === "pending_approval").length,
    },
  };

  const alerts: Array<{ severity: string; code: string; message: string; value: number; threshold: number }> = [];
  if (overdueObligations.length >= 3) alerts.push({ severity: "critical", code: "OVERDUE_OBLIGATIONS_HIGH", message: `${overdueObligations.length} obligations are overdue`, value: overdueObligations.length, threshold: 3 });
  else if (overdueObligations.length >= 1) alerts.push({ severity: "warning", code: "OVERDUE_OBLIGATIONS", message: `${overdueObligations.length} obligation${overdueObligations.length > 1 ? "s are" : " is"} overdue`, value: overdueObligations.length, threshold: 1 });
  if (activeContradictions >= 3) alerts.push({ severity: "critical", code: "CONTRADICTIONS_HIGH", message: `${activeContradictions} active contradictions`, value: activeContradictions, threshold: 3 });
  else if (activeContradictions >= 1) alerts.push({ severity: "warning", code: "CONTRADICTIONS_ACTIVE", message: `${activeContradictions} active contradiction${activeContradictions > 1 ? "s" : ""} detected`, value: activeContradictions, threshold: 1 });
  if (reviewBacklog >= 10) alerts.push({ severity: "critical", code: "REVIEW_BACKLOG_HIGH", message: `Review queue has ${reviewBacklog} pending items`, value: reviewBacklog, threshold: 10 });
  else if (reviewBacklog >= 5) alerts.push({ severity: "warning", code: "REVIEW_BACKLOG", message: `Review queue has ${reviewBacklog} pending items`, value: reviewBacklog, threshold: 5 });
  if (automationFailures >= 1) alerts.push({ severity: "warning", code: "AUTOMATION_FAILURES", message: `${automationFailures} automation run${automationFailures > 1 ? "s have" : " has"} failed`, value: automationFailures, threshold: 1 });
  if (unprocessedSignals >= 5) alerts.push({ severity: "warning", code: "UNPROCESSED_SIGNALS", message: `${unprocessedSignals} signals awaiting processing`, value: unprocessedSignals, threshold: 5 });

  const hasCritical = alerts.some((a) => a.severity === "critical");
  const hasWarning = alerts.some((a) => a.severity === "warning");
  const status = hasCritical || healthScore < 60 ? "critical" : hasWarning || healthScore < 80 ? "degraded" : "healthy";
  const statusMessage = status === "critical"
    ? `System is in a critical state (score: ${healthScore}/100). Immediate attention required.`
    : status === "degraded"
    ? `System is degraded (score: ${healthScore}/100). Review active alerts.`
    : `System is operating normally (score: ${healthScore}/100).`;

  return res.json({ status, message: statusMessage, metrics, alerts });
});

// GET /api/health/metrics — Metrics only (no alerts)
app.get("/api/health/metrics", (_req, res) => {
  // Redirect to /api/health and return just the metrics
  const signals = readJson<Array<{ processed: boolean }>>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  const entities = readJson<Array<{ superseded_by?: string }>>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const obligations = readJson<Array<{ status: string; priority: string; due_date?: string }>>(path.join(DATA_DIR, "state", "obligations.json"), []);
  const recipeRuns = readJson<Array<{ status: string }>>(path.join(DATA_DIR, "recipes", "runs.json"), []);
  const now4 = new Date();
  const openObs = obligations.filter((o) => o.status === "open");
  const overdueObs = openObs.filter((o) => o.due_date && new Date(o.due_date) < now4);
  return res.json({
    signals_processed: signals.filter((s) => s.processed).length,
    unprocessed_signals: signals.filter((s) => !s.processed).length,
    entity_count: entities.filter((e) => !e.superseded_by).length,
    open_obligations: openObs.length,
    overdue_obligations: overdueObs.length,
    automation_summary: {
      total_runs: recipeRuns.length,
      completed: recipeRuns.filter((r) => r.status === "completed").length,
      failed: recipeRuns.filter((r) => r.status === "failed").length,
    },
  });
});

// ─── Manual Ingest ───────────────────────────────────────────────────────────

// POST /api/ingest/manual — Accept a raw email paste, create a signal, and auto-process it
app.post("/api/ingest/manual", async (req, res) => {
  const { raw_content, from, subject } = req.body as { raw_content?: string; from?: string; subject?: string };
  if (!raw_content || !raw_content.trim()) {
    return res.status(400).json({ error: "raw_content is required" });
  }

  const signalId = `sig-manual-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const signal = {
    id: signalId,
    source: "manual",
    adapter: "manual",
    raw_content: raw_content.trim(),
    metadata: {
      from: from || "manual@paste",
      subject: subject || "Manual ingest",
      date: now,
      thread_id: signalId,
    },
    received_at: now,
    processed: false,
  };

  // Append to signal log
  const logPath = path.join(DATA_DIR, "signals", "signal_log.json");
  const existing = readJson<unknown[]>(logPath, []);
  existing.push(signal);
  try {
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));
  } catch (e) {
    return res.status(500).json({ error: "Failed to save signal" });
  }

  // Auto-process in background (don't block the response)
  processSingle(signal as any, DATA_DIR).then(({ isNoise }) => {
    // Update processed flag in signal log
    const signals = readJson<Array<{ id: string; processed: boolean }>>(logPath, []);
    const idx = signals.findIndex((s) => s.id === signalId);
    if (idx >= 0) { signals[idx].processed = true; fs.writeFileSync(logPath, JSON.stringify(signals, null, 2)); }
    console.log(`[Ingest] ${signalId} processed (noise=${isNoise})`);
  }).catch((err) => console.error(`[Ingest] Processing error for ${signalId}:`, err));

  return res.status(201).json(signal);
});

// POST /api/process/batch — Trigger batch processing of all unprocessed signals
app.post("/api/process/batch", async (req, res) => {
  const max = Number(req.query.limit ?? (req.body as { max?: number })?.max ?? 50);
  try {
    const result = await processBatch({
      dataDir: DATA_DIR,
      maxSignals: max ?? 50,
      onProgress: (done, total, id, noise) => {
        console.log(`[Batch] ${done}/${total} — ${id} (noise=${noise})`);
      },
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /api/process/status — Get processing queue status
app.get("/api/process/status", (req, res) => {
  const logPath = path.join(DATA_DIR, "signals", "signal_log.json");
  const signals = readJson<Array<{ processed: boolean }>> (logPath, []);
  return res.json({
    total: signals.length,
    processed: signals.filter((s) => s.processed).length,
    unprocessed: signals.filter((s) => !s.processed).length,
  });
});

// ─── Gmail OAuth ─────────────────────────────────────────────────────────────

// GET /api/connect/gmail/status — Check Gmail connection status
app.get("/api/connect/gmail/status", (_req, res) => {
  try {
    const status = getSyncStatus(DATA_DIR);
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ connected: false, error: String(err) });
  }
});

// GET /api/connect/gmail/auth — Redirect to Google OAuth consent screen
app.get("/api/connect/gmail/auth", (_req, res) => {
  try {
    const url = getAuthUrl();
    return res.redirect(url);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/connect/gmail/callback — Handle OAuth callback from Google
app.get("/api/connect/gmail/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.status(400).send("<h2>Error: No authorization code received from Google.</h2>");
  }
  try {
    const token = await exchangeCodeForToken(code, DATA_DIR);
    // Trigger initial sync immediately after connecting
    const syncResult = await syncGmailEmails(DATA_DIR, "2026/03/06", 200);
    recordSync(DATA_DIR, syncResult);
    // Redirect back to the app immediately — batch processing runs in background
    const appUrl = process.env.APP_URL ?? "http://localhost:5175";
    res.redirect(`${appUrl}?gmail_connected=1&added=${syncResult.added}`);
    // Start batch processing in background after redirect
    processBatch({ dataDir: DATA_DIR, maxSignals: 150,
      onProgress: (done, total, id, noise) => console.log(`[GmailSync] ${done}/${total} — ${id} (noise=${noise})`),
    }).then((r) => console.log(`[GmailSync] Batch done: ${r.processed} processed, ${r.noise} noise, ${r.errors} errors`))
      .catch((err) => console.error("[GmailSync] Batch error:", err));
    return;
  } catch (err) {
    console.error("[Gmail OAuth] Callback error:", err);
    return res.status(500).send(`<h2>Gmail connection failed</h2><pre>${String(err)}</pre>`);
  }
});

// POST /api/connect/gmail/sync — Manually trigger a Gmail sync and batch-process new signals
app.post("/api/connect/gmail/sync", async (_req, res) => {
  try {
    const result = await syncGmailEmails(DATA_DIR, "2026/03/06", 200);
    recordSync(DATA_DIR, result);
    // Respond immediately, then process new signals in background
    res.json({ success: true, ...result });
    if (result.added > 0) {
      processBatch({ dataDir: DATA_DIR, maxSignals: result.added + 10,
        onProgress: (done, total, id, noise) => console.log(`[Sync] ${done}/${total} — ${id} (noise=${noise})`),
      }).then((r) => console.log(`[Sync] Batch done: ${r.processed} processed, ${r.noise} noise`))
        .catch((err) => console.error("[Sync] Batch error:", err));
    }
    return;
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err) });
  }
});

// DELETE /api/connect/gmail — Disconnect Gmail (remove token)
app.delete("/api/connect/gmail", (_req, res) => {
  try {
    deleteToken(DATA_DIR);
    return res.json({ success: true, message: "Gmail disconnected." });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err) });
  }
});

// ─── Static UI ────────────────────────────────────────────────────────────────

const uiDir = path.resolve(__dirname, "../../ui/dist");
if (fs.existsSync(uiDir)) {
  app.use(express.static(uiDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(uiDir, "index.html"));
  });
}

//// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? "3333", 10);
app.listen(PORT, () => {
  console.log(`[Axiom API] Listening on http://localhost:${PORT}`);
  console.log(`[Axiom API] Data directory: ${DATA_DIR}`);

  // ── Periodic Gmail sync every 15 minutes ──────────────────────────────────
  const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const runPeriodicSync = async () => {
    const status = getSyncStatus(DATA_DIR);
    if (!status.connected) return; // Skip if not connected
    try {
      console.log("[Periodic Sync] Starting Gmail sync…");
      const result = await syncGmailEmails(DATA_DIR);
      if (result.added > 0) {
        console.log(`[Periodic Sync] Added ${result.added} new signals. Running batch processor…`);
        const batchResult = await processBatch({ dataDir: DATA_DIR, maxSignals: 50 });
        console.log(`[Periodic Sync] Processed ${batchResult.processed} signals, ${batchResult.noise} noise.`);
      } else {
        console.log("[Periodic Sync] No new emails.");
      }
    } catch (err) {
      console.error("[Periodic Sync] Error:", err);
    }
  };

  // Run once after 30 seconds (to let the server fully start), then every 15 min
  setTimeout(() => {
    runPeriodicSync();
    setInterval(runPeriodicSync, SYNC_INTERVAL_MS);
  }, 30_000);
});
export default app;
