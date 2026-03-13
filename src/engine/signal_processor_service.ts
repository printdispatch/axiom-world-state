/**
 * Signal Processor Service
 *
 * Wraps the SixLayerProcessor with:
 *  - Smart pre-filter: marks obvious spam/newsletters as noise without calling the AI
 *  - Auto-processing: converts raw Gmail signals into the Signal schema and runs them
 *  - State mutation: applies processing results to obligations, entities, contradictions
 *  - Batch processing: processes all unprocessed signals in the log
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SixLayerProcessor } from "./six_layer_processor.js";

// ─── Types (matching the raw Gmail signal format in signal_log.json) ──────────

interface RawGmailSignal {
  id: string;
  source: string;
  adapter: string;
  raw_content: string;
  metadata: {
    from: string;
    subject: string;
    date: string;
    thread_id: string;
    message_id?: string;
    labels?: string[];
  };
  received_at: string;
  processed: boolean;
}

interface ProcessingResult {
  id: string;
  signal_id: string;
  processed_at: string;
  model: string;
  is_noise: boolean;
  layer_1: {
    raw_facts: Array<{ fact: string; source_ref: string }>;
    is_noise: boolean;
    noise_reason?: string;
  };
  layer_2: {
    entity_candidates: Array<{ label: string; domain: string; likely_existing: boolean; lookup_key: string; email?: string }>;
    matched_entity_ids: string[];
    proposed_new_entities: unknown[];
    similarity_conflicts: unknown[];
  };
  layer_3: {
    state_updates: Array<{ entity_label: string; entity_domain: string; field: string; new_value: string; source_fact: string; signal_id?: string; mutated_at?: string }>;
    unchanged_entities: string[];
    ambiguities: Array<{ description: string; entities_involved: string[] }>;
  };
  layer_4: {
    new_obligations: Array<{ title: string; description: string; owed_by: string; owed_to: string; priority: string; due_hint?: string; source_fact: string }>;
    updated_obligations: unknown[];
    dependency_changes: unknown[];
  };
  layer_5: {
    inferences: Array<{ statement: string; confidence: number; based_on_facts: string[]; risk_if_wrong: string }>;
    risk_flags: Array<{ description: string; risk_level: string; entity_label: string }>;
    priority_estimates: unknown[];
    missing_information: unknown[];
  };
  layer_6: {
    proposed_actions: Array<{
      rank: number; kind: string; description: string;
      target_entities: string[]; risk: string;
      requires_approval: boolean; rationale: string; expected_outcome: string;
    }>;
    any_requires_approval: boolean;
    confidence: number;
  };
}

// ─── Noise Pre-filter ─────────────────────────────────────────────────────────

/**
 * Domains and patterns that are always noise — never send to AI.
 * This saves API calls and keeps the feed clean.
 */
const NOISE_SENDER_DOMAINS = [
  "uber.com", "ubereats.com",
  "nextdoor.com", "rs.email", "ss.email", "reply@rs.email", "reply@ss.email",
  "no-reply@rs.email", "no-reply@ss.email",
  "noreply@rs.email", "noreply@ss.email",
  "email.nextdoor.com", "digest@nextdoor.com",
  "lakeviewcourt", "neighborhood",
  "pinterest.com", "explore.pinterest.com", "discover.pinterest.com", "pinterest-recommendations",
  "creativemarketmail.com", "creativemarket.com", "hello@creativemarket",
  "movoto.com", "email.movoto.com", "customercare@email.movoto",
  "tldrnewsletter.com", "dan@tldrnewsletter",
  "academia.edu", "premium@academia",
  "resend.trustmrr.com", "trustmrr.com",
  "newsletter.printful.com", "updates-en@newsletter.printful",
  "canvacreate.com", "engage.canva.com",
  "growthinreverse.com",
  "email.self.inc", "self.inc", "no-reply@email.self.inc",
  "reventure.app", "nick@reventure",
  "supabase.com", "ant.wilson@supabase",
  "freepik.com", "noreply@freepik", "info@freepik",
  "accounts.google.com", "no-reply@accounts.google",
];

