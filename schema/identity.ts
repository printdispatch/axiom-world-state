import { BaseRecord, ISODateTime } from "./common";

export type PersonRole =
  | "self"
  | "family"
  | "friend"
  | "client"
  | "lead"
  | "vendor"
  | "coworker"
  | "employee"
  | "manager"
  | "advisor"
  | "unknown";

export interface Person extends BaseRecord {
  type: "person";
  full_name: string;
  aliases: string[];
  emails: string[];
  phones: string[];
  organization_ids: string[];
  roles: PersonRole[];
  timezone?: string;
  preferred_channels: string[];
  trust_level?: number;
  relationship_strength?: number;
  last_interaction_at?: ISODateTime;
}

export interface Organization extends BaseRecord {
  type: "organization";
  legal_name: string;
  display_name: string;
  aliases: string[];
  domains: string[];
  member_ids: string[];
  workspace_ids: string[];
  billing_status?: "current" | "late" | "delinquent" | "unknown";
}

export interface Account extends BaseRecord {
  type: "account";
  provider: string;
  username_or_address: string;
  account_kind:
    | "email"
    | "calendar"
    | "bank"
    | "crm"
    | "cloud_storage"
    | "messaging"
    | "social"
    | "other";
  owner_id: string;
  last_synced_at?: ISODateTime;
}
