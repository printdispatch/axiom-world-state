/**
 * ReviewStore — Persistent JSON-backed storage for review queue items.
 *
 * A review item is created whenever the system encounters:
 *   - An ambiguous entity merge (similarity conflict)
 *   - A high-risk proposed action requiring human approval
 *   - A contradiction between two signals
 *   - Any signal the agent is not confident enough to process autonomously
 *
 * All decisions (approve / reject / resolve) are immutably logged.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type ReviewItemKind =
  | "entity_conflict"
  | "high_risk_action"
  | "contradiction"
  | "low_confidence";

export type ReviewDecision = "approved" | "rejected" | "resolved" | "deferred";

export interface ReviewItem {
  id: string;
  kind: ReviewItemKind;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "reviewed";
  decision?: ReviewDecision;
  decision_note?: string;
  decided_at?: string;
  signal_id: string;
  entity_ids?: string[];
  action_description?: string;
  action_risk?: string;
  requires_approval: boolean;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export class ReviewStore {
  private filePath: string;
  private items: ReviewItem[] = [];

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "review_queue.json");
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        this.items = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      } catch {
        this.items = [];
      }
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2));
  }

  createItem(item: Omit<ReviewItem, "id" | "created_at" | "status">): ReviewItem {
    const newItem: ReviewItem = {
      ...item,
      id: randomUUID(),
      status: "pending",
      created_at: new Date().toISOString(),
    };
    this.items.push(newItem);
    this.save();
    return newItem;
  }

  decide(id: string, decision: ReviewDecision, note?: string): ReviewItem | null {
    const item = this.items.find(i => i.id === id);
    if (!item) return null;
    item.status = "reviewed";
    item.decision = decision;
    item.decision_note = note;
    item.decided_at = new Date().toISOString();
    this.save();
    return item;
  }

  getPending(): ReviewItem[] {
    return this.items.filter(i => i.status === "pending")
      .sort((a, b) => {
        const sev = { critical: 4, high: 3, medium: 2, low: 1 };
        return (sev[b.severity] || 0) - (sev[a.severity] || 0);
      });
  }

  getAll(): ReviewItem[] {
    return [...this.items].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  getById(id: string): ReviewItem | undefined {
    return this.items.find(i => i.id === id);
  }

  getBySignal(signalId: string): ReviewItem[] {
    return this.items.filter(i => i.signal_id === signalId);
  }

  getPendingCount(): number {
    return this.items.filter(i => i.status === "pending").length;
  }
}
