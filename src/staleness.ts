import { StalenessLevel } from "../schema/common";

export function computeStaleness(observedAtISO: string, nowISO: string): StalenessLevel {
  const observed = new Date(observedAtISO).getTime();
  const now = new Date(nowISO).getTime();
  const hours = (now - observed) / (1000 * 60 * 60);

  if (hours <= 24) return "fresh";
  if (hours <= 72) return "aging";
  if (hours <= 168) return "stale";
  return "expired";
}
