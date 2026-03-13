/**
 * Gmail OAuth 2.0 Adapter
 * Handles the full OAuth flow, token storage, and email fetching.
 */

import { google, Auth } from "googleapis";
import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GmailToken {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
  email?: string;
}

export interface RawSignal {
  id: string;
  source: string;
  adapter: string;
  raw_content: string;
  metadata: {
    from: string;
    subject: string;
    date: string;
    thread_id: string;
    message_id: string;
    labels?: string[];
  };
  received_at: string;
  processed: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3333/api/connect/gmail/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ─── OAuth Client Factory ─────────────────────────────────────────────────────

export function createOAuthClient(): Auth.OAuth2Client {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// ─── Token Storage ────────────────────────────────────────────────────────────

export function getTokenPath(dataDir: string): string {
  return path.join(dataDir, "gmail_token.json");
}

export function loadToken(dataDir: string): GmailToken | null {
  const tokenPath = getTokenPath(dataDir);
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as GmailToken;
  } catch {
    return null;
  }
}

export function saveToken(dataDir: string, token: GmailToken): void {
  const tokenPath = getTokenPath(dataDir);
  fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
}

export function deleteToken(dataDir: string): void {
  const tokenPath = getTokenPath(dataDir);
  if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

export function getAuthUrl(): string {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // force refresh_token to be returned
  });
}

// ─── Exchange Code for Token ──────────────────────────────────────────────────

export async function exchangeCodeForToken(
  code: string,
  dataDir: string
): Promise<GmailToken> {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  // Get the user's email address
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();

  const token: GmailToken = {
    access_token: tokens.access_token ?? "",
    refresh_token: tokens.refresh_token ?? "",
    scope: tokens.scope ?? "",
    token_type: tokens.token_type ?? "Bearer",
    expiry_date: tokens.expiry_date ?? 0,
    email: userInfo.data.email ?? undefined,
  };

  saveToken(dataDir, token);
  return token;
}

// ─── Authenticated Client ─────────────────────────────────────────────────────

export function getAuthenticatedClient(token: GmailToken): Auth.OAuth2Client {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: token.expiry_date,
  });
  return oauth2Client;
}

// ─── Email Fetching ───────────────────────────────────────────────────────────

/**
 * Decode base64url encoded email body
 */
function decodeBase64(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract plain text body from a Gmail message part tree
 */
function extractBody(payload: any): string {
  if (!payload) return "";

  // Direct body data
  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  // Multipart: prefer text/plain, fall back to text/html
  if (payload.parts) {
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64(textPart.body.data);

    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      // Strip HTML tags for plain text
      return decodeBase64(htmlPart.body.data)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // Recurse into nested parts
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }

  return "";
}

/**
 * Get header value from Gmail message headers
 */
function getHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
  return headers.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * Fetch all emails since a given date and convert to RawSignal format.
 * @param dataDir  Path to the data directory (for token + signal_log)
 * @param sinceDate  ISO date string, e.g. "2026/03/06"
 * @param maxResults  Max emails to fetch per sync (default 100)
 */
export async function syncGmailEmails(
  dataDir: string,
  sinceDate: string = "2026/03/06",
  maxResults: number = 100
): Promise<{ added: number; skipped: number; errors: number; signals: RawSignal[] }> {
  const token = loadToken(dataDir);
  if (!token) throw new Error("No Gmail token found. Please connect Gmail first.");

  const auth = getAuthenticatedClient(token);

  // Refresh token if needed and save updated credentials
  auth.on("tokens", (newTokens) => {
    const updated: GmailToken = {
      ...token,
      access_token: newTokens.access_token ?? token.access_token,
      expiry_date: newTokens.expiry_date ?? token.expiry_date,
    };
    if (newTokens.refresh_token) updated.refresh_token = newTokens.refresh_token;
    saveToken(dataDir, updated);
  });

  const gmail = google.gmail({ version: "v1", auth });

  // Load existing signal IDs to avoid duplicates
  const signalLogPath = path.join(dataDir, "signals", "signal_log.json");
  let existing: RawSignal[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(signalLogPath, "utf-8"));
  } catch {
    existing = [];
  }
  const existingIds = new Set(existing.map((s) => s.metadata?.message_id).filter(Boolean));

  // Build Gmail query: after date, not spam/trash
  const query = `after:${sinceDate} -in:spam -in:trash`;

  // List messages
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages ?? [];
  const newSignals: RawSignal[] = [];
  let skipped = 0;
  let errors = 0;

  for (const msg of messages) {
    if (!msg.id) continue;

    // Skip if already ingested
    if (existingIds.has(msg.id)) {
      skipped++;
      continue;
    }

    try {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const payload = full.data.payload;
      if (!payload) continue;

      const headers: Array<{ name?: string | null; value?: string | null }> = payload.headers ?? [];
      const from = getHeader(headers, "from");
      const subject = getHeader(headers, "subject") || "(no subject)";
      const date = getHeader(headers, "date");
      const messageId = getHeader(headers, "message-id") || msg.id;
      const threadId = full.data.threadId ?? msg.id;
      const labels = full.data.labelIds ?? [];

      const body = extractBody(payload);
      if (!body.trim()) {
        skipped++;
        continue;
      }

      // Build raw_content in email-like format
      const rawContent = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${body.trim()}`;

      const signal: RawSignal = {
        id: `sig-gmail-${msg.id}`,
        source: "gmail",
        adapter: "gmail",
        raw_content: rawContent,
        metadata: {
          from,
          subject,
          date: date ? new Date(date).toISOString() : new Date().toISOString(),
          thread_id: threadId,
          message_id: msg.id,
          labels,
        },
        received_at: date ? new Date(date).toISOString() : new Date().toISOString(),
        processed: false,
      };

      newSignals.push(signal);
    } catch (err) {
      console.error(`[Gmail] Error fetching message ${msg.id}:`, err);
      errors++;
    }
  }

  // Append new signals to log
  if (newSignals.length > 0) {
    const updated = [...existing, ...newSignals];
    fs.writeFileSync(signalLogPath, JSON.stringify(updated, null, 2));
  }

  return { added: newSignals.length, skipped, errors, signals: newSignals };
}

// ─── Sync Status ──────────────────────────────────────────────────────────────

export interface SyncStatus {
  connected: boolean;
  email?: string;
  last_sync?: string;
  signal_count?: number;
}

export function getSyncStatus(dataDir: string): SyncStatus {
  const token = loadToken(dataDir);
  if (!token) return { connected: false };

  const signalLogPath = path.join(dataDir, "signals", "signal_log.json");
  let signalCount = 0;
  try {
    const signals: RawSignal[] = JSON.parse(fs.readFileSync(signalLogPath, "utf-8"));
    signalCount = signals.filter((s) => s.adapter === "gmail").length;
  } catch {
    signalCount = 0;
  }

  // Check last sync time from a sync log
  const syncLogPath = path.join(dataDir, "gmail_sync.json");
  let lastSync: string | undefined;
  try {
    const syncLog = JSON.parse(fs.readFileSync(syncLogPath, "utf-8"));
    lastSync = syncLog.last_sync;
  } catch {
    lastSync = undefined;
  }

  return {
    connected: true,
    email: token.email,
    last_sync: lastSync,
    signal_count: signalCount,
  };
}

export function recordSync(dataDir: string, result: { added: number; skipped: number }): void {
  const syncLogPath = path.join(dataDir, "gmail_sync.json");
  const log = {
    last_sync: new Date().toISOString(),
    last_added: result.added,
    last_skipped: result.skipped,
  };
  fs.writeFileSync(syncLogPath, JSON.stringify(log, null, 2));
}
