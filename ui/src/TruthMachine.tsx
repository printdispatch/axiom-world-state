/**
 * TruthMachine.tsx
 *
 * The Truth Machine debug panel — shows the Axiom Orchestration Loop
 * running in real time. Four-panel view:
 *
 *   [Episode List] → [Raw Input] | [Interpretation (Delta)] | [Commit Result] | [Proposed Actions]
 *
 * This is the "glass cockpit" for the ceremonial loop.
 */

import { useState, useEffect, useCallback } from "react";

const API = "http://localhost:3333";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Episode {
  id: string;
  title: string;
  source_kind: string;
  observed_at: string;
  status: "pending" | "interpreting" | "committed" | "noise" | "failed";
  is_noise: boolean;
  noise_reason?: string;
  delta_id?: string;
  committed_at?: string;
  raw_text: string;
  error?: string;
}

interface EntityChange {
  type: "create" | "update";
  name?: string;
  entity_type?: string;
  entity_name?: string;
  entity_id?: string;
  confidence: number;
  source_fact: string;
  changes?: Record<string, unknown>;
}

interface ObligationChange {
  type: "create" | "update";
  title?: string;
  obligation_title?: string;
  description?: string;
  owed_by?: string;
  owed_to?: string;
  priority?: string;
  new_status?: string;
  reason?: string;
  confidence: number;
}

interface Delta {
  id: string;
  episode_id: string;
  produced_at: string;
  is_noise: boolean;
  noise_reason?: string;
  interpretation_summary: string;
  confidence_overall: number;
  entity_changes: EntityChange[];
  obligation_changes: ObligationChange[];
  fact_changes: Array<{ entity_name: string; property: string; value: string; confidence: number; source_fact: string }>;
  contradictions_found: Array<{ description: string; entity_name: string }>;
  proposed_actions: Array<{ action_type: string; description: string; urgency: string; requires_approval: boolean; rationale: string }>;
  model: string;
}

interface LoopStatus {
  episode_summary: { total: number; pending: number; committed: number; noise: number; failed: number };
  recent_episodes: Array<{ id: string; title: string; status: string; is_noise: boolean; observed_at: string; committed_at?: string }>;
  recent_deltas: Array<{ id: string; episode_id: string; is_noise: boolean; interpretation_summary: string; entity_changes: number; obligation_changes: number; confidence: number; produced_at: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case "committed": return "#34C759";
    case "noise": return "#8E8E93";
    case "pending": return "#FFD60A";
    case "interpreting": return "#007AFF";
    case "failed": return "#FF3B30";
    default: return "#8E8E93";
  }
}

function confidenceBar(score: number): string {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "#34C759" : pct >= 60 ? "#FFD60A" : "#FF3B30";
  return `${pct}%`;
}

// ─── TruthMachine ─────────────────────────────────────────────────────────────

