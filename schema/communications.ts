import { BaseRecord, EntityRef, ISODateTime, PriorityLevel } from "./common.js";

export type ChannelKind =
  | "email"
  | "sms"
  | "slack"
  | "call"
  | "voicemail"
  | "meeting"
  | "social_dm"
  | "note";

export interface CommunicationThread extends BaseRecord {
  type: "communication_thread";
  channel: ChannelKind;
  subject?: string;
  participant_refs: EntityRef[];
  workspace_refs: EntityRef[];
  last_message_at?: ISODateTime;
  unresolved: boolean;
  outstanding_request_ids: string[];
  sentiment?: "positive" | "neutral" | "negative" | "tense" | "unknown";
}

export interface Message extends BaseRecord {
  type: "message";
  thread_id: string;
  channel: ChannelKind;
  sender_ref: EntityRef;
  recipient_refs: EntityRef[];
  subject?: string;
  body_text: string;
  body_summary?: string;
  attachments: string[];
  contains_commitment: boolean;
  contains_deadline: boolean;
  inferred_priority?: PriorityLevel;
  external_message_id?: string;
  sent_at?: ISODateTime;
}
