import fs from "node:fs";

export interface WorldStateSummary {
  last_updated: string;
  current_focus: string[];
  open_obligations: string[];
  high_priority_workspaces: string[];
  upcoming_events_72h: string[];
  unmoved_signals: string[];
  contradictions: string[];
  waiting_chains: string[];
  proposed_actions_queue: string[];
  last_update_provenance: string[];
}

export function updateWorldState(path: string, next: WorldStateSummary): void {
  fs.writeFileSync(
    path,
    JSON.stringify(
      {
        schema_version: "1.0.0",
        ...next
      },
      null,
      2
    )
  );
}
