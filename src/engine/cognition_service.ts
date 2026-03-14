/**
 * CognitionService
 *
 * The "Engine" — the active cognition layer of Axiom.
 *
 * Responsibilities:
 *   1. interpret(episode, worldContext) → Delta
 *      Analyzes an Episode in the context of the current World State.
 *      Returns a Delta of proposed changes. Never writes to state directly.
 *
 *   2. deliberate(worldContext) → ProposedActions[]
 *      Reads the current World State and reasons about what should happen next.
 *      Returns a list of candidate actions ranked by urgency.
 *
 * This service encapsulates all AI calls. The Orchestrator calls this service
 * and then decides what to do with the output.
 */

import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { Episode } from "../../schema/episodes.js";
import { Delta, EntityChange, ObligationChange, FactChange, ContradictionFound } from "../../schema/delta.js";

// ─── World Context ────────────────────────────────────────────────────────────
// A lightweight snapshot of current world state passed to the engine.
// The engine reads this but never writes to it.

export interface WorldContext {
  entities: Array<{ id: string; name: string; type: string; aliases: string[] }>;
  open_obligations: Array<{ id: string; title: string; owed_by: string; owed_to: string; status: string }>;
  recent_facts: Array<{ entity_name: string; property: string; value: string; valid_from: string }>;
}

// ─── CognitionService ─────────────────────────────────────────────────────────

