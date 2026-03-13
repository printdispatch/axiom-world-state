/**
 * SignalStore
 *
 * Responsible for persisting Signal objects to the local signal log.
 * All signals are append-only — raw signals are never destroyed.
 * This is the Phase 1 file-based implementation. In a later phase this
 * will be replaced by a database-backed store.
 */

import fs from "node:fs";
import path from "node:path";
import { Signal } from "../../schema/signals.js";

export interface SignalStoreOptions {
  /** Absolute path to the directory where signal logs are stored. */
  storageDir: string;
}

export class SignalStore {
  private readonly logPath: string;

  constructor(options: SignalStoreOptions) {
    if (!fs.existsSync(options.storageDir)) {
      fs.mkdirSync(options.storageDir, { recursive: true });
    }
    this.logPath = path.join(options.storageDir, "signal_log.json");

    // Initialize the log file if it does not exist
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, JSON.stringify([], null, 2), "utf-8");
    }
  }

  /**
   * Persists a Signal to the append-only signal log.
   * Throws if the signal already exists (duplicate external_id + source_kind).
   */
  append(signal: Signal): void {
    const existing = this.readAll();

    // Duplicate detection: same external_id from the same source
    if (signal.source_external_id) {
      const duplicate = existing.find(
        (s) =>
          s.source_external_id === signal.source_external_id &&
          s.source_kind === signal.source_kind
      );
      if (duplicate) {
        throw new Error(
          `Duplicate signal: external_id="${signal.source_external_id}" from source_kind="${signal.source_kind}" already exists as id="${duplicate.id}".`
        );
      }
    }

    existing.push(signal);
    fs.writeFileSync(this.logPath, JSON.stringify(existing, null, 2), "utf-8");
  }

  /**
   * Returns all signals in the log.
   */
  readAll(): Signal[] {
    const raw = fs.readFileSync(this.logPath, "utf-8");
    return JSON.parse(raw) as Signal[];
  }

  /**
   * Returns a single signal by its internal UUID.
   */
  findById(id: string): Signal | undefined {
    return this.readAll().find((s) => s.id === id);
  }

  /**
   * Returns all unprocessed signals (signals that have not yet been moved to state).
   */
  findUnprocessed(): Signal[] {
    return this.readAll().filter((s) => !s.moved_to_state);
  }

  /**
   * Marks a signal as processed (moved to world state).
   */
  markProcessed(id: string): void {
    const all = this.readAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) {
      throw new Error(`Signal not found: id="${id}"`);
    }
    all[idx].moved_to_state = true;
    all[idx].updated_at = new Date().toISOString();
    fs.writeFileSync(this.logPath, JSON.stringify(all, null, 2), "utf-8");
  }

  /**
   * Returns the total count of signals in the log.
   */
  count(): number {
    return this.readAll().length;
  }
}
