import { SimilarityCandidate } from "../schema/common.js";

export interface NormalizeInput {
  domain: string;
  candidate: Record<string, unknown>;
  existing: Record<string, unknown>[];
}

export interface NormalizeOutput {
  action: "merge" | "create_new" | "needs_review";
  similarity_candidates: SimilarityCandidate[];
  chosen_id?: string;
}

export function normalizeEntity(input: NormalizeInput): NormalizeOutput {
  return {
    action: "needs_review",
    similarity_candidates: []
  };
}
