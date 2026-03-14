/**
 * DeltaStore
 *
 * Append-only persistence layer for Deltas.
 * Every Delta produced by the CognitionService is stored here before
 * being committed to the WorldState. This provides a full audit trail
 * of every interpretation the system has ever made.
 *
 * Storage: data/episodes/delta_log.json
 */

import fs from "node:fs";
import path from "node:path";
import { Delta } from "../../schema/delta.js";
import { UUID } from "../../schema/common.js";

export class DeltaStore {
  private readonly filePath: string;
  private deltas: Map<UUID, Delta>;

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, "episodes", "delta_log.json");
    this.deltas = new Map();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Delta[];
        for (const d of raw) {
          this.deltas.set(d.id, d);
        }
      }
    } catch {
      // Start fresh if file is corrupt
    }
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify([...this.deltas.values()], null, 2),
      "utf-8"
    );
  }

  append(delta: Delta): void {
    this.deltas.set(delta.id, delta);
    this.flush();
  }

  findById(id: UUID): Delta | undefined {
    return this.deltas.get(id);
  }

  findByEpisodeId(episodeId: UUID): Delta | undefined {
    return [...this.deltas.values()].find((d) => d.episode_id === episodeId);
  }

  findAll(): Delta[] {
    return [...this.deltas.values()].sort(
      (a, b) => b.produced_at.localeCompare(a.produced_at)
    );
  }

  getRecent(limit = 20): Delta[] {
    return this.findAll().slice(0, limit);
  }
}
