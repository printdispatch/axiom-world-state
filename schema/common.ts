export type UUID = string;
export type ISODateTime = string;
export type URLString = string;

export type ConfidenceScore = number;
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PriorityLevel = "low" | "normal" | "high" | "urgent";
export type StalenessLevel = "fresh" | "aging" | "stale" | "expired";
export type Status =
  | "active"
  | "pending"
  | "waiting"
  | "blocked"
  | "completed"
  | "cancelled"
  | "archived";

export type SourceKind =
  | "email"
  | "calendar"
  | "sms"
  | "slack"
  | "call"
  | "voicemail"
  | "document"
  | "file"
  | "browser"
  | "payment"
  | "shipment"
  | "system"
  | "manual"
  | "derived";

export interface ProvenanceRef {
  source_id: UUID;
  source_kind: SourceKind;
  source_label: string;
  source_excerpt?: string;
  observed_at: ISODateTime;
}

export interface AuditFields {
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: string;
  updated_by: string;
}

export interface BaseRecord extends AuditFields {
  id: UUID;
  schema_version: string;
  status: Status;
  tags: string[];
  provenance: ProvenanceRef[];
}

export interface EntityRef {
  id: UUID;
  domain:
    | "identity"
    | "workspaces"
    | "communications"
    | "artifacts"
    | "execution"
    | "time"
    | "resources"
    | "signals"
    | "interpretation"
    | "memory";
  type: string;
  label: string;
}

export interface SimilarityCandidate {
  candidate_id: UUID;
  domain: string;
  score: number;
  resolution: "merge" | "create_new" | "needs_review";
}
