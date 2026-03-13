/**
 * Axiom Action Engine
 *
 * Handles the consequences of every user decision:
 *   - Review decisions (Approve, Resolve, Reject, Defer) → real state changes
 *   - Notes → task creation
 *   - Task resolution → obligation closure + entity update
 *   - Learned noise → teach the filter from Reject decisions
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReviewDecision = "approve" | "resolve" | "reject" | "defer";

export interface ReviewItem {
  id: string;
  signal_id: string;
  title: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "resolved" | "rejected" | "deferred";
  note?: string;
  decided_at?: string;
  obligation_id?: string; // linked task if one was created
  snooze_until?: string;
  // Signal context for learned noise
  signal_from?: string;
  signal_subject?: string;
}

export interface Obligation {
  id: string;
  title: string;
  description: string;
  owed_by: string;
  owed_to: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "done" | "cancelled";
  due_date: string;
  created_at: string;
  completed_at?: string;
  source_signal_id?: string;
  source_review_id?: string;
  note?: string;
}

export interface LearnedNoise {
  senders: string[];
  subject_patterns: string[];
  domains: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw || raw === "") return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function riskToPriority(risk: string): Obligation["priority"] {
  if (risk === "critical") return "critical";
  if (risk === "high") return "high";
  if (risk === "medium") return "medium";
  return "low";
}

function riskToDueDays(risk: string): number {
  if (risk === "critical") return 1;
  if (risk === "high") return 3;
  if (risk === "medium") return 7;
  return 14;
}

// ─── Core action functions ────────────────────────────────────────────────────

/**
 * Apply a review decision to a review item.
 * Returns the updated item and any side-effect description.
 */
export function applyReviewDecision(
  dataDir: string,
  itemId: string,
  decision: ReviewDecision,
  note: string
): { success: boolean; item?: ReviewItem; obligation?: Obligation; message: string } {
  const reviewPath = path.join(dataDir, "review/review_queue.json");
  const obligationsPath = path.join(dataDir, "state/obligations.json");
  const noisePath = path.join(dataDir, "signals/learned_noise.json");

  const queue = readJson<ReviewItem[]>(reviewPath, []);
  const idx = queue.findIndex((r) => r.id === itemId);
  if (idx === -1) return { success: false, message: `Review item ${itemId} not found` };

  const item = queue[idx];
  item.status = decision === "approve" ? "approved"
    : decision === "resolve" ? "resolved"
    : decision === "reject" ? "rejected"
    : "deferred";
  item.note = note || item.note;
  item.decided_at = new Date().toISOString();

  let obligation: Obligation | undefined;
  let message = "";

  if (decision === "approve") {
    // Create a task from this review item
    obligation = {
      id: `ob-${uuidv4().slice(0, 8)}`,
      title: item.title,
      description: note || item.description,
      owed_by: "printdispatch",
      owed_to: item.signal_from || "Self",
      priority: riskToPriority(item.risk_level),
      status: "open",
      due_date: daysFromNow(riskToDueDays(item.risk_level)),
      created_at: new Date().toISOString(),
      source_signal_id: item.signal_id,
      source_review_id: item.id,
      note: note,
    };
    item.obligation_id = obligation.id;
    const obligations = readJson<Obligation[]>(obligationsPath, []);
    obligations.push(obligation);
    writeJson(obligationsPath, obligations);
    message = `Task created: "${obligation.title}" (due ${new Date(obligation.due_date).toLocaleDateString()})`;

  } else if (decision === "resolve") {
    // If there's a linked obligation, close it
    if (item.obligation_id) {
      const obligations = readJson<Obligation[]>(obligationsPath, []);
      const obIdx = obligations.findIndex((o) => o.id === item.obligation_id);
      if (obIdx !== -1) {
        obligations[obIdx].status = "done";
        obligations[obIdx].completed_at = new Date().toISOString();
        if (note) obligations[obIdx].note = note;
        writeJson(obligationsPath, obligations);
        message = `Task "${obligations[obIdx].title}" marked as done.`;
      } else {
        message = "Review item resolved. No linked task found.";
      }
    } else {
      message = "Review item resolved.";
    }

  } else if (decision === "reject") {
    // Teach the noise filter
    const noise = readJson<LearnedNoise>(noisePath, { senders: [], subject_patterns: [], domains: [] });
    if (item.signal_from && !noise.senders.includes(item.signal_from)) {
      noise.senders.push(item.signal_from);
    }
    // Extract domain from sender
    const domainMatch = item.signal_from?.match(/@([\w.-]+)/);
    if (domainMatch) {
      const domain = domainMatch[1].toLowerCase();
      if (!noise.domains.includes(domain)) noise.domains.push(domain);
    }
    writeJson(noisePath, noise);
    message = `Rejected and learned: future emails from "${item.signal_from || "this sender"}" will be filtered as noise.`;

  } else if (decision === "defer") {
    item.snooze_until = daysFromNow(7);
    message = `Deferred for 7 days (reappears ${new Date(item.snooze_until).toLocaleDateString()}).`;
  }

  queue[idx] = item;
  writeJson(reviewPath, queue);

  return { success: true, item, obligation, message };
}

