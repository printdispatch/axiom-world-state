/**
 * Orchestration Routes
 *
 * New API endpoints for the Axiom Orchestration Loop.
 * These are added to the existing Express app alongside the current routes.
 *
 * New Endpoints:
 *   GET  /api/episodes              — All episodes (newest first)
 *   GET  /api/episodes/:id          — Single episode with its delta
 *   GET  /api/episodes/pending      — Pending episodes awaiting processing
 *   POST /api/episodes/process      — Run the orchestration loop on pending episodes
 *   POST /api/episodes/:id/process  — Run the loop on a single episode
 *   GET  /api/deltas                — All deltas (newest first)
 *   GET  /api/deltas/:id            — Single delta
 *   GET  /api/loop/status           — Current loop status and summary
 */

import { Router } from "express";
import { EpisodeStore } from "../episodes/episode_store.js";
import { DeltaStore } from "../episodes/delta_store.js";
import { CognitionService } from "../engine/cognition_service.js";
import { Orchestrator } from "../orchestration/orchestrator.js";
import { JsonEntityStore, JsonObligationStore } from "../orchestration/stores.js";
import { EventBus } from "../event_bus.js";

export function createOrchestrationRouter(dataDir: string): Router {
  const router = Router();

  // Lazy-initialize stores (shared across requests)
  const episodeStore = new EpisodeStore(dataDir);
  const deltaStore = new DeltaStore(dataDir);
  const entityStore = new JsonEntityStore(dataDir);
  const obligationStore = new JsonObligationStore(dataDir);
  const eventBus = new EventBus();
  const cognitionService = new CognitionService(process.env.OPENAI_MODEL ?? "gpt-4o-mini");

  const orchestrator = new Orchestrator({
    episodeStore,
    deltaStore,
    cognitionService,
    eventBus,
    entityStore,
    obligationStore,
  });

  // ── Episodes ─────────────────────────────────────────────────────────────────

  // GET /api/episodes — All episodes, newest first
  router.get("/episodes", (_req, res) => {
    const episodes = episodeStore.findAll();
    res.json(episodes);
  });

  // GET /api/episodes/summary — Summary counts
  router.get("/episodes/summary", (_req, res) => {
    res.json(episodeStore.getSummary());
  });

  // GET /api/episodes/pending — Only pending episodes
  router.get("/episodes/pending", (_req, res) => {
    res.json(episodeStore.findByStatus("pending"));
  });

  // GET /api/episodes/:id — Single episode with its delta
  router.get("/episodes/:id", (req, res) => {
    const episode = episodeStore.findById(req.params.id);
    if (!episode) return res.status(404).json({ error: "Episode not found" });
    const delta = episode.delta_id ? deltaStore.findById(episode.delta_id) : null;
    return res.json({ episode, delta });
  });

  // POST /api/episodes/process — Run the loop on all pending episodes
  router.post("/episodes/process", async (_req, res) => {
    const pending = episodeStore.findByStatus("pending");
    if (pending.length === 0) {
      return res.json({ message: "No pending episodes to process", processed: 0, noise: 0, failed: 0 });
    }
    // Run async, respond immediately with job info
    res.json({
      message: `Processing ${pending.length} pending episodes in background`,
      episode_ids: pending.map((e) => e.id),
    });
    // Run in background
    orchestrator.processPending()
      .then((r) => console.log(`[Orchestrator] Batch complete: ${JSON.stringify(r)}`))
      .catch((err) => console.error("[Orchestrator] Batch error:", err));
    return;
  });

  // POST /api/episodes/:id/process — Run the loop on a single episode
  router.post("/episodes/:id/process", async (req, res) => {
    const episode = episodeStore.findById(req.params.id);
    if (!episode) return res.status(404).json({ error: "Episode not found" });

    try {
      const result = await orchestrator.runLoop(req.params.id);
      if (!result) {
        const updated = episodeStore.findById(req.params.id);
        return res.json({ message: `Episode ${updated?.status ?? "processed"}`, episode: updated });
      }
      return res.json({ message: "Loop complete", commit_result: result });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/episodes/migrate — Migrate existing signals to episodes
  router.post("/episodes/migrate", async (_req, res) => {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const signalLogPath = path.join(dataDir, "signals", "signal_log.json");

      if (!fs.existsSync(signalLogPath)) {
        return res.json({ message: "No signal log found", created: 0 });
      }

      const signals = JSON.parse(fs.readFileSync(signalLogPath, "utf-8")) as Record<string, unknown>[];
      const existing = episodeStore.findAll();
      const existingSourceIds = new Set(
        existing.map((e) => String(e.raw_payload?.["id"] ?? ""))
      );

      let created = 0;
      let skipped = 0;

      for (const signal of signals) {
        const signalId = String(signal["id"] ?? "");
        if (existingSourceIds.has(signalId)) { skipped++; continue; }
        episodeStore.createFromSignal(signal);
        created++;
      }

      return res.json({
        message: `Migration complete`,
        created,
        skipped,
        summary: episodeStore.getSummary(),
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── Deltas ────────────────────────────────────────────────────────────────────

  // GET /api/deltas — All deltas, newest first
  router.get("/deltas", (_req, res) => {
    const limit = 50;
    res.json(deltaStore.getRecent(limit));
  });

  // GET /api/deltas/:id — Single delta
  router.get("/deltas/:id", (req, res) => {
    const delta = deltaStore.findById(req.params.id);
    if (!delta) return res.status(404).json({ error: "Delta not found" });
    return res.json(delta);
  });

  // ── Loop Status ───────────────────────────────────────────────────────────────

  // GET /api/loop/status — Current loop status
  router.get("/loop/status", (_req, res) => {
    const episodeSummary = episodeStore.getSummary();
    const recentDeltas = deltaStore.getRecent(5);
    const recentEpisodes = episodeStore.findAll().slice(0, 5);

    res.json({
      episode_summary: episodeSummary,
      recent_episodes: recentEpisodes.map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        is_noise: e.is_noise,
        observed_at: e.observed_at,
        committed_at: e.committed_at,
      })),
      recent_deltas: recentDeltas.map((d) => ({
        id: d.id,
        episode_id: d.episode_id,
        is_noise: d.is_noise,
        interpretation_summary: d.interpretation_summary,
        entity_changes: d.entity_changes.length,
        obligation_changes: d.obligation_changes.length,
        confidence: d.confidence_overall,
        produced_at: d.produced_at,
      })),
    });
  });

  return router;
}
