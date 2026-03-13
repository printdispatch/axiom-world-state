import { ProvenanceRef } from "../schema/common";

export function requireProvenance(refs: ProvenanceRef[]): void {
  if (!refs || refs.length === 0) {
    throw new Error("Provenance required for world state update.");
  }
}
