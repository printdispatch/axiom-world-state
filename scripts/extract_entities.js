#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dataDir = path.resolve(__dirname, "../data");
const procLog = path.join(dataDir, "processing", "processing_log.json");
const entityPath = path.join(dataDir, "entities", "entities.json");

if (!fs.existsSync(path.join(dataDir, "entities"))) {
  fs.mkdirSync(path.join(dataDir, "entities"), { recursive: true });
}

let results = [];
try { results = JSON.parse(fs.readFileSync(procLog, "utf-8")); } catch (e) { console.log("No processing log:", e.message); }

let entities = [];
try { entities = JSON.parse(fs.readFileSync(entityPath, "utf-8")); } catch { entities = []; }

const now = new Date().toISOString();
let added = 0;

for (const result of results) {
  if (result.is_noise) continue;
  const candidates = (result.layer_2 && result.layer_2.entity_candidates) || [];
  for (const c of candidates) {
    const exists = entities.some(function(e) { return e.lookup_key === c.lookup_key || e.name === c.label; });
    if (!exists && c.label) {
      entities.push({
        id: "ent-" + crypto.randomUUID().slice(0, 8),
        name: c.label,
        type: c.domain === "person" ? "person" : c.domain === "organization" ? "organization" : "artifact",
        lookup_key: c.lookup_key,
        email: c.email || null,
        source_signal_id: result.signal_id,
        created_at: now,
        aliases: [c.label],
      });
      added++;
    }
  }
}

fs.writeFileSync(entityPath, JSON.stringify(entities, null, 2));
console.log("Added " + added + " entities. Total: " + entities.length);
entities.forEach(function(e) { console.log("  [" + e.type + "] " + e.name); });
