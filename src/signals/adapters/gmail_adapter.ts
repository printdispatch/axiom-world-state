/**
 * GmailAdapter
 *
 * Converts a raw Gmail API message object (or a simplified mock of one)
 * into a normalized Axiom Signal object.
 *
 * This is the first concrete adapter for the Signal Gateway.
 * Additional adapters (calendar, Slack, etc.) will follow the same interface.
 */

import crypto from "node:crypto";
import { Signal } from "../../../schema/signals.js";
import { ProvenanceRef } from "../../../schema/common.js";

/**
 * A simplified representation of a Gmail message.
 * This mirrors the shape of the Gmail API's `Message` resource,
 * but only includes the fields we need for Phase 1.
 *
 * Full Gmail API reference:
 * https://developers.google.com/gmail/api/reference/rest/v1/users.messages
 */
export interface GmailMessage {
  /** The Gmail message ID (e.g. "18e4a1b2c3d4e5f6") */
  id: string;
  /** The Gmail thread ID */
  threadId: string;
  /** ISO timestamp of when the message was received */
  internalDate: string;
  /** The sender's email address */
  from: string;
  /** The recipient email address(es), comma-separated */
  to: string;
  /** The email subject line */
  subject: string;
  /** The plain-text body of the email */
  bodyText: string;
  /** Optional: the account/mailbox this was fetched from */
  accountAddress?: string;
}

/**
 * Converts a GmailMessage into an Axiom Signal.
 *
 * @param msg - The raw Gmail message object
 * @param ingestedBy - The identifier of the system or user that triggered the ingest
 * @returns A fully-formed Signal object ready to be stored
 */
export function gmailMessageToSignal(
  msg: GmailMessage,
  ingestedBy: string = "system"
): Signal {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const provenance: ProvenanceRef = {
    source_id: msg.id,
    source_kind: "email",
    source_label: `Gmail: ${msg.subject}`,
    source_excerpt: msg.bodyText.slice(0, 300),
    observed_at: msg.internalDate,
  };

  const signal: Signal = {
    // BaseRecord fields
    id,
    schema_version: "1.0.0",
    status: "active",
    tags: ["gmail", "email"],
    provenance: [provenance],
    created_at: now,
    updated_at: now,
    created_by: ingestedBy,
    updated_by: ingestedBy,

    // Signal-specific fields
    type: "signal",
    signal_kind: "incoming_message",
    source_kind: "email",
    source_external_id: msg.id,
    title: msg.subject || "(no subject)",
    raw_text: msg.bodyText,
    observed_at: msg.internalDate,
    parsed: false,
    linked_entity_refs: [],
    moved_to_state: false,
    staleness: "fresh",
    stale_after_hours: 72,
  };

  return signal;
}