const NOISE_SUBJECT_PATTERNS = [
  /^(re:\s*)?(fw:\s*)?unsubscribe/i,
  /\b(newsletter|weekly digest|daily digest|weekly update|roundup)\b/i,
  /\b(deal|discount|sale|off|promo|savings|offer)\b.*\b(\d+%|\$\d+)\b/i,
  /\b(new homes?|open house|real estate|listing)\b/i,
  /\b(nextdoor|lakeview court|neighbors?)\b/i,
  /\b(pinterest|creative market|uber eats|uber)\b/i,
  /\b(tldr|academia mentions?)\b/i,
  /\b(trustmrr daily)\b/i,
  /\b(printful|canva create)\b/i,
  /\b(growth in reverse)\b/i,
  /\b(movoto|homes? in)\b/i,
  /\b(top post|trending post|free items|lost.{0,10}found|alerts? in)\b/i,
  /^security alert/i,  // Google security alerts
  /\b(supa update|year one|annual letter)\b/i,
  /\b(housing data|ran the numbers)\b/i,
  // Community board / neighborhood posts
  /\b(lost (dog|cat|pet)|found (dog|cat|pet)|missing (dog|cat|pet))\b/i,
  /\b(garage sale|yard sale|rummage sale|estate sale)\b/i,
  /\b(babysit|nanny|childcare|dog (walk|sit|board))\b/i,
  /\b(tennis lesson|piano lesson|tutoring|lawn (care|service|mow))\b/i,
  /\b(for sale|free to good home|free.*pickup|pickup.*free)\b/i,
  /\b(neighborhood (post|update|alert|watch))\b/i,
  /\b(community (post|update|alert|board))\b/i,
  /\b(airbnb|air bnb).*review/i,  // Airbnb review requests
  /^(your|a) (neighbor|nearby) (posted|shared|replied)/i,
];

// Patterns that FORCE processing regardless of sender — these are business signals
const FORCE_PROCESS_PATTERNS = [
  /invoice|payment|quote|proposal|contract|agreement/i,
  /artwork|design|proof|revision|mockup|file|asset/i,
  /coupon|book|print|printing|order|job|project/i,
  /wetransfer|we transfer|file.*download|download.*file/i,
  /billing|charge|subscription|renewal|failed|expire|auto-renew/i,
  /client|customer|vendor|supplier/i,
  /deadline|due|urgent|asap|rush/i,
  /flyer|banner|sign|signage|logo|branding/i,
  /^re:|^fwd:|^fw:/i,  // email replies and forwards (at start of subject) are almost always business
];

const FORCE_PROCESS_SENDERS = [
  "wetransfer.com",
  "noreply@wetransfer.com",
  "squarespace.com",
  "no-reply@squarespace.com",
  "cloudflare.com",
  "noreply@notify.cloudflare.com",
  "github.com",
  "manus.im",
];

function isNoise(signal: RawGmailSignal): { noise: boolean; reason: string } {
  const subject = signal.metadata.subject || "";
  const from = signal.metadata.from || "";
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const contentPreview = signal.raw_content.slice(0, 800);

  // First check: force-process overrides everything
  for (const pattern of FORCE_PROCESS_PATTERNS) {
    if (pattern.test(subject) || pattern.test(from) || pattern.test(contentPreview)) {
      return { noise: false, reason: "" };
    }
  }
  for (const domain of FORCE_PROCESS_SENDERS) {
    if (fromLower.includes(domain)) {
      return { noise: false, reason: "" };
    }
  }

  // Check noise sender domains
  for (const domain of NOISE_SENDER_DOMAINS) {
    if (fromLower.includes(domain)) {
      return { noise: true, reason: `Sender domain matches noise list: ${domain}` };
    }
  }

  // Check noise subject patterns
  for (const pattern of NOISE_SUBJECT_PATTERNS) {
    if (pattern.test(subjectLower)) {
      return { noise: true, reason: `Subject matches noise pattern: ${pattern.source}` };
    }
  }

  // Check Gmail labels — if CATEGORY_PROMOTIONS or CATEGORY_SOCIAL, it's noise
  const labels = signal.metadata.labels ?? [];
  if (labels.includes("CATEGORY_PROMOTIONS") || labels.includes("CATEGORY_SOCIAL")) {
    return { noise: true, reason: `Gmail category: ${labels.find(l => l.startsWith("CATEGORY_"))}` };
  }

  return { noise: false, reason: "" };
}

