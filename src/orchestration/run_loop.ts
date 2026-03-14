/**
 * run_loop.ts
 *
 * CLI runner for the Axiom Orchestration Loop.
 *
 * Usage:
 *   node dist/src/orchestration/run_loop.js              # process all pending episodes
 *   node dist/src/orchestration/run_loop.js --episode ep-abc123  # process one episode
 *   node dist/src/orchestration/run_loop.js --migrate    # migrate signals first, then process
 *
 * This is the entry point for running the ceremonial loop manually or
 * from a cron job / scheduled task.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { EpisodeStore } from "../episodes/episode_store.js";
import { DeltaStore } from "../episodes/delta_store.js";
import { CognitionService } from "../engine/cognition_service.js";
import { Orchestrator } from "./orchestrator.js";
import { JsonEntityStore, JsonObligationStore } from "./stores.js";
import { EventBus } from "../event_bus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../../data");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doMigrate = args.includes("--migrate");
  const episodeArg = args.indexOf("--episode");
  const singleEpisodeId = episodeArg >= 0 ? args[episodeArg + 1] : null;

  console.log("[Axiom Loop] Starting...");
  console.log(`[Axiom Loop] Data dir: ${DATA_DIR}`);

  // ── Migrate signals first if requested ────────────────────────────────────
  if (doMigrate) {
    console.log("[Axiom Loop] Running signal migration...");
    // Inline migration: read signals and create episodes
    const fs = await import("node:fs");
    const path = await import("node:path");
    const signalLogPath = path.join(DATA_DIR, "signals", "signal_log.json");
    if (fs.existsSync(signalLogPath)) {
      const signals = JSON.parse(fs.readFileSync(signalLogPath, "utf-8")) as Record<string, unknown>[];
      const episodeStoreTmp = new EpisodeStore(DATA_DIR);
      const existing = episodeStoreTmp.findAll();
      const existingSourceIds = new Set(existing.map((e) => String(e.raw_payload?.["id"] ?? "")));
      let created = 0;
      for (const signal of signals) {
        const signalId = String(signal["id"] ?? "");
        if (!existingSourceIds.has(signalId)) {
          episodeStoreTmp.createFromSignal(signal);
          created++;
        }
      }
      console.log(`[Axiom Loop] Migration: ${created} episodes created`);
    }
  }

  // ── Initialize stores ─────────────────────────────────────────────────────
  const episodeStore = new EpisodeStore(DATA_DIR);
  const deltaStore = new DeltaStore(DATA_DIR);
  const entityStore = new JsonEntityStore(DATA_DIR);
  const obligationStore = new JsonObligationStore(DATA_DIR);
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

  // ── Listen for processed events ───────────────────────────────────────────
  eventBus.on("episode_processed", (payload: Record<string, unknown>) => {
    if (payload["isNoise"]) {
      console.log(`  [loop] Noise: ${payload["episodeId"]}`);
    } else {
      const cr = payload["commitResult"] as Record<string, unknown> | undefined;
      if (cr) {
        console.log(
          `  [loop] Committed ${payload["episodeId"]}: ` +
          `+${cr["entities_created"]} entities, +${cr["obligations_created"]} obligations`
        );
      }
    }
  });

  // ── Run ───────────────────────────────────────────────────────────────────
  if (singleEpisodeId) {
    console.log(`[Axiom Loop] Processing single episode: ${singleEpisodeId}`);
    const result = await orchestrator.runLoop(singleEpisodeId);
    if (result) {
      console.log("\n[Axiom Loop] Result:");
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    const pending = episodeStore.findByStatus("pending");
    console.log(`[Axiom Loop] Found ${pending.length} pending episodes`);

    if (pending.length === 0) {
      console.log("[Axiom Loop] Nothing to process. Run with --migrate to import signals first.");
      return;
    }

    const summary = await orchestrator.processPending();
    console.log("\n[Axiom Loop] Complete:");
    console.log(`  Processed: ${summary.processed}`);
    console.log(`  Noise:     ${summary.noise}`);
    console.log(`  Failed:    ${summary.failed}`);

    console.log("\n[Axiom Loop] Episode summary:", episodeStore.getSummary());
  }
}

main().catch((err) => {
  console.error("[Axiom Loop] Fatal error:", err);
  process.exit(1);
});
