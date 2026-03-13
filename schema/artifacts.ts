import { BaseRecord, EntityRef, ISODateTime, URLString } from "./common.js";

export type ArtifactKind =
  | "document"
  | "pdf"
  | "image"
  | "spreadsheet"
  | "slide_deck"
  | "design_file"
  | "contract"
  | "invoice"
  | "receipt"
  | "recording"
  | "web_link"
  | "form"
  | "code"
  | "other";

export interface Artifact extends BaseRecord {
  type: "artifact";
  kind: ArtifactKind;
  title: string;
  canonical_uri?: URLString;
  file_path?: string;
  mime_type?: string;
  checksum?: string;
  owner_refs: EntityRef[];
  related_workspace_ids: string[];
  related_thread_ids: string[];
  supersedes_artifact_id?: string;
  superseded_by_artifact_id?: string;
  version_label?: string;
  extracted_text?: string;
  extracted_fields?: Record<string, string | number | boolean | null>;
  approval_state?: "draft" | "review" | "approved" | "rejected" | "obsolete";
  last_modified_at?: ISODateTime;
}