// ─── Signal Converter ─────────────────────────────────────────────────────────

/**
 * Converts a raw Gmail signal (from signal_log.json) into the Signal schema
 * expected by SixLayerProcessor.
 */
function toProcessorSignal(raw: RawGmailSignal) {
  return {
    id: raw.id,
    type: "signal" as const,
    signal_kind: "incoming_message" as const,
    source_kind: raw.adapter === "gmail" ? "email" : "manual_note",
    title: raw.metadata.subject || "(no subject)",
    raw_text: raw.raw_content,
    observed_at: raw.received_at,
    parsed: false,
    linked_entity_refs: [],
    moved_to_state: false,
    staleness: "fresh" as const,
    stale_after_hours: 168,
  };
}

// ─── State Mutation ───────────────────────────────────────────────────────────

function applyResultToState(result: ProcessingResult, dataDir: string): void {
  const now = new Date().toISOString();

  // ── Entities ──────────────────────────────────────────────────────────────
  // API reads from data/entities/entities.json as an array
  const entityArrayPath = path.join(dataDir, "entities", "entities.json");
  let entityArray: Array<{ id: string; name: string; type: string; lookup_key?: string }> = [];
  try {
    entityArray = JSON.parse(fs.readFileSync(entityArrayPath, "utf-8"));
  } catch { entityArray = []; }

  for (const candidate of result.layer_2.entity_candidates) {
    const key = candidate.lookup_key;
    const exists = entityArray.some((e) => e.lookup_key === key || e.name === candidate.label);
    if (!exists) {
      entityArray.push({
        id: `ent-${crypto.randomUUID().slice(0, 8)}`,
        name: candidate.label,
        type: candidate.domain === "person" ? "person" : candidate.domain === "organization" ? "organization" : "artifact",
        lookup_key: key,
        ...(candidate.email ? { email: candidate.email } : {}),
        source_signal_id: result.signal_id,
        created_at: now,
        aliases: [candidate.label],
      } as any);
    }
  }
  if (!fs.existsSync(path.join(dataDir, "entities"))) {
    fs.mkdirSync(path.join(dataDir, "entities"), { recursive: true });
  }
  fs.writeFileSync(entityArrayPath, JSON.stringify(entityArray, null, 2));

  // ── Obligations ───────────────────────────────────────────────────────────
  if (result.layer_4.new_obligations.length > 0) {
    const obPath = path.join(dataDir, "state", "obligations.json");
    let obligations: unknown[] = [];
    try {
      obligations = JSON.parse(fs.readFileSync(obPath, "utf-8"));
    } catch { obligations = []; }

    for (const ob of result.layer_4.new_obligations) {
      obligations.push({
        id: `ob-${crypto.randomUUID().slice(0, 8)}`,
        title: ob.title,
        description: ob.description,
        owed_by: ob.owed_by,
        owed_to: ob.owed_to,
        priority: ob.priority,
        status: "open",
        due_hint: ob.due_hint,
        source_signal_id: result.signal_id,
        created_at: now,
      });
    }
    fs.writeFileSync(obPath, JSON.stringify(obligations, null, 2));
  }

  // ── State Updates ─────────────────────────────────────────────────────────
  if (result.layer_3.state_updates.length > 0) {
    const updatesPath = path.join(dataDir, "state", "state_updates.json");
    let updates: unknown[] = [];
    try {
      updates = JSON.parse(fs.readFileSync(updatesPath, "utf-8"));
    } catch { updates = []; }

    for (const upd of result.layer_3.state_updates) {
      updates.push({ ...upd, signal_id: result.signal_id, mutated_at: now });
    }
    fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2));
  }

  // ── Review Queue (high-risk actions requiring approval) ───────────────────
  const highRiskActions = result.layer_6.proposed_actions.filter(
    (a) => a.requires_approval || a.risk === "high" || a.risk === "critical"
  );
  if (highRiskActions.length > 0 || result.layer_5.risk_flags.length > 0) {
    const reviewPath = path.join(dataDir, "review", "review_queue.json");
    let queue: unknown[] = [];
    try {
      queue = JSON.parse(fs.readFileSync(reviewPath, "utf-8"));
    } catch { queue = []; }

    if (highRiskActions.length > 0) {
      queue.push({
        id: `rev-${crypto.randomUUID().slice(0, 8)}`,
        kind: "high_risk_action",
        title: highRiskActions[0].description,
        description: highRiskActions[0].rationale,
        severity: highRiskActions[0].risk === "critical" ? "critical" : "high",
        status: "pending",
        signal_id: result.signal_id,
        requires_approval: true,
        created_at: now,
        action_description: highRiskActions[0].description,
        action_risk: highRiskActions[0].risk,
      });
    }

    for (const flag of result.layer_5.risk_flags) {
      if (flag.risk_level === "high" || flag.risk_level === "critical") {
        queue.push({
          id: `rev-${crypto.randomUUID().slice(0, 8)}`,
          kind: "contradiction",
          title: flag.description,
          description: flag.description,
          severity: flag.risk_level,
          status: "pending",
          signal_id: result.signal_id,
          entity_ids: [flag.entity_label],
          requires_approval: false,
          created_at: now,
        });
      }
    }
    fs.writeFileSync(reviewPath, JSON.stringify(queue, null, 2));
  }
}

