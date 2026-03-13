import {
  BaseRecord,
  ConfidenceScore,
  EntityRef,
  ISODateTime,
  PriorityLevel,
  RiskLevel,
  StalenessLevel
} from "./common";

export interface InferenceRecord extends BaseRecord {
  type: "inference_record";
  subject_refs: EntityRef[];
  summary: string;
  priority: PriorityLevel;
  risk: RiskLevel;
  confidence: ConfidenceScore;
  staleness: StalenessLevel;
  contradiction_flags: string[];
  missing_information: string[];
  inferred_at: ISODateTime;
}

export interface InterpretationPolicy extends BaseRecord {
  type: "interpretation_policy";
  domain_name: string;
  max_confidence_without_human_review: number;
  stale_after_hours: number;
  escalation_threshold: RiskLevel;
}
