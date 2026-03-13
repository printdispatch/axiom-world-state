/**
 * WorkspaceStore
 * Persistent JSON-backed storage for Workspace records.
 * A Workspace is a named project or client context that aggregates
 * related signals, entities, obligations, and state updates.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type WorkspaceStatus = "active" | "on_hold" | "completed" | "archived";

export interface WorkspaceEntity {
  entity_id: string;
  role: string; // e.g. "client", "contact", "deliverable"
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  status: WorkspaceStatus;
  client_name?: string;
  entity_ids: string[];
  signal_ids: string[];
  obligation_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  last_activity_at?: string;
}

export class WorkspaceStore {
  private filePath: string;

  constructor(dataDir: string) {
    const dir = path.join(dataDir, "workspaces");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, "workspaces.json");
  }

  private read(): Workspace[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Workspace[];
    } catch {
      return [];
    }
  }

  private write(workspaces: Workspace[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(workspaces, null, 2));
  }

  create(data: Omit<Workspace, "id" | "created_at" | "updated_at">): Workspace {
    const workspaces = this.read();
    const now = new Date().toISOString();
    const workspace: Workspace = {
      ...data,
      id: `ws-${randomUUID().slice(0, 8)}`,
      created_at: now,
      updated_at: now,
    };
    workspaces.push(workspace);
    this.write(workspaces);
    return workspace;
  }

  update(id: string, patch: Partial<Workspace>): Workspace | null {
    const workspaces = this.read();
    const idx = workspaces.findIndex(w => w.id === id);
    if (idx === -1) return null;
    workspaces[idx] = { ...workspaces[idx], ...patch, updated_at: new Date().toISOString() };
    this.write(workspaces);
    return workspaces[idx];
  }

  addSignal(workspaceId: string, signalId: string): void {
    const workspaces = this.read();
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    if (!ws.signal_ids.includes(signalId)) {
      ws.signal_ids.push(signalId);
      ws.last_activity_at = new Date().toISOString();
      ws.updated_at = new Date().toISOString();
    }
    this.write(workspaces);
  }

  addObligation(workspaceId: string, obligationId: string): void {
    const workspaces = this.read();
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    if (!ws.obligation_ids.includes(obligationId)) {
      ws.obligation_ids.push(obligationId);
      ws.updated_at = new Date().toISOString();
    }
    this.write(workspaces);
  }

  linkEntity(workspaceId: string, entityId: string): void {
    const workspaces = this.read();
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    if (!ws.entity_ids.includes(entityId)) {
      ws.entity_ids.push(entityId);
      ws.updated_at = new Date().toISOString();
    }
    this.write(workspaces);
  }

  getAll(): Workspace[] {
    return this.read().sort((a, b) =>
      (b.last_activity_at ?? b.updated_at).localeCompare(a.last_activity_at ?? a.updated_at)
    );
  }

  getActive(): Workspace[] {
    return this.getAll().filter(w => w.status === "active");
  }

  getById(id: string): Workspace | undefined {
    return this.read().find(w => w.id === id);
  }

  getByEntityId(entityId: string): Workspace[] {
    return this.read().filter(w => w.entity_ids.includes(entityId));
  }
}
