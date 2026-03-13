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
