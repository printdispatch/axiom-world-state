export interface SixLayerOutput {
  layer_1_raw_truth: {
    raw_facts: string[];
    source_refs: string[];
  };
  layer_2_entity_linking: {
    entity_candidates: string[];
    matched_entities: string[];
    proposed_new_entities: string[];
    similarity_candidates: string[];
  };
  layer_3_state_check: {
    state_updates: string[];
    unchanged_entities: string[];
    ambiguities: string[];
  };
  layer_4_relational_update: {
    new_obligations: string[];
    updated_obligations: string[];
    dependency_changes: string[];
  };
  layer_5_inference: {
    inferences: string[];
    risk_flags: string[];
    priority_estimates: string[];
    missing_information: string[];
  };
  layer_6_agency: {
    proposed_actions: string[];
    approval_required: boolean;
    action_rationale: string[];
  };
}

export function runIngestLoop(_input: unknown): SixLayerOutput {
  return {
    layer_1_raw_truth: {
      raw_facts: [],
      source_refs: []
    },
    layer_2_entity_linking: {
      entity_candidates: [],
      matched_entities: [],
      proposed_new_entities: [],
      similarity_candidates: []
    },
    layer_3_state_check: {
      state_updates: [],
      unchanged_entities: [],
      ambiguities: []
    },
    layer_4_relational_update: {
      new_obligations: [],
      updated_obligations: [],
      dependency_changes: []
    },
    layer_5_inference: {
      inferences: [],
      risk_flags: [],
      priority_estimates: [],
      missing_information: []
    },
    layer_6_agency: {
      proposed_actions: [],
      approval_required: false,
      action_rationale: []
    }
  };
}
