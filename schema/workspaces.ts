import { BaseRecord, EntityRef, ISODateTime, PriorityLevel, RiskLevel } from "./common";

export type WorkspaceKind =
  | "project"
  | "case"
  | "deal"
  | "client_job"
  | "personal_goal"
  | "household"
  | "travel"
  | "health"
  | "financial";

export interface Workspace extends BaseRecord {
  type: "workspace";
  kind: WorkspaceKind;
  title: string;
  description?: string;
  owner_refs: EntityRef[];
  participant_refs: EntityRef[];
  related_artifact_ids: string[];
  related_thread_ids: string[];
  related_task_ids: string[];
  related_event_ids: string[];
  lifecycle_stage:
    | "intake"
    | "planning"
    | "active"
    | "waiting"
    | "review"
    | "completed"
    | "archived";
  priority: PriorityLevel;
  risk: RiskLevel;
  next_deadline_at?: ISODateTime;
  current_summary?: string;
}
