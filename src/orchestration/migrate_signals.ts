/**
 * migrate_signals.ts
 *
 * One-time migration script: reads all existing signals from
 * data/signals/signal_log.json and converts them into Episodes
 * in data/episodes/episode_log.json.
 *
 * Signals that were already processed and marked as noise are
 * imported as noise episodes. Signals that were processed with
 * results are imported as committed episodes. Unprocessed signals
 * are imported as pending (ready for the orchestrator loop).
 *
 * Run: node dist/src/orchestration/migrate_signals.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EpisodeStore } from "../episodes/episode_store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../../data");

async function migrate(): Promise<void> {
  const signalLogPath = path.join(DATA_DIR, "signals", "signal_log.json");

  if (!fs.existsSync(signalLogPath)) {
    console.log("[migrate] No signal_log.json found. Nothing to migrate.");
    return;
  }

  const signals = JSON.parse(fs.readFileSync(signalLogPath, "utf-8")) as Record<string, unknown>[];
  console.log(`[migrate] Found ${signals.length} signals to migrate.`);

  const episodeStore = new EpisodeStore(DATA_DIR);
  const existing = episodeStore.findAll();
  const existingSourceIds = new Set(
    existing.map((e) => String(e.raw_payload?.["id"] ?? ""))
  );

  let created = 0;
  let skipped = 0;

  for (const signal of signals) {
    const signalId = String(signal["id"] ?? "");

    // Skip if already migrated
    if (existingSourceIds.has(signalId)) {
      skipped++;
      continue;
    }

    const episode = episodeStore.createFromSignal(signal);
    created++;

    const isNoise = Boolean(signal["is_noise"]);
    const isProcessed = Boolean(signal["processed"]);

    console.log(
      `[migrate] ${episode.id} ← ${signalId.slice(0, 20)}... | ` +
      `"${episode.title.slice(0, 50)}" | ` +
      `${isNoise ? "NOISE" : isProcessed ? "committed" : "pending"}`
    );
  }

  // Flush all at once
  episodeStore.findAll(); // triggers internal load; flush happens on each createFromSignal

  console.log(`\n[migrate] Done. Created: ${created}, Skipped (already exists): ${skipped}`);
  console.log(`[migrate] Episode summary:`, episodeStore.getSummary());
}

migrate().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