/**
 * Resolve a task (obligation) directly from the Tasks tab.
 */
export function resolveObligation(
  dataDir: string,
  obligationId: string,
  note?: string
): { success: boolean; message: string } {
  const obligationsPath = path.join(dataDir, "state/obligations.json");
  const obligations = readJson<Obligation[]>(obligationsPath, []);
  const idx = obligations.findIndex((o) => o.id === obligationId);
  if (idx === -1) return { success: false, message: `Obligation ${obligationId} not found` };

  obligations[idx].status = "done";
  obligations[idx].completed_at = new Date().toISOString();
  if (note) obligations[idx].note = note;
  writeJson(obligationsPath, obligations);

  // Also resolve any linked review item
  const reviewPath = path.join(dataDir, "review/review_queue.json");
  const queue = readJson<ReviewItem[]>(reviewPath, []);
  const reviewIdx = queue.findIndex((r) => r.obligation_id === obligationId);
  if (reviewIdx !== -1) {
    queue[reviewIdx].status = "resolved";
    queue[reviewIdx].decided_at = new Date().toISOString();
    writeJson(reviewPath, queue);
  }

  return { success: true, message: `Task "${obligations[idx].title}" marked as done.` };
}

/**
 * Snooze a task — push due date forward by N days.
 */
export function snoozeObligation(
  dataDir: string,
  obligationId: string,
  days = 3
): { success: boolean; message: string } {
  const obligationsPath = path.join(dataDir, "state/obligations.json");
  const obligations = readJson<Obligation[]>(obligationsPath, []);
  const idx = obligations.findIndex((o) => o.id === obligationId);
  if (idx === -1) return { success: false, message: `Obligation ${obligationId} not found` };

  const current = new Date(obligations[idx].due_date || new Date());
  current.setDate(current.getDate() + days);
  obligations[idx].due_date = current.toISOString();
  writeJson(obligationsPath, obligations);

  return { success: true, message: `Due date pushed to ${current.toLocaleDateString()}.` };
}

/**
 * Get entity context: signals it appears in + obligations linked to it.
 */
export function getEntityContext(
  dataDir: string,
  entityName: string
): {
  signals: unknown[];
  open_obligations: unknown[];
  closed_obligations: unknown[];
} {
  const signalsPath = path.join(dataDir, "signals/signal_log.json");
  const obligationsPath = path.join(dataDir, "state/obligations.json");
  const processingPath = path.join(dataDir, "processing/processing_log.json");

  const signals = readJson<any[]>(signalsPath, []);
  const obligations = readJson<any[]>(obligationsPath, []);
  const processing = readJson<any[]>(processingPath, []);

  const nameLower = entityName.toLowerCase();

  // Find signals that mention this entity (via processing results)
  const relevantSignalIds = new Set<string>();
  for (const proc of processing) {
    const entities: any[] = proc.result?.entities || [];
    const mentions = entities.some((e: any) =>
      (e.name || e.canonical_name || "").toLowerCase().includes(nameLower)
    );
    if (mentions) relevantSignalIds.add(proc.signal_id);
  }

  const relevantSignals = signals
    .filter((s) => relevantSignalIds.has(s.id))
    .map((s) => ({
      id: s.id,
      subject: s.subject,
      from: s.from,
      received_at: s.received_at || s.timestamp,
    }));

  // Find obligations linked to this entity
  const linked = obligations.filter((o) =>
    (o.owed_by || "").toLowerCase().includes(nameLower) ||
    (o.owed_to || "").toLowerCase().includes(nameLower) ||
    (o.title || "").toLowerCase().includes(nameLower) ||
    (o.description || "").toLowerCase().includes(nameLower)
  );

  return {
    signals: relevantSignals,
    open_obligations: linked.filter((o) => o.status === "open" || o.status === "in_progress"),
    closed_obligations: linked.filter((o) => o.status === "done" || o.status === "cancelled"),
  };
}

/**
 * Get the learned noise list.
 */
export function getLearnedNoise(dataDir: string): LearnedNoise {
  const noisePath = path.join(dataDir, "signals/learned_noise.json");
  return readJson<LearnedNoise>(noisePath, { senders: [], subject_patterns: [], domains: [] });
}
