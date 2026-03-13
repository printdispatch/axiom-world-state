/**
 * SixLayerProcessor
 *
 * The core intelligence engine of the Axiom World State system.
 * For every signal it receives, it:
 *   1. Builds a structured prompt from the signal's content
 *   2. Calls gpt-5-pro via the OpenAI Responses API
 *   3. Parses and validates the structured JSON response
 *   4. Returns a complete ProcessingResult
 *
 * Uses the v1/responses endpoint (required for gpt-5-pro and newer models).
 *
 * This processor is intentionally stateless — it does not read or write
 * world state directly. That is the responsibility of the State Mutation
 * Engine (Phase 4). This processor only produces a ProcessingResult.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { Signal } from "../../schema/signals.js";
import {
  ProcessingResult,
  Layer1RawTruth,
  Layer2EntityLinking,
  Layer3StateCheck,
  Layer4RelationalUpdate,
  Layer5Inference,
  Layer6Agency,
  ProposedAction,
} from "../../schema/processing.js";

// Module directory — resolved relative to project root for Jest compatibility
const _moduleDir = path.resolve(process.cwd(), "src", "engine");

// ─── Configuration ────────────────────────────────────────────────────────────

export interface SixLayerProcessorOptions {
  /** OpenAI model to use. Defaults to gpt-5-pro. */
  model?: string;
  /** Path to the system prompt markdown file. */
  systemPromptPath?: string;
  /** Path to the directory where processing results are stored. */
  storageDir?: string;
  /** OpenAI API key. Defaults to OPENAI_API_KEY env var. */
  apiKey?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";  // gpt-4o-mini: higher rate limits, sufficient for structured extraction
const DEFAULT_PROMPT_PATH = path.resolve(
  _moduleDir,
  "../../prompts/six_layer_processor_prompt.md"
);

// ─── Noise-only result builder ────────────────────────────────────────────────

function buildNoiseResult(
  signalId: string,
  model: string,
  noiseReason: string
): ProcessingResult {
  const now = new Date().toISOString();
  const emptyLayer6: Layer6Agency = {
    proposed_actions: [
      {
        rank: 1,
        kind: "archive_signal",
        description: "Archive this signal as noise — no action required.",
        target_entities: [],
        risk: "low",
        requires_approval: false,
        rationale: noiseReason,
        expected_outcome: "Signal archived without processing.",
      },
      {
        rank: 2,
        kind: "archive_signal",
        description: "No second action required for noise signals.",
        target_entities: [],
        risk: "low",
        requires_approval: false,
        rationale: "Noise signal.",
        expected_outcome: "No action.",
      },
      {
        rank: 3,
        kind: "archive_signal",
        description: "No third action required for noise signals.",
        target_entities: [],
        risk: "low",
        requires_approval: false,
        rationale: "Noise signal.",
        expected_outcome: "No action.",
      },
    ] as [ProposedAction, ProposedAction, ProposedAction],
    any_requires_approval: false,
    confidence: 1.0,
  };

  return {
    id: crypto.randomUUID(),
    signal_id: signalId,
    processed_at: now,
    model,
    is_noise: true,
    layer_1: {
      raw_facts: [],
      is_noise: true,
      noise_reason: noiseReason,
    },
    layer_2: {
      entity_candidates: [],
      matched_entity_ids: [],
      proposed_new_entities: [],
      similarity_conflicts: [],
    },
    layer_3: {
      state_updates: [],
      unchanged_entities: [],
      ambiguities: [],
    },
    layer_4: {
      new_obligations: [],
      updated_obligations: [],
      dependency_changes: [],
    },
    layer_5: {
      inferences: [],
      risk_flags: [],
      priority_estimates: [],
      missing_information: [],
    },
    layer_6: emptyLayer6,
  };
}

// ─── SixLayerProcessor Class ──────────────────────────────────────────────────

export class SixLayerProcessor {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly storageDir: string | null;

  constructor(options: SixLayerProcessorOptions = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_BASE,
    });
    this.model = options.model ?? DEFAULT_MODEL;

    const promptPath = options.systemPromptPath ?? DEFAULT_PROMPT_PATH;
    this.systemPrompt = fs.readFileSync(promptPath, "utf-8");

    this.storageDir = options.storageDir ?? null;
    if (this.storageDir && !fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Processes a signal through all six layers.
   * Uses the OpenAI Responses API (v1/responses) which supports gpt-5-pro.
   *
   * @param signal - The signal to process
   * @returns A complete ProcessingResult
   */
  async process(signal: Signal): Promise<ProcessingResult> {
    const userMessage = this.buildUserMessage(signal);

    // Use the Chat Completions API with JSON mode
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error(`SixLayerProcessor: Empty response from model ${this.model}`);
    }

    const parsed = JSON.parse(rawContent) as {
      layer_1: Layer1RawTruth;
      layer_2: Layer2EntityLinking;
      layer_3: Layer3StateCheck;
      layer_4: Layer4RelationalUpdate;
      layer_5: Layer5Inference;
      layer_6: Layer6Agency;
    };

    // If the model classified this as noise, return a minimal noise result
    if (parsed.layer_1?.is_noise) {
      return buildNoiseResult(
        signal.id,
        this.model,
        parsed.layer_1.noise_reason ?? "Classified as noise by model."
      );
    }

    const result: ProcessingResult = {
      id: crypto.randomUUID(),
      signal_id: signal.id,
      processed_at: new Date().toISOString(),
      model: this.model,
      is_noise: false,
      layer_1: parsed.layer_1,
      layer_2: parsed.layer_2,
      layer_3: parsed.layer_3,
      layer_4: parsed.layer_4,
      layer_5: parsed.layer_5,
      layer_6: parsed.layer_6,
    };

    // Persist the result to disk if a storage directory was provided
    if (this.storageDir) {
      this.persist(result);
    }

    return result;
  }

  /**
   * Builds the user message that will be sent to the model.
   * Includes all signal metadata and the raw text content.
   */
  private buildUserMessage(signal: Signal): string {
    // Truncate to 3000 chars to stay within token limits for gpt-4o-mini
    const content = signal.raw_text.length > 3000
      ? signal.raw_text.slice(0, 3000) + "\n[... truncated ...]"
      : signal.raw_text;
    return [
      `SIGNAL ID: ${signal.id}`,
      `SOURCE: ${signal.source_kind}`,
      `OBSERVED AT: ${signal.observed_at}`,
      `TITLE: ${signal.title}`,
      ``,
      `--- RAW CONTENT ---`,
      content,
      `--- END CONTENT ---`,
      ``,
      `Process this signal through all six layers and return the JSON result.`,
    ].join("\n");
  }

  /**
   * Persists a ProcessingResult to the storage directory.
   */
  private persist(result: ProcessingResult): void {
    if (!this.storageDir) return;
    const logPath = path.join(this.storageDir, "processing_log.json");
    let existing: ProcessingResult[] = [];
    if (fs.existsSync(logPath)) {
      existing = JSON.parse(fs.readFileSync(logPath, "utf-8")) as ProcessingResult[];
    }
    existing.push(result);
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), "utf-8");
  }
}
