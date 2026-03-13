import { BaseRecord, EntityRef, ISODateTime, PriorityLevel } from "./common";

export type EventKind =
  | "meeting"
  | "deadline"
  | "appointment"
  | "travel"
  | "reminder"
  | "maintenance"
  | "shipment_eta"
  | "billing_due"
  | "other";

export interface Event extends BaseRecord {
  type: "event";
  kind: EventKind;
  title: string;
  start_at: ISODateTime;
  end_at?: ISODateTime;
  timezone?: string;
  participant_refs: EntityRef[];
  workspace_refs: EntityRef[];
  location?: string;
  preparation_state?: "none" | "needed" | "in_progress" | "ready";
  priority: PriorityLevel;
  requires_briefing: boolean;
}
