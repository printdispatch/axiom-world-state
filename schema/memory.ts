import { BaseRecord, EntityRef, ISODateTime } from "./common";

export type MemoryKind =
  | "episodic_summary"
  | "daily_digest"
  | "meeting_brief"
  | "relationship_summary"
  | "workspace_summary"
  | "retrieval_chunk";

export interface MemoryRecord extends BaseRecord {
  type: "memory_record";
  kind: MemoryKind;
  title: string;
  subject_refs: EntityRef[];
  summary_text: string;
  source_refs: string[];
  valid_from?: ISODateTime;
  valid_until?: ISODateTime;
  supersedes_memory_id?: string;
}
