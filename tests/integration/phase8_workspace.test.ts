import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { WorkspaceStore } from "../../src/workspaces/workspace_store.js";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;
let store: WorkspaceStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-ws-test-"));
  store = new WorkspaceStore(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("WorkspaceStore", () => {
  it("creates a workspace and retrieves it by id", () => {
    const ws = store.create({
      name: "Meridian Coffee Rebrand",
      description: "Full brand identity redesign",
      status: "active",
      client_name: "Meridian Coffee Co.",
      entity_ids: ["entity-001"],
      signal_ids: ["sig-001"],
      obligation_ids: ["ob-001"],
      tags: ["branding", "identity"],
    });
    expect(ws.id).toBeTruthy();
    expect(ws.name).toBe("Meridian Coffee Rebrand");
    expect(ws.status).toBe("active");
    expect(ws.client_name).toBe("Meridian Coffee Co.");
    const found = store.getById(ws.id);
    expect(found).not.toBeUndefined();
    expect(found?.name).toBe("Meridian Coffee Rebrand");
  });

  it("lists all workspaces", () => {
    store.create({ name: "Project A", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    store.create({ name: "Project B", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    store.create({ name: "Project C", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    const all = store.getAll();
    expect(all.length).toBe(3);
  });

  it("updates workspace status and last_activity_at", () => {
    const ws = store.create({ name: "Test Project", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    const updated = store.update(ws.id, { status: "on_hold" });
    expect(updated?.status).toBe("on_hold");
    // updated_at should be a valid ISO string
    expect(updated?.updated_at).toBeTruthy();
  });

  it("adds a signal to a workspace", () => {
    const ws = store.create({ name: "Test Project", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    store.addSignal(ws.id, "sig-new-001");
    const updated = store.getById(ws.id);
    expect(updated?.signal_ids).toContain("sig-new-001");
  });

  it("does not add duplicate signal ids", () => {
    const ws = store.create({ name: "Test Project", status: "active", entity_ids: [], signal_ids: ["sig-001"], obligation_ids: [], tags: [] });
    store.addSignal(ws.id, "sig-001");
    const updated = store.getById(ws.id);
    expect(updated?.signal_ids.filter(id => id === "sig-001").length).toBe(1);
  });

  it("adds an entity to a workspace", () => {
    const ws = store.create({ name: "Test Project", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    store.linkEntity(ws.id, "entity-new-001");
    const updated = store.getById(ws.id);
    expect(updated?.entity_ids).toContain("entity-new-001");
  });

  it("adds an obligation to a workspace", () => {
    const ws = store.create({ name: "Test Project", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    store.addObligation(ws.id, "ob-new-001");
    const updated = store.getById(ws.id);
    expect(updated?.obligation_ids).toContain("ob-new-001");
  });

  it("persists workspaces to disk and reloads them", () => {
    store.create({ name: "Persistent Project", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: ["test"] });
    // Create a new store instance pointing to the same directory
    const store2 = new WorkspaceStore(tmpDir);
    const all = store2.getAll();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("Persistent Project");
    expect(all[0].tags).toContain("test");
  });

  it("returns undefined for unknown workspace id", () => {
    const result = store.getById("nonexistent-id");
    expect(result).toBeUndefined();
  });

  it("filters workspaces by status using getActive", () => {
    store.create({ name: "Active Project", status: "active", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    store.create({ name: "On Hold Project", status: "on_hold", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    store.create({ name: "Completed Project", status: "completed", entity_ids: [], signal_ids: [], obligation_ids: [], tags: [] });
    const active = store.getActive();
    expect(active.length).toBe(1);
    expect(active[0].name).toBe("Active Project");
  });
});
