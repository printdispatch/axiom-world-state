/**
 * Episode Schema
 *
 * An Episode is the atomic, immutable unit of observation in the Axiom system.
 * It is created once when an external event is captured and never modified.
 *
 * Episodes are the raw material that the CognitionService interprets.
 * They replace the previous `Signal` object as the primary input to the loop.
 *
 * Inspired by Graphiti's episode-based ingestion pattern:
 * https://github.com/getzep/graphiti
 */

import { UUID, ISODateTime, SourceKind, ProvenanceRef } from "./common.js";

export type EpisodeStatus =
  | "pending"      // Received, not yet interpreted
  | "interpreting" // Currently being processed by CognitionService
  | "committed"    // Delta has been committed to WorldState
  | "noise"        // Classified as noise, no delta produced
  | "failed";      // Processing failed

export interface Episode {
  id: UUID;                                    // "ep-{uuid}"
  schema_version: "1.0.0";
  source_kind: SourceKind;
  provenance: ProvenanceRef[];
  observed_at: ISODateTime;
  title: string;
  raw_text: string;
  raw_payload: Record<string, unknown>;        // Full source adapter payload
  status: EpisodeStatus;
  is_noise: boolean;
  noise_reason?: string;
  delta_id?: UUID;                             // ID of the committed Delta, if any
  committed_at?: ISODateTime;
  error?: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/**
 * EpisodeStore
 *
 * Append-only store for Episodes. Episodes are never deleted or modified
 * except to update their processing status.
 */
export interface EpisodeStore {
  append(episode: Episode): void;
  findById(id: UUID): Episode | undefined;
  findByStatus(status: EpisodeStatus): Episode[];
  findAll(): Episode[];
  updateStatus(id: UUID, status: EpisodeStatus, extra?: Partial<Episode>): void;
}