export class CognitionService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(model = "gpt-4o-mini") {
    this.client = new OpenAI();
    this.model = model;
  }

  /**
   * INTERPRET
   *
   * Analyzes an Episode in the context of the current World State.
   * Returns a Delta of proposed changes — does NOT write to state.
   *
   * This is the core cognitive operation. The prompt gives the model:
   *   - The raw episode content
   *   - The current entities and obligations (world context)
   *   - Instructions to produce a structured Delta
   */
  async interpret(episode: Episode, worldContext: WorldContext): Promise<Delta> {
    const systemPrompt = this.buildSystemPrompt(worldContext);
    const userMessage = this.buildUserMessage(episode);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("CognitionService: Empty response from model");

    const parsed = JSON.parse(raw) as {
      is_noise: boolean;
      noise_reason?: string;
      interpretation_summary: string;
      confidence_overall: number;
      entity_changes: EntityChange[];
      obligation_changes: ObligationChange[];
      fact_changes: FactChange[];
      contradictions_found: ContradictionFound[];
      proposed_actions: Delta["proposed_actions"];
    };

    const delta: Delta = {
      id: `delta-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      episode_id: episode.id,
      produced_at: new Date().toISOString(),
      is_noise: parsed.is_noise ?? false,
      noise_reason: parsed.noise_reason,
      interpretation_summary: parsed.interpretation_summary ?? "",
      confidence_overall: parsed.confidence_overall ?? 0.5,
      entity_changes: parsed.entity_changes ?? [],
      obligation_changes: parsed.obligation_changes ?? [],
      fact_changes: parsed.fact_changes ?? [],
      contradictions_found: parsed.contradictions_found ?? [],
      proposed_actions: parsed.proposed_actions ?? [],
      model: this.model,
    };

    return delta;
  }

  // ─── System Prompt ──────────────────────────────────────────────────────────

  private buildSystemPrompt(worldContext: WorldContext): string {
    const entityList = worldContext.entities.length > 0
      ? worldContext.entities.map((e) => `  - ${e.name} (${e.type}) [id: ${e.id}]`).join("\n")
      : "  (none yet)";

    const obligationList = worldContext.open_obligations.length > 0
      ? worldContext.open_obligations.map((o) => `  - [${o.id}] "${o.title}" — ${o.owed_by} owes ${o.owed_to} [${o.status}]`).join("\n")
      : "  (none yet)";

    return `You are the Axiom Cognition Engine. Your job is to interpret incoming episodes (emails, events, observations) and produce a structured Delta of proposed changes to the World State.

You are NOT writing to the database. You are PROPOSING changes. A separate Orchestrator will decide whether to commit them.

## Current World State

### Known Entities:
${entityList}

### Open Obligations:
${obligationList}

## Your Task

Analyze the episode and return a JSON object with this exact structure:

\`\`\`json
{
  "is_noise": boolean,
  "noise_reason": "string (only if is_noise=true)",
  "interpretation_summary": "one sentence: what this episode means for the world state",
  "confidence_overall": 0.0-1.0,
  "entity_changes": [
    {
      "type": "create",
      "name": "Entity Name",
      "entity_type": "organization|person|artifact|domain",
      "lookup_key": "optional unique key like domain or email",
      "aliases": ["alt name"],
      "confidence": 0.0-1.0,
      "source_fact": "exact quote from episode that justifies this"
    },
    {
      "type": "update",
      "entity_id": "existing entity id from world state",
      "entity_name": "Entity Name",
      "changes": { "field": "new value" },
      "confidence": 0.0-1.0,
      "source_fact": "exact quote from episode"
    }
  ],
  "obligation_changes": [
    {
      "type": "create",
      "title": "Short action title",
      "description": "What needs to be done and why",
      "owed_by": "who must act",
      "owed_to": "who is waiting",
      "priority": "critical|high|medium|low",
      "due_hint": "optional deadline hint",
      "workspace_hint": "optional project/workspace name",
      "confidence": 0.0-1.0,
      "source_fact": "exact quote from episode"
    },
    {
      "type": "update",
      "obligation_id": "existing obligation id",
      "obligation_title": "title for reference",
      "new_status": "open|fulfilled|overdue|cancelled|disputed",
      "reason": "why this status change is warranted",
      "confidence": 0.0-1.0
    }
  ],
  "fact_changes": [
    {
      "entity_name": "Entity Name",
      "property": "billing_status|renewal_date|last_contact|etc",
      "value": "new value",
      "valid_from": "ISO timestamp",
      "confidence": 0.0-1.0,
      "source_fact": "exact quote"
    }
  ],
  "contradictions_found": [
    {
      "description": "what conflicts",
      "entity_name": "Entity Name",
      "field": "optional field name",
      "existing_value": "what we thought was true",
      "incoming_value": "what this episode says"
    }
  ],
  "proposed_actions": [
    {
      "action_type": "notify|draft_reply|schedule|escalate|archive",
      "description": "what to do",
      "urgency": "low|medium|high|critical",
      "requires_approval": boolean,
      "rationale": "why this action is recommended"
    }
  ]
}
\`\`\`

## Noise Classification

Mark is_noise=true for: newsletters, marketing emails, automated system notifications with no action required, community posts (Nextdoor, Reddit, etc.), social media notifications, promotional offers.

Mark is_noise=false for: billing issues, domain renewals, client communications, file transfers requiring review, payment failures, contract-related emails, anything requiring a human decision or action.

## Entity Deduplication

Before creating a new entity, check the Known Entities list. If the entity already exists, use type "update" with the existing entity_id. Do NOT create duplicates.

## Obligation Deduplication

Before creating a new obligation, check the Open Obligations list. If a similar obligation already exists (same owed_by, same topic), use type "update" to update its status rather than creating a duplicate.

Be precise. Only propose changes that are clearly justified by the episode content.`;
  }

  // ─── User Message ───────────────────────────────────────────────────────────

  private buildUserMessage(episode: Episode): string {
    const content = episode.raw_text.length > 3000
      ? episode.raw_text.slice(0, 3000) + "\n[... truncated ...]"
      : episode.raw_text;

    return [
      `EPISODE ID: ${episode.id}`,
      `SOURCE: ${episode.source_kind}`,
      `OBSERVED AT: ${episode.observed_at}`,
      `TITLE: ${episode.title}`,
      ``,
      `--- RAW CONTENT ---`,
      content,
      `--- END CONTENT ---`,
      ``,
      `Interpret this episode and return the Delta JSON.`,
    ].join("\n");
  }
}