// ─── Main Processor Service ───────────────────────────────────────────────────

export interface ProcessBatchOptions {
  dataDir: string;
  maxSignals?: number;
  onProgress?: (processed: number, total: number, signalId: string, isNoise: boolean) => void;
}

export interface BatchResult {
  total: number;
  processed: number;
  noise: number;
  errors: number;
  skipped: number;
}

/**
 * Process all unprocessed signals in the signal log.
 * Uses the pre-filter to skip obvious noise without calling the AI.
 */
export async function processBatch(options: ProcessBatchOptions): Promise<BatchResult> {
  const { dataDir, maxSignals = 50 } = options;

  const logPath = path.join(dataDir, "signals", "signal_log.json");
  let signals: RawGmailSignal[] = [];
  try {
    signals = JSON.parse(fs.readFileSync(logPath, "utf-8"));
  } catch {
    return { total: 0, processed: 0, noise: 0, errors: 0, skipped: 0 };
  }

  const unprocessed = signals.filter((s) => !s.processed);
  const toProcess = unprocessed.slice(0, maxSignals);

  const processor = new SixLayerProcessor({
    storageDir: path.join(dataDir, "processing"),
  });

  const result: BatchResult = {
    total: unprocessed.length,
    processed: 0,
    noise: 0,
    errors: 0,
    skipped: unprocessed.length - toProcess.length,
  };

  for (const raw of toProcess) {
    try {
      const { noise, reason } = isNoise(raw);

      if (noise) {
        // Mark as processed (noise) without calling AI
        raw.processed = true;
        (raw as any).is_noise = true;
        result.noise++;
        options.onProgress?.(result.processed + result.noise, toProcess.length, raw.id, true);
        continue;
      }

      // Convert to processor signal format and run through AI
      const signal = toProcessorSignal(raw);
      const processingResult = await processor.process(signal as any);

      // Apply state mutations
      if (!processingResult.is_noise) {
        applyResultToState(processingResult, dataDir);
      }

      raw.processed = true;
      (raw as any).is_noise = processingResult.is_noise;
      result.processed++;
      options.onProgress?.(result.processed + result.noise, toProcess.length, raw.id, processingResult.is_noise);

    } catch (err) {
      console.error(`[ProcessorService] Error processing ${raw.id}:`, err);
      result.errors++;
      // Don't mark as processed so it can be retried
    }
  }

  // Write back updated signal log with processed flags
  fs.writeFileSync(logPath, JSON.stringify(signals, null, 2));

  return result;
}

/**
 * Process a single signal immediately (used for real-time ingest).
 */
export async function processSingle(raw: RawGmailSignal, dataDir: string): Promise<{ isNoise: boolean; result?: ProcessingResult }> {
  const { noise, reason } = isNoise(raw);

  if (noise) {
    return { isNoise: true };
  }

  const processor = new SixLayerProcessor({
    storageDir: path.join(dataDir, "processing"),
  });

  const signal = toProcessorSignal(raw);
  const result = await processor.process(signal as any);

  if (!result.is_noise) {
    applyResultToState(result, dataDir);
  }

  return { isNoise: result.is_noise, result };
}
