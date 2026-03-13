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
  const entities = readJson<Array<{ id: string; canonical_name: string }>>(path.join(DATA_DIR, "entities", "entities.json"), []);
  const entity = entities.find((e) => e.id === entityId);
  if (!entity) return res.status(404).json({ error: "Entity not found" });

  // Find all state updates referencing this entity
  const stateUpdates = readJson<Array<{ entity_label: string; signal_id: string; mutated_at: string; field: string; new_value: string; source_fact: string }>>(path.join(DATA_DIR, "state", "state_updates.json"), []);
  const entityUpdates = stateUpdates.filter((u) =>
    u.entity_label?.toLowerCase() === entity.canonical_name?.toLowerCase()
  );

  // Find all signals that produced those updates
  const signals = readJson<Array<{ id: string; metadata: { subject: string; from: string; date: string }; received_at: string; source: string }>>(path.join(DATA_DIR, "signals", "signal_log.json"), []);
  const signalIds = [...new Set(entityUpdates.map((u) => u.signal_id))];
  const relatedSignals = signals.filter((s) => signalIds.includes(s.id));

  // Find obligations related to this entity
  const obligations = readJson<Array<{ owed_by: string; owed_to: string; title: string; status: string; priority: string; created_at: string }>>(path.join(DATA_DIR, "state", "obligations.json"), []);
  const entityObligations = obligations.filter((o) =>
    o.owed_by?.toLowerCase().includes(entity.canonical_name?.toLowerCase()) ||
    o.owed_to?.toLowerCase().includes(entity.canonical_name?.toLowerCase())
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
app.post("/api/review/:id/decide", (req, res) => {
  const { decision, note } = req.body as { decision: string; note?: string };
  const validDecisions = ["approved", "rejected", "resolved", "deferred"];
  if (!validDecisions.includes(decision)) {
    return res.status(400).json({ error: `Invalid decision. Must be one of: ${validDecisions.join(", ")}` });
  }

  const reviewPath = path.join(DATA_DIR, "review", "review_queue.json");
  const items = readJson<Array<{ id: string; status: string; decision?: string; decision_note?: string; decided_at?: string }>>(reviewPath, []);
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Review item not found" });

  item.status = "reviewed";
  item.decision = decision;
  item.decision_note = note;
  item.decided_at = new Date().toISOString();

  const dir = path.dirname(reviewPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reviewPath, JSON.stringify(items, null, 2));

  return res.json(item);
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

// ─── Static UI ────────────────────────────────────────────────────────────────

const uiDir = path.resolve(__dirname, "../../ui/dist");
if (fs.existsSync(uiDir)) {
  app.use(express.static(uiDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(uiDir, "index.html"));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3333", 10);
app.listen(PORT, () => {
  console.log(`[Axiom API] Listening on http://localhost:${PORT}`);
  console.log(`[Axiom API] Data directory: ${DATA_DIR}`);
});

export default app;