export function TruthMachine() {
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedDelta, setSelectedDelta] = useState<Delta | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, episodesRes] = await Promise.all([
        fetch(`${API}/api/loop/status`),
        fetch(`${API}/api/episodes`),
      ]);
      if (statusRes.ok) setLoopStatus(await statusRes.json());
      if (episodesRes.ok) setEpisodes(await episodesRes.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleSelectEpisode = async (ep: Episode) => {
    setSelectedEpisode(ep);
    setSelectedDelta(null);
    if (ep.delta_id) {
      try {
        const res = await fetch(`${API}/api/deltas/${ep.delta_id}`);
        if (res.ok) setSelectedDelta(await res.json());
      } catch { /* ignore */ }
    }
  };

  const handleMigrate = async () => {
    setMigrating(true);
    setStatusMsg("Migrating signals to episodes...");
    try {
      const res = await fetch(`${API}/api/episodes/migrate`, { method: "POST" });
      const data = await res.json() as { created: number; skipped: number };
      setStatusMsg(`Migration complete: ${data.created} created, ${data.skipped} already existed`);
      await fetchStatus();
    } catch (err) {
      setStatusMsg(`Migration failed: ${String(err)}`);
    } finally {
      setMigrating(false);
    }
  };

  const handleProcessPending = async () => {
    setProcessing(true);
    setStatusMsg("Running orchestration loop on pending episodes...");
    try {
      const res = await fetch(`${API}/api/episodes/process`, { method: "POST" });
      const data = await res.json() as { message: string };
      setStatusMsg(data.message);
      setTimeout(fetchStatus, 2000);
    } catch (err) {
      setStatusMsg(`Processing failed: ${String(err)}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleProcessSingle = async (episodeId: string) => {
    setStatusMsg(`Processing episode ${episodeId}...`);
    try {
      const res = await fetch(`${API}/api/episodes/${episodeId}/process`, { method: "POST" });
      const data = await res.json() as { message: string };
      setStatusMsg(data.message);
      await fetchStatus();
      // Re-select to refresh delta
      const ep = episodes.find(e => e.id === episodeId);
      if (ep) await handleSelectEpisode({ ...ep, status: "committed" });
    } catch (err) {
      setStatusMsg(`Failed: ${String(err)}`);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: "var(--text3)" }}>Loading Truth Machine...</div>;
  }

  const pendingCount = loopStatus?.episode_summary.pending ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ── Header ── */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.3 }}>Truth Machine</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>Observe → Interpret → Commit → Deliberate</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleMigrate}
              disabled={migrating}
              style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text2)", cursor: "pointer" }}
            >
              {migrating ? "Migrating..." : "Import Signals"}
            </button>
            <button
              onClick={handleProcessPending}
              disabled={processing || pendingCount === 0}
              style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "none", background: pendingCount > 0 ? "var(--accent)" : "var(--bg3)", color: pendingCount > 0 ? "#fff" : "var(--text3)", cursor: pendingCount > 0 ? "pointer" : "default" }}
            >
              {processing ? "Running..." : `Run Loop${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
            </button>
          </div>
        </div>

        {/* Summary pills */}
        {loopStatus && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Total", value: loopStatus.episode_summary.total, color: "var(--text2)" },
              { label: "Pending", value: loopStatus.episode_summary.pending, color: "#FFD60A" },
              { label: "Committed", value: loopStatus.episode_summary.committed, color: "#34C759" },
              { label: "Noise", value: loopStatus.episode_summary.noise, color: "#8E8E93" },
              { label: "Failed", value: loopStatus.episode_summary.failed, color: "#FF3B30" },
            ].map(p => (
              <div key={p.label} style={{ background: "var(--bg3)", borderRadius: 6, padding: "3px 8px", fontSize: 11 }}>
                <span style={{ color: p.color, fontWeight: 700 }}>{p.value}</span>
                <span style={{ color: "var(--text3)", marginLeft: 4 }}>{p.label}</span>
              </div>
            ))}
          </div>
        )}

        {statusMsg && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text3)", background: "var(--bg3)", borderRadius: 6, padding: "6px 10px" }}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* ── Body: Episode List + Detail ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Episode List */}
        <div style={{ width: 260, borderRight: "1px solid var(--border)", overflowY: "auto", flexShrink: 0 }}>
          {episodes.length === 0 && (
            <div style={{ padding: 16, color: "var(--text3)", fontSize: 13 }}>
              No episodes yet. Click "Import Signals" to migrate your existing emails.
            </div>
          )}
          {episodes.map(ep => (
            <div
              key={ep.id}
              onClick={() => handleSelectEpisode(ep)}
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                background: selectedEpisode?.id === ep.id ? "var(--bg3)" : "transparent",
                borderLeft: selectedEpisode?.id === ep.id ? `3px solid var(--accent)` : "3px solid transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor(ep.status), flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: statusColor(ep.status), fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{ep.status}</div>
                <div style={{ fontSize: 10, color: "var(--text3)", marginLeft: "auto" }}>{timeAgo(ep.observed_at)}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {ep.title}
              </div>
              {ep.status === "pending" && (
                <button
                  onClick={e => { e.stopPropagation(); handleProcessSingle(ep.id); }}
                  style={{ marginTop: 6, fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", cursor: "pointer" }}
                >
                  Process
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        {!selectedEpisode ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 14 }}>
            Select an episode to inspect the loop
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

            {/* Episode Header */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{selectedEpisode.title}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 11, background: "var(--bg3)", borderRadius: 4, padding: "2px 6px", color: "var(--text3)" }}>{selectedEpisode.source_kind}</span>
                <span style={{ fontSize: 11, background: "var(--bg3)", borderRadius: 4, padding: "2px 6px", color: statusColor(selectedEpisode.status) }}>{selectedEpisode.status}</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{selectedEpisode.id}</span>
              </div>
            </div>

            {/* Four Panels */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

              {/* Panel 1: Raw Input */}
              <div style={{ background: "var(--bg2)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>1. Observe (Raw Input)</div>
                <pre style={{ fontSize: 11, color: "var(--text2)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto", margin: 0, lineHeight: 1.5 }}>
                  {selectedEpisode.raw_text.slice(0, 800)}{selectedEpisode.raw_text.length > 800 ? "\n[truncated...]" : ""}
                </pre>
              </div>

              {/* Panel 2: Interpretation */}
              <div style={{ background: "var(--bg2)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>2. Interpret (Delta)</div>
                {!selectedDelta ? (
                  <div style={{ color: "var(--text3)", fontSize: 13 }}>
                    {selectedEpisode.status === "noise" ? (
                      <div>
                        <div style={{ color: "#8E8E93", fontWeight: 600, marginBottom: 4 }}>Classified as Noise</div>
                        <div style={{ fontSize: 12 }}>{selectedEpisode.noise_reason}</div>
                      </div>
                    ) : selectedEpisode.status === "pending" ? (
                      "Not yet processed. Click Process to run the loop."
                    ) : (
                      "No delta available."
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: "var(--text)", lineHeight: 1.4 }}>
                      {selectedDelta.interpretation_summary}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
                      Confidence: <span style={{ color: selectedDelta.confidence_overall >= 0.8 ? "#34C759" : selectedDelta.confidence_overall >= 0.6 ? "#FFD60A" : "#FF3B30", fontWeight: 700 }}>{confidenceBar(selectedDelta.confidence_overall)}</span>
                      {" · "}Model: {selectedDelta.model}
                    </div>
                    {selectedDelta.entity_changes.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#007AFF", marginBottom: 4 }}>Entity Changes ({selectedDelta.entity_changes.length})</div>
                        {selectedDelta.entity_changes.map((c, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--text2)", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ color: c.type === "create" ? "#34C759" : "#FFD60A", fontWeight: 600 }}>{c.type.toUpperCase()}</span>
                            {" "}{c.name ?? c.entity_name}
                            {c.entity_type && <span style={{ color: "var(--text3)" }}> ({c.entity_type})</span>}
                            <div style={{ color: "var(--text3)", fontSize: 10, marginTop: 1 }}>"{c.source_fact?.slice(0, 60)}..."</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedDelta.obligation_changes.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#FF9500", marginBottom: 4 }}>Obligation Changes ({selectedDelta.obligation_changes.length})</div>
                        {selectedDelta.obligation_changes.map((c, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--text2)", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ color: c.type === "create" ? "#34C759" : "#FFD60A", fontWeight: 600 }}>{c.type.toUpperCase()}</span>
                            {" "}{c.title ?? c.obligation_title}
                            {c.priority && <span style={{ color: "var(--text3)" }}> [{c.priority}]</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Panel 3: Commit Result */}
              <div style={{ background: "var(--bg2)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>3. Commit (State Change)</div>
                {selectedEpisode.status === "committed" ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34C759" }} />
                      <span style={{ fontSize: 13, color: "#34C759", fontWeight: 600 }}>Committed</span>
                      {selectedEpisode.committed_at && <span style={{ fontSize: 11, color: "var(--text3)" }}>{timeAgo(selectedEpisode.committed_at)}</span>}
                    </div>
                    {selectedDelta && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[
                          { label: "Entity Changes", value: selectedDelta.entity_changes.length },
                          { label: "Obligation Changes", value: selectedDelta.obligation_changes.length },
                          { label: "Facts Recorded", value: selectedDelta.fact_changes.length },
                          { label: "Contradictions", value: selectedDelta.contradictions_found.length, warn: selectedDelta.contradictions_found.length > 0 },
                        ].map(m => (
                          <div key={m.label} style={{ background: "var(--bg3)", borderRadius: 6, padding: "8px 10px" }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: m.warn ? "#FF3B30" : "var(--text)" }}>{m.value}</div>
                            <div style={{ fontSize: 10, color: "var(--text3)" }}>{m.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedDelta?.contradictions_found.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#FF3B30", marginBottom: 4 }}>Contradictions Found</div>
                        {selectedDelta.contradictions_found.map((c, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--text2)", padding: "3px 0" }}>
                            ⚡ {c.description}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : selectedEpisode.status === "noise" ? (
                  <div style={{ color: "#8E8E93", fontSize: 13 }}>No commit — episode classified as noise.</div>
                ) : selectedEpisode.status === "failed" ? (
                  <div style={{ color: "#FF3B30", fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Commit Failed</div>
                    <div style={{ fontSize: 11 }}>{selectedEpisode.error}</div>
                  </div>
                ) : (
                  <div style={{ color: "var(--text3)", fontSize: 13 }}>Awaiting processing.</div>
                )}
              </div>

              {/* Panel 4: Proposed Actions */}
              <div style={{ background: "var(--bg2)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>4. Deliberate (Actions)</div>
                {selectedDelta?.proposed_actions.length > 0 ? (
                  <div>
                    {selectedDelta.proposed_actions.map((a, i) => (
                      <div key={i} style={{ padding: "8px 0", borderBottom: i < selectedDelta.proposed_actions.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                            background: a.urgency === "critical" ? "#FF3B30" : a.urgency === "high" ? "#FF9500" : a.urgency === "medium" ? "#FFD60A" : "#34C759",
                            color: a.urgency === "medium" ? "#000" : "#fff",
                          }}>{a.urgency.toUpperCase()}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{a.action_type}</span>
                          {a.requires_approval && <span style={{ fontSize: 10, color: "#FF9500" }}>⚠ needs approval</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 3 }}>{a.description}</div>
                        <div style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic" }}>{a.rationale}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "var(--text3)", fontSize: 13 }}>
                    {selectedEpisode.status === "committed" ? "No actions proposed." : "Awaiting processing."}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
