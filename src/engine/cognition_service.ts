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
  "noise_reason": "string (only if is_noise=true — one sentence explaining why)",
  "interpretation_summary": "one sentence: what this episode means for the world state",
  "confidence_overall": 0.0-1.0,
  "entity_changes": [...],
  "obligation_changes": [...],
  "fact_changes": [...],
  "contradictions_found": [...],
  "proposed_actions": [...]
}
\`\`\`

## Entity Types (use exactly one of these)

- **person** — a named individual (client, vendor, contact, sender)
- **organization** — a company, business, nonprofit, association, or institution
- **financial_account** — a credit card, bank account, payment method, or subscription billing account
- **domain** — a registered internet domain name (e.g. edenframe.com)
- **service** — a SaaS product, platform, or hosted service (e.g. Squarespace, Cloudflare, Uber)
- **project** — a named work engagement, campaign, or deliverable
- **place** — a physical location, venue, or address

## Entity Change Schema

\`\`\`json
{
  "type": "create",
  "name": "Entity Name",
  "entity_type": "person|organization|financial_account|domain|service|project|place",
  "lookup_key": "optional unique key (domain name, email address, account number)",
  "aliases": ["alternative name or abbreviation"],
  "confidence": 0.0-1.0,
  "source_fact": "exact quote from episode that justifies this entity"
}
\`\`\`

For updates to existing entities:
\`\`\`json
{
  "type": "update",
  "entity_id": "existing entity id from world state",
  "entity_name": "Entity Name",
  "changes": { "field": "new value" },
  "confidence": 0.0-1.0,
  "source_fact": "exact quote from episode"
}
\`\`\`

## Obligation Change Schema

\`\`\`json
{
  "type": "create",
  "title": "Short imperative action title (max 8 words)",
  "description": "What needs to be done, why it matters, and any relevant context from the email thread",
  "owed_by": "who must act (use 'user' if it is the inbox owner)",
  "owed_to": "who is waiting or who benefits",
  "priority": "critical|high|medium|low",
  "due_hint": "specific date or relative deadline if mentioned, otherwise omit",
  "workspace_hint": "project or client name if clearly identifiable",
  "confidence": 0.0-1.0,
  "source_fact": "exact quote from episode"
}
\`\`\`

For status updates to existing obligations:
\`\`\`json
{
  "type": "update",
  "obligation_id": "existing obligation id",
  "obligation_title": "title for reference",
  "new_status": "open|fulfilled|overdue|cancelled|disputed",
  "reason": "why this status change is warranted",
  "confidence": 0.0-1.0
}
\`\`\`

## Fact Change Schema (for properties on existing entities)

\`\`\`json
{
  "entity_name": "Entity Name",
  "property": "billing_status|renewal_date|last_contact|payment_due|phone|address|etc",
  "value": "new value",
  "valid_from": "ISO timestamp",
  "confidence": 0.0-1.0,
  "source_fact": "exact quote"
}
\`\`\`

## Noise Classification Rules

**Mark is_noise=true for:**
- Newsletters, digests, and marketing emails with no required action
- Automated notifications that are purely informational (e.g. "your file was downloaded")
- Community posts (Nextdoor, Reddit, Facebook groups) with no direct obligation to the inbox owner
- Social media notifications (Pinterest, Instagram, LinkedIn activity alerts)
- Promotional offers and discount codes
- Subscription renewal confirmations where no action is needed
- Spam and cold outreach with no existing relationship

**Mark is_noise=false for:**
- Billing failures, payment issues, or overdue invoices — even if automated
- Domain renewal warnings or expiration notices
- Client communications, vendor replies, or any email in an active thread
- File transfers or attachments requiring review or approval
- Any email that contains a question, request, or deadline directed at the inbox owner
- Legal, compliance, or contractual notices
- Emails where someone is waiting for a response

**Short reply threads:** If an email is a brief reply in an ongoing thread (e.g. "Sounds good, let me check"), it is still signal if it implies a pending action or advances a client relationship. Extract the obligation from context even if the email body is short.

## Entity Deduplication

Before creating a new entity, check the Known Entities list. If the entity already exists (same name or alias), use type "update" with the existing entity_id. Do NOT create duplicates.

Common aliases to watch for:
- "Squarespace" and "Squarespace Inc." are the same service entity
- "Cloudflare" and "Cloudflare Registrar" are the same service entity
- A person's first name in a reply thread likely matches an existing person entity

## Obligation Deduplication

Before creating a new obligation, check the Open Obligations list. If a similar obligation already exists (same owed_by, same topic, same counterparty), use type "update" to change its status rather than creating a duplicate.

## Quality Standards

- Every entity_change must have a source_fact — a direct quote from the episode
- Every obligation_change must have a source_fact
- Do not invent obligations not supported by the episode content
- For short reply threads with no clear new obligation, it is acceptable to return empty entity_changes and obligation_changes — but still provide an interpretation_summary
- confidence_overall should reflect your certainty: 0.9+ for clear explicit content, 0.7-0.8 for inferred, below 0.7 for ambiguous

Be precise. Only propose changes clearly justified by the episode content.`;
  }

  // ─── User Message ───────────────────────────────────────────────────────────

  private buildUserMessage(episode: Episode): string {
    const content = episode.raw_text.length > 4000
      ? episode.raw_text.slice(0, 4000) + "\n[... truncated ...]"
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
