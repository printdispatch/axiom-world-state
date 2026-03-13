import { BaseRecord, EntityRef, ISODateTime, SourceKind, StalenessLevel } from "./common";

export type SignalKind =
  | "incoming_message"
  | "calendar_change"
  | "file_created"
  | "file_modified"
  | "payment_event"
  | "shipment_update"
  | "browser_capture"
  | "notification"
  | "system_alert"
  | "manual_note";

export interface Signal extends BaseRecord {
  type: "signal";
  signal_kind: SignalKind;
  source_kind: SourceKind;
  source_external_id?: string;
  title: string;
  raw_payload_path?: string;
  raw_text: string;
  observed_at: ISODateTime;
  parsed: boolean;
  linked_entity_refs: EntityRef[];
  moved_to_state: boolean;
  staleness: StalenessLevel;
  stale_after_hours: number;
}
