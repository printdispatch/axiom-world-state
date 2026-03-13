import { BaseRecord, EntityRef, ISODateTime, PriorityLevel, RiskLevel } from "./common.js";

export type TaskKind =
  | "explicit"
  | "inferred"
  | "delegated"
  | "waiting_on"
  | "recurring"
  | "follow_up";

export interface Task extends BaseRecord {
  type: "task";
  kind: TaskKind;
  title: string;
  description?: string;
  owner_refs: EntityRef[];
  stakeholder_refs: EntityRef[];
  workspace_refs: EntityRef[];
  blocked_by_task_ids: string[];
  depends_on_artifact_ids: string[];
  priority: PriorityLevel;
  risk: RiskLevel;
  due_at?: ISODateTime;
}

export interface Obligation extends BaseRecord {
  type: "obligation";
  title: string;
  description: string;
  owed_by_refs: EntityRef[];
  owed_to_refs: EntityRef[];
  workspace_refs: EntityRef[];
  source_message_ids: string[];
  source_event_ids: string[];
  open: boolean;
  priority: PriorityLevel;
  risk: RiskLevel;
  breach_risk?: "none" | "low" | "medium" | "high";
  due_at?: ISODateTime;
}

export interface WorkflowRecipe extends BaseRecord {
  type: "workflow_recipe";
  name: string;
  intent: string;
  preconditions: string[];
  action_steps: RecipeStep[];
  postconditions: string[];
  approval_requirement: "none" | "low_risk_only" | "always";
  risk: RiskLevel;
  success_count: number;
  failure_count: number;
}

export interface RecipeStep {
  step_number: number;
  action:
    | "read"
    | "extract"
    | "classify"
    | "draft"
    | "notify"
    | "create"
    | "update"
    | "move"
    | "wait"
    | "request_approval";
  instruction: string;
  expected_output?: string;
}
