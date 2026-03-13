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

// GET /api/audit
app.get("/api/audit", (_req, res) => {
  const log = readJson<unknown[]>(path.join(DATA_DIR, "state", "audit_log.json"), []);
  res.json([...log].reverse());
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
