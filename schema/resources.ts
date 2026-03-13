import { BaseRecord, EntityRef, ISODateTime, RiskLevel } from "./common.js";

export type ResourceKind =
  | "invoice"
  | "payment"
  | "subscription"
  | "shipment"
  | "inventory_item"
  | "asset"
  | "license"
  | "budget"
  | "expense";

export interface ResourceRecord extends BaseRecord {
  type: "resource_record";
  kind: ResourceKind;
  title: string;
  amount?: number;
  currency?: string;
  owner_refs: EntityRef[];
  workspace_refs: EntityRef[];
  due_at?: ISODateTime;
  state:
    | "draft"
    | "scheduled"
    | "paid"
    | "unpaid"
    | "late"
    | "cancelled"
    | "delivered"
    | "delayed"
    | "active"
    | "inactive";
  risk: RiskLevel;
  external_reference?: string;
}
