/**
 * EpisodeStore
 *
 * Append-only persistence layer for Episodes.
 * Episodes are the immutable raw observations that feed the Ceremonial Loop.
 *
 * Storage: data/episodes/episode_log.json
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Episode, EpisodeStatus } from "../../schema/episodes.js";
import { UUID, ISODateTime, SourceKind, ProvenanceRef } from "../../schema/common.js";

export class EpisodeStore {
  private readonly filePath: string;
  private episodes: Map<UUID, Episode>;

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, "episodes", "episode_log.json");
    this.episodes = new Map();
    this.load();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Episode[];
        for (const ep of raw) {
          this.episodes.set(ep.id, ep);
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
      JSON.stringify([...this.episodes.values()], null, 2),
      "utf-8"
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Creates and appends a new Episode from raw adapter data.
   * Returns the created Episode.
   */
  create(input: {
    source_kind: SourceKind;
    provenance: ProvenanceRef[];
    observed_at: ISODateTime;
    title: string;
    raw_text: string;
    raw_payload: Record<string, unknown>;
    source_external_id?: string;
  }): Episode {
    const now = new Date().toISOString();
    const episode: Episode = {
      id: `ep-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      schema_version: "1.0.0",
      source_kind: input.source_kind,
      provenance: input.provenance,
      observed_at: input.observed_at,
      title: input.title,
      raw_text: input.raw_text,
      raw_payload: input.raw_payload,
      status: "pending",
      is_noise: false,
      created_at: now,
      updated_at: now,
    };
    this.episodes.set(episode.id, episode);
    this.flush();
    return episode;
  }

  /**
   * Creates an Episode from an existing signal (for migration of existing data).
   */
  createFromSignal(signal: Record<string, unknown>): Episode {
    const now = new Date().toISOString();
    const isNoise = Boolean(signal["is_noise"]);
    const episode: Episode = {
      id: `ep-${String(signal["id"] ?? randomUUID()).replace(/^sig-gmail-/, "")}`,
      schema_version: "1.0.0",
      source_kind: "email",
      provenance: [{
        source_id: String(signal["id"] ?? ""),
        source_kind: "email",
        source_label: String((signal["metadata"] as Record<string, unknown>)?.["from"] ?? "unknown"),
        observed_at: String(signal["received_at"] ?? now),
      }],
      observed_at: String(signal["received_at"] ?? now),
      title: String((signal["metadata"] as Record<string, unknown>)?.["subject"] ?? signal["title"] ?? ""),
      raw_text: String(signal["raw_content"] ?? ""),
      raw_payload: signal as Record<string, unknown>,
      status: isNoise ? "noise" : (signal["processed"] ? "committed" : "pending"),
      is_noise: isNoise,
      created_at: String(signal["received_at"] ?? now),
      updated_at: now,
    };
    this.episodes.set(episode.id, episode);
    return episode;
  }

  append(episode: Episode): void {
    this.episodes.set(episode.id, episode);
    this.flush();
  }

  findById(id: UUID): Episode | undefined {
    return this.episodes.get(id);
  }

  findByStatus(status: EpisodeStatus): Episode[] {
    return [...this.episodes.values()].filter((e) => e.status === status);
  }

  findAll(): Episode[] {
    return [...this.episodes.values()].sort(
      (a, b) => b.observed_at.localeCompare(a.observed_at)
    );
  }

  updateStatus(id: UUID, status: EpisodeStatus, extra?: Partial<Episode>): void {
    const ep = this.episodes.get(id);
    if (!ep) throw new Error(`EpisodeStore: Episode not found: ${id}`);
    Object.assign(ep, { status, updated_at: new Date().toISOString(), ...extra });
    this.episodes.set(id, ep);
    this.flush();
  }

  /**
   * Check if an episode already exists for a given external ID (deduplication).
   */
  findByExternalId(externalId: string): Episode | undefined {
    return [...this.episodes.values()].find((e) =>
      e.raw_payload?.["id"] === externalId ||
      (e.raw_payload?.["metadata"] as Record<string, unknown>)?.["message_id"] === externalId
    );
  }

  getSummary(): { total: number; pending: number; committed: number; noise: number; failed: number } {
    const all = [...this.episodes.values()];
    return {
      total: all.length,
      pending: all.filter((e) => e.status === "pending").length,
      committed: all.filter((e) => e.status === "committed").length,
      noise: all.filter((e) => e.status === "noise").length,
      failed: all.filter((e) => e.status === "failed").length,
    };
  }
}
