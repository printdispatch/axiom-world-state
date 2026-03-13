import { useState, useEffect, useRef } from "react";
import "./App.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Signal {
  id: string; source: string; raw_content: string;
  metadata: { from: string; subject: string; date: string; thread_id: string };
  received_at: string; processed: boolean; is_noise?: boolean; adapter: string;
}
interface Fact { fact: string; source_ref: string }
interface EntityCandidate { label: string; domain: string; likely_existing: boolean; lookup_key: string; email?: string }
interface StateUpdate { entity_label: string; entity_domain: string; field: string; new_value: string; source_fact: string; signal_id?: string; mutated_at?: string }
interface ObligationCandidate { title: string; description: string; owed_by: string; owed_to: string; priority: string; due_hint?: string; source_fact: string }
interface Inference { statement: string; confidence: number; based_on_facts: string[]; risk_if_wrong: string }
interface RiskFlag { flag: string; severity: string; entities_involved: string[] }
interface ProposedAction { rank: number; kind: string; description: string; target_entities: string[]; risk: string; requires_approval: boolean; rationale: string; expected_outcome: string }
interface ProcessingResult {
  id: string; signal_id: string; processed_at: string; model: string; is_noise: boolean;
  layer_1: { is_noise: boolean; raw_facts: Fact[]; noise_reason?: string };
  layer_2: { entity_candidates: EntityCandidate[]; matched_entity_ids: string[]; proposed_new_entities: unknown[]; similarity_conflicts: unknown[] };
  layer_3: { state_updates: StateUpdate[]; unchanged_entities: string[]; ambiguities: { description: string; entities_involved: string[] }[] };
  layer_4: { new_obligations: ObligationCandidate[]; updated_obligations: ObligationCandidate[]; dependency_changes: unknown[] };
  layer_5: { inferences: Inference[]; risk_flags: RiskFlag[]; priority_estimates: unknown[]; missing_information: unknown[] };
  layer_6: { proposed_actions: ProposedAction[]; any_requires_approval: boolean; confidence: number };
}
interface Obligation {
  id: string; title: string; description: string; owed_by: string; owed_to: string;
  workspace_hint?: string; priority: string; status: string; due_hint?: string;
  source_signal_id: string; created_at: string;
}
interface Entity {
  id: string; canonical_name: string; domain: string;
  aliases: { value: string; source: string }[];
  source_signal_id: string; created_at: string; superseded: boolean;
  email?: string; organization?: string; role?: string;
}
interface Provenance {
  entity: Entity;
  state_updates: StateUpdate[];
  signals: Signal[];
  obligations: Obligation[];
}
interface Contradiction {
  id: string; description: string; entities_involved: string[];
  signal_a: string; signal_b: string; resolved: boolean; created_at: string;
}
interface Summary {
  signals: number; entities: number; open_obligations: number; total_obligations: number;
  state_updates: number; unresolved_contradictions: number; audit_entries: number;
}
interface Recipe {
  id: string; name: string; description: string; enabled: boolean;
  trigger: { kind: string; conditions?: Record<string, unknown> };
  steps: Array<{ id: string; kind: string; params: Record<string, unknown> }>;
  risk_level: string; approval_required: boolean;
  run_count: number; last_run_at?: string; created_at: string; updated_at: string;
}
interface SimEffect {
  kind: string; description: string; target_id?: string;
  predicted_values: Record<string, unknown>; confidence: number;
}
interface Simulation {
  id: string; name: string; status: string; summary?: string;
  change: { kind: string; description?: string; target_id?: string; params: Record<string, unknown> };
  baseline_snapshot: { health_score: number; open_obligations: number; overdue_obligations: number; active_contradictions: number; entity_count: number };
  predicted_effects: SimEffect[];
  created_at: string; completed_at?: string;
}
interface HealthAlert {
  severity: string; code: string; message: string; value: number; threshold: number;
}
interface HealthMetrics {
  collected_at: string; signals_processed: number; unprocessed_signals: number;
  merge_candidates: number; contradictions: number; review_backlog: number;
  automation_failures: number; entity_count: number; workspace_count: number;
  open_obligations: number; overdue_obligations: number; health_score: number;
  review_by_severity: Record<string, number>; obligations_by_priority: Record<string, number>;
  automation_summary: { total_runs: number; completed: number; failed: number; pending_approval: number };
}
interface HealthStatus {
  status: "healthy" | "degraded" | "critical"; message: string;
  metrics: HealthMetrics; alerts: HealthAlert[];
}
interface ReviewItem {
  id: string;
  kind: "entity_conflict" | "high_risk_action" | "contradiction" | "low_confidence";
  title: string; description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "reviewed";
  decision?: string; decision_note?: string; decided_at?: string;
  signal_id: string; entity_ids?: string[];
  action_description?: string; action_risk?: string;
  requires_approval: boolean; created_at: string;
  metadata?: Record<string, unknown>;
}
interface Workspace {
  id: string; name: string; description?: string; status: string;
  client_name?: string; entity_ids: string[]; signal_ids: string[];
  obligation_ids: string[]; tags: string[];
  created_at: string; updated_at: string; last_activity_at?: string;
  signals?: Signal[]; entities?: Entity[];
  obligations?: Obligation[]; state_updates?: StateUpdate[];
}
interface WorldSummary {
  total_signals: number; total_entities: number; open_obligations: number;
  overdue_obligations: number; active_contradictions: number; pending_review: number;
  active_workspaces: number; health_score: number;
}
interface WorldObligation {
  id: string; title: string; status: string; priority: string;
  due_date?: string; due_hint?: string; owed_by?: string; owed_to?: string;
  workspace_hint?: string; created_at: string;
}
interface WorldActivity {
  id: string; entity_label: string; field: string; new_value: string;
  mutated_at: string; signal_id: string;
}
interface WorldContradiction {
  id: string; description: string; resolved: boolean;
  entity_label?: string; signal_ids?: string[]; created_at: string;
}
interface ActiveEntity {
  id: string; canonical_name: string; domain: string;
  update_count: number; updated_at: string;
}
interface WorldState {
  summary: WorldSummary;
  open_obligations: WorldObligation[];
  overdue_obligations: WorldObligation[];
  active_contradictions: WorldContradiction[];
  most_active_entities: ActiveEntity[];
  recent_activity: WorldActivity[];
  review_by_severity: { critical: number; high: number; medium: number; low: number };
  workspaces: Workspace[];
}
interface IngestConnection {
  id: string; kind: "gmail" | "manual" | "webhook"; label: string;
  status: "connected" | "disconnected" | "pending"; connected_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return "now";
}

function getInitials(from: string): string {
  const name = from.split("@")[0].replace(/[._-]/g, " ");
  return name.split(" ").map((w: string) => w[0]?.toUpperCase() || "").slice(0, 2).join("");
}

function getAvatarColor(str: string): string {
  const colors = ["#5856D6","#34C759","#FF9500","#FF3B30","#007AFF","#AF52DE","#FF2D55","#00C7BE"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function priorityColor(p: string): string {
  if (p === "critical") return "#FF3B30";
  if (p === "high") return "#FF9500";
  if (p === "medium") return "#FFD60A";
  return "#34C759";
}

function riskColor(r: string): string {
  if (r === "high" || r === "critical") return "#FF3B30";
  if (r === "medium") return "#FF9500";
  return "#34C759";
}

function domainIcon(d: string): string {
  if (d === "person") return "👤";
  if (d === "organization") return "🏢";
  if (d === "artifact") return "📄";
  return "◆";
}

function domainColor(d: string): string {
  if (d === "person") return "#007AFF";
  if (d === "organization") return "#AF52DE";
  if (d === "artifact") return "#FF9500";
  return "#34C759";
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ from, size = 44 }: { from: string; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size, minWidth: size, background: getAvatarColor(from), fontSize: Math.round(size * 0.36) }}>
      {getInitials(from)}
    </div>
  );
}

// ─── Obligation Detail Sheet ──────────────────────────────────────────────────

function ObligationSheet({ ob, onClose, onResolve, onSnooze }: { ob: Obligation; onClose: () => void; onResolve?: (id: string) => void; onSnooze?: (id: string) => void }) {
  const isOpen = ob.status === "open" || ob.status === "pending";
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="entity-avatar" style={{ background: priorityColor(ob.priority), width: 44, height: 44, minWidth: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 20 }}>{isOpen ? "⏳" : "✓"}</span>
          </div>
          <div className="sheet-head-text">
            <div className="sheet-from">{ob.title}</div>
            <div className="sheet-meta">{ob.status} · {ob.priority} priority</div>
          </div>
          <button className="sheet-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div style={{ padding: "14px 16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
          {ob.description && (
            <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.5 }}>{ob.description}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "Owed By", value: ob.owed_by },
              { label: "Owed To", value: ob.owed_to },
              { label: "Priority", value: ob.priority },
              { label: "Status", value: ob.status },
              ob.due_hint ? { label: "Due", value: ob.due_hint } : null,
              ob.workspace_hint ? { label: "Workspace", value: ob.workspace_hint } : null,
            ].filter(Boolean).map((row) => (
              <div key={row!.label} style={{ background: "var(--bg3)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{row!.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{row!.value}</div>
              </div>
            ))}
          </div>
          {isOpen && (onResolve || onSnooze) && (
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              {onResolve && (
                <button
                  className="review-btn approve"
                  style={{ flex: 1, padding: "12px 16px", fontSize: 14 }}
                  onClick={() => onResolve(ob.id)}
                >
                  ✓ Mark Done
                </button>
              )}
              {onSnooze && (
                <button
                  className="review-btn defer"
                  style={{ flex: 1, padding: "12px 16px", fontSize: 14 }}
                  onClick={() => onSnooze(ob.id)}
                >
                  ⏳ Snooze 3d
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "monospace" }}>
            {ob.source_signal_id && `Signal: ${ob.source_signal_id} · `}Created {timeAgo(ob.created_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SignalCard({ signal, isSelected, onClick }: { signal: Signal; isSelected: boolean; onClick: () => void }) {
  const from = signal.metadata?.from || signal.source;
  const subject = signal.metadata?.subject || "No subject";
  const date = signal.metadata?.date || signal.received_at;
  const isNoise = signal.is_noise === true;
  return (
    <div className={`signal-card${isSelected ? " selected" : ""}${isNoise ? " noise" : ""}`} onClick={onClick}>
      <div className="card-left">
        <Avatar from={from} />
        <div className="thread-line" />
      </div>
      <div className="card-body">
        <div className="card-header-row">
          <span className="card-from">{from.split("@")[0]}</span>
          <span className="card-time">{timeAgo(date)}</span>
        </div>
        <div className="card-subject">{subject}</div>
        <div className="card-tags">
          <span className="badge src">{signal.source}</span>
          {isNoise && <span className="badge noise">noise</span>}
          {!isNoise && <span className="badge ok">processed</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Signal Inspector (Bottom Sheet) ─────────────────────────────────────────

function Inspector({ signal, result, onClose }: { signal: Signal; result: ProcessingResult | null; onClose: () => void }) {
  const [openLayer, setOpenLayer] = useState<number | null>(1);
  const from = signal.metadata?.from || signal.source;
  const subject = signal.metadata?.subject || "No subject";
  const date = signal.metadata?.date || signal.received_at;
  const layerDefs = [
    { n: 1, label: "Raw Truth", color: "#007AFF" },
    { n: 2, label: "Entities", color: "#AF52DE" },
    { n: 3, label: "State", color: "#34C759" },
    { n: 4, label: "Obligations", color: "#FF9500" },
    { n: 5, label: "Inferences", color: "#FF2D55" },
    { n: 6, label: "Actions", color: "#FFD60A" },
  ];
  const getCount = (n: number): string => {
    if (!result) return "0";
    if (n === 1) return result.layer_1.raw_facts.length + " facts";
    if (n === 2) return result.layer_2.entity_candidates.length + " found";
    if (n === 3) return result.layer_3.state_updates.length + " updates";
    if (n === 4) return result.layer_4.new_obligations.length + " new";
    if (n === 5) return (result.layer_5.inferences.length + result.layer_5.risk_flags.length) + " items";
    if (n === 6) return result.layer_6.proposed_actions.length + " · " + Math.round(result.layer_6.confidence * 100) + "%";
    return "0";
  };
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <Avatar from={from} size={38} />
          <div className="sheet-head-text">
            <div className="sheet-from">{from.split("@")[0]}</div>
            <div className="sheet-meta">{timeAgo(date)} · {signal.source}</div>
          </div>
          <button className="sheet-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="sheet-subject">{subject}</div>
        {signal.raw_content && (
          <div className="raw-preview">
            <pre>{signal.raw_content.slice(0, 380)}{signal.raw_content.length > 380 ? "…" : ""}</pre>
          </div>
        )}
        {result && (
          <div className="layers">
            {layerDefs.map(({ n, label, color }) => (
              <div key={n} className="layer-block">
                <button className="layer-toggle" onClick={() => setOpenLayer(openLayer === n ? null : n)}>
                  <span className="l-badge" style={{ background: color, color: n === 6 ? "#000" : "#fff" }}>L{n}</span>
                  <span className="l-title">{label}</span>
                  <span className="l-count">{getCount(n)}</span>
                  <span className="l-chev">{openLayer === n ? "▲" : "▼"}</span>
                </button>
                {openLayer === n && (
                  <div className="layer-detail">
                    {n === 1 && (result.layer_1.is_noise
                      ? <div className="detail-note">Noise: {result.layer_1.noise_reason}</div>
                      : result.layer_1.raw_facts.map((f, i) => (
                          <div key={i} className="detail-row"><span className="d-main">{f.fact}</span><span className="d-sub">{f.source_ref}</span></div>
                        ))
                    )}
                    {n === 2 && (result.layer_2.entity_candidates.length === 0
                      ? <div className="detail-note">None identified.</div>
                      : result.layer_2.entity_candidates.map((e, i) => (
                          <div key={i} className="detail-row"><span className="d-main">{domainIcon(e.domain)} {e.label}</span><span className="d-sub">{e.domain}{e.email ? ` · ${e.email}` : ""}</span></div>
                        ))
                    )}
                    {n === 3 && (result.layer_3.state_updates.length === 0
                      ? <div className="detail-note">No changes.</div>
                      : result.layer_3.state_updates.map((u, i) => (
                          <div key={i} className="detail-row"><span className="d-main">{u.entity_label} → {u.field}</span><span className="d-sub">{u.new_value}</span></div>
                        ))
                    )}
                    {n === 4 && (result.layer_4.new_obligations.length === 0
                      ? <div className="detail-note">None created.</div>
                      : result.layer_4.new_obligations.map((o, i) => (
                          <div key={i} className="detail-row"><span className="d-main" style={{ color: priorityColor(o.priority) }}>● {o.title}</span><span className="d-sub">{o.owed_by} → {o.owed_to}{o.due_hint ? ` · ${o.due_hint}` : ""}</span></div>
                        ))
                    )}
                    {n === 5 && (<>
                      {result.layer_5.risk_flags.map((r, i) => (
                        <div key={i} className="detail-row"><span className="d-main" style={{ color: riskColor(r.severity) }}>⚑ {r.flag}</span><span className="d-sub">{r.severity} severity</span></div>
                      ))}
                      {result.layer_5.inferences.map((inf, i) => (
                        <div key={i} className="detail-row"><span className="d-main">{inf.statement}</span><span className="d-sub">{Math.round(inf.confidence * 100)}% confidence</span></div>
                      ))}
                      {result.layer_5.inferences.length === 0 && result.layer_5.risk_flags.length === 0 && <div className="detail-note">No inferences.</div>}
                    </>)}
                    {n === 6 && (result.layer_6.proposed_actions.length === 0
                      ? <div className="detail-note">No actions.</div>
                      : result.layer_6.proposed_actions.map((a, i) => (
                          <div key={i} className="detail-row">
                            <span className="d-main">#{a.rank} {a.description}</span>
                            <div className="action-chips">
                              <span className="chip" style={{ color: riskColor(a.risk) }}>{a.risk} risk</span>
                              {a.requires_approval && <span className="chip approval">needs approval</span>}
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!result && <div className="detail-note" style={{ padding: "24px 16px" }}>No processing result available.</div>}
      </div>
    </div>
  );
}

// ─── Entity Profile Sheet ─────────────────────────────────────────────────────

function EntityProfile({ entity, onClose }: { entity: Entity; onClose: () => void }) {
  const [prov, setProv] = useState<Provenance | null>(null);
  const [loadingProv, setLoadingProv] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "signals" | "obligations">("overview");

  // Resolve display name and domain — new entities use 'name'/'type', old use 'canonical_name'/'domain'
  const displayName = (entity as any).name || entity.canonical_name || "Unknown";
  const displayDomain = (entity as any).type || entity.domain || "artifact";
  const displayAliases: Array<{ value: string }> = Array.isArray(entity.aliases)
    ? entity.aliases.map(a => typeof a === "string" ? { value: a } : a)
    : [];

  useEffect(() => {
    fetch(`/api/entities/${entity.id}/provenance`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setProv(d); setLoadingProv(false); })
      .catch(() => setLoadingProv(false));
  }, [entity.id]);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="entity-avatar" style={{ background: domainColor(displayDomain) }}>
            <span style={{ fontSize: 22 }}>{domainIcon(displayDomain)}</span>
          </div>
          <div className="sheet-head-text">
            <div className="sheet-from">{displayName}</div>
            <div className="sheet-meta">{displayDomain} · since {new Date(entity.created_at).toLocaleDateString()}</div>
          </div>
          <button className="sheet-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="entity-tabs">
          {(["overview", "signals", "obligations"] as const).map(t => (
            <button key={t} className={`entity-tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>
              {t === "signals" ? "Signals" : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "signals" && prov && prov.signals.length > 0 && (
                <span style={{ marginLeft: 4, background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "1px 5px", fontSize: 10 }}>{prov.signals.length}</span>
              )}
              {t === "obligations" && prov && prov.obligations.length > 0 && (
                <span style={{ marginLeft: 4, background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "1px 5px", fontSize: 10 }}>{prov.obligations.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="entity-body">
          {activeTab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { label: "Type", value: displayDomain },
                  { label: "Signals", value: loadingProv ? "…" : (prov?.signals.length ?? 0).toString() },
                  { label: "Open Tasks", value: loadingProv ? "…" : (prov?.obligations.filter(o => o.status === "open" || o.status === "pending").length ?? 0).toString() },
                  { label: "Known As", value: displayAliases.length > 0 ? displayAliases.length.toString() + " alias" + (displayAliases.length > 1 ? "es" : "") : "None" },
                  (entity as any).email ? { label: "Email", value: (entity as any).email } : null,
                  (entity as any).organization ? { label: "Org", value: (entity as any).organization } : null,
                  (entity as any).role ? { label: "Role", value: (entity as any).role } : null,
                ].filter(Boolean).map(row => (
                  <div key={row!.label} style={{ background: "var(--bg3)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{row!.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row!.value}</div>
                  </div>
                ))}
              </div>
              {displayAliases.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Also known as</div>
                  <div className="alias-chips">
                    {displayAliases.map((a, i) => (
                      <span key={i} className="alias-chip">{a.value}</span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {activeTab === "signals" && (
            loadingProv ? <div className="detail-note">Loading signals…</div>
            : !prov || prov.signals.length === 0
              ? <div className="detail-note">No signals linked to this entity yet.</div>
              : <>
                  {prov.signals.map((s, i) => (
                    <div key={i} style={{ background: "var(--bg3)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{s.metadata?.subject || "(no subject)"}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{s.metadata?.from || "Unknown sender"}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{s.metadata?.date ? new Date(s.metadata.date).toLocaleDateString() : ""}</div>
                    </div>
                  ))}
                  {prov.state_updates.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, color: "var(--text3)", margin: "12px 0 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>State Changes</div>
                      {prov.state_updates.map((u, i) => (
                        <div key={i} className="prov-row">
                          <div className="prov-line" />
                          <div className="prov-content">
                            <div className="prov-field">{u.field} <span className="prov-value">→ {u.new_value}</span></div>
                            <div className="prov-source">{u.source_fact}</div>
                            {u.mutated_at && <div className="prov-time">{timeAgo(u.mutated_at)}</div>}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
          )}
          {activeTab === "obligations" && (
            loadingProv ? <div className="detail-note">Loading…</div>
            : !prov || prov.obligations.length === 0
              ? <div className="detail-note">No obligations linked to this entity.</div>
              : prov.obligations.map((ob, i) => (
                  <div key={i} className="ob-card" style={{ marginBottom: 8 }}>
                    <div className="ob-dot" style={{ background: priorityColor(ob.priority) }} />
                    <div className="ob-body">
                      <div className="ob-title">{ob.title}</div>
                      <div className="ob-meta">{ob.owed_by} → {ob.owed_to}</div>
                      <div className="ob-meta" style={{ marginTop: 2 }}>
                        <span style={{ background: ob.status === "resolved" ? "#34C759" : ob.status === "open" ? "var(--accent)" : "var(--bg3)", color: ob.status === "resolved" || ob.status === "open" ? "#fff" : "var(--text2)", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>
                          {ob.status}
                        </span>
                        {ob.priority && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text3)" }}>{ob.priority} priority</span>}
                      </div>
                    </div>
                  </div>
                ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Entity Card ──────────────────────────────────────────────────────────────

function EntityCard({ entity, onClick }: { entity: Entity; onClick: () => void }) {
  const displayName = (entity as any).name || entity.canonical_name || "Unknown";
  const displayDomain = entity.domain || (entity as any).type || "unknown";
  const aliasCount = Array.isArray(entity.aliases) ? entity.aliases.length : 0;
  return (
    <div className="entity-card" onClick={onClick}>
      <div className="entity-avatar-sm" style={{ background: domainColor(displayDomain) }}>
        <span>{domainIcon(displayDomain)}</span>
      </div>
      <div className="entity-card-body">
        <div className="entity-name">{displayName}</div>
        <div className="entity-meta">
          {displayDomain}
          {aliasCount > 0 && ` · ${aliasCount} alias${aliasCount > 1 ? "es" : ""}`}
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text3)", flexShrink: 0 }}><path d="m9 18 6-6-6-6"/></svg>
    </div>
  );
}

// ─── Contradiction Card ───────────────────────────────────────────────────────

function ContraCard({ c }: { c: Contradiction }) {
  return (
    <div className="contra-card">
      <div className="contra-icon">⚡</div>
      <div className="contra-body">
        <div className="contra-desc">{c.description}</div>
        <div className="contra-entities">{c.entities_involved.join(", ")}</div>
        <div className="contra-signals">
          <span className="prov-signal-id">{c.signal_a}</span>
          <span style={{ color: "var(--text3)", margin: "0 6px" }}>vs</span>
          <span className="prov-signal-id">{c.signal_b}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Obligation Card ──────────────────────────────────────────────────────────

function ObCard({ ob, onClick }: { ob: Obligation; onClick?: () => void }) {
  return (
    <div className={`ob-card${onClick ? " ob-card-clickable" : ""}`} onClick={onClick}>
      <div className="ob-dot" style={{ background: priorityColor(ob.priority) }} />
      <div className="ob-body">
        <div className="ob-title">{ob.title}</div>
        <div className="ob-meta">{ob.owed_by} → {ob.owed_to}{ob.due_hint ? ` · ${ob.due_hint}` : ""}</div>
      </div>
      {onClick && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text3)", flexShrink: 0, marginTop: 2 }}><path d="m9 18 6-6-6-6"/></svg>}
    </div>
  );
}

// ─── Workspace Card ───────────────────────────────────────────────────────────

function WorkspaceCard({ ws, onClick }: { ws: Workspace; onClick: () => void }) {
  const statusColor = ws.status === "active" ? "#34C759" : ws.status === "on_hold" ? "#FF9500" : "#636366";
  return (
    <div className="ws-card" onClick={onClick}>
      <div className="ws-card-left">
        <div className="ws-avatar" style={{ background: getAvatarColor(ws.name) }}>
          {ws.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
        </div>
        <div className="thread-line" />
      </div>
      <div className="ws-card-body">
        <div className="card-header-row">
          <span className="card-from">{ws.client_name || ws.name}</span>
          <span className="card-time">{timeAgo(ws.last_activity_at || ws.updated_at)}</span>
        </div>
        <div className="card-subject">{ws.name}</div>
        {ws.description && <div className="ws-desc">{ws.description.slice(0, 90)}{ws.description.length > 90 ? "…" : ""}</div>}
        <div className="card-tags">
          <span className="badge" style={{ background: statusColor + "22", color: statusColor }}>{ws.status}</span>
          <span className="badge src">{ws.signal_ids.length} signals</span>
          <span className="badge src">{ws.obligation_ids.length} tasks</span>
          {ws.tags.slice(0, 2).map(t => <span key={t} className="badge">{t}</span>)}
        </div>
      </div>
    </div>
  );
}

// ─── Workspace Detail Sheet ───────────────────────────────────────────────────

function WorkspaceSheet({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const [wsTab, setWsTab] = useState<"signals" | "tasks" | "entities" | "updates">("signals");
  const [detail, setDetail] = useState<Workspace | null>(null);

  useEffect(() => {
    fetch(`/api/workspaces/${ws.id}`).then(r => r.json()).then(setDetail).catch(() => setDetail(ws));
  }, [ws.id]);

  const d = detail || ws;
  const statusColor = d.status === "active" ? "#34C759" : d.status === "on_hold" ? "#FF9500" : "#636366";

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="bottom-sheet ws-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="ws-avatar" style={{ background: getAvatarColor(d.name), width: 38, height: 38, minWidth: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14 }}>
            {d.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="sheet-head-text">
            <div className="sheet-from">{d.name}</div>
            <div className="sheet-meta">
              <span style={{ color: statusColor }}>{d.status}</span>
              {d.client_name && ` · ${d.client_name}`}
            </div>
          </div>
          <button className="sheet-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        {d.description && <div className="sheet-subject" style={{ fontSize: 14, color: "var(--text2)", marginBottom: 12 }}>{d.description}</div>}
        <div className="ws-stats-row">
          <div className="ws-stat"><span className="ws-stat-num">{d.signal_ids.length}</span><span className="ws-stat-lbl">Signals</span></div>
          <div className="ws-stat"><span className="ws-stat-num">{d.obligation_ids.length}</span><span className="ws-stat-lbl">Tasks</span></div>
          <div className="ws-stat"><span className="ws-stat-num">{d.entity_ids.length}</span><span className="ws-stat-lbl">Entities</span></div>
          <div className="ws-stat"><span className="ws-stat-num">{d.tags.length}</span><span className="ws-stat-lbl">Tags</span></div>
        </div>
        <div className="entity-tabs">
          {(["signals", "tasks", "entities", "updates"] as const).map(t => (
            <button key={t} className={`entity-tab${wsTab === t ? " active" : ""}`} onClick={() => setWsTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ overflowY: "auto", padding: "8px 0 24px" }}>
          {wsTab === "signals" && (
            <div>
              {!d.signals || d.signals.length === 0
                ? <div className="empty-msg">No signals linked yet.</div>
                : d.signals.map(sig => (
                  <div key={sig.id} className="prov-row" style={{ padding: "10px 16px" }}>
                    <div className="prov-content">
                      <div className="prov-field">{sig.metadata?.subject || "No subject"}</div>
                      <div className="prov-source">{sig.metadata?.from || sig.source} · {timeAgo(sig.received_at)}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
          {wsTab === "tasks" && (
            <div>
              {!d.obligations || d.obligations.length === 0
                ? <div className="empty-msg">No tasks linked yet.</div>
                : d.obligations.map(ob => <ObCard key={ob.id} ob={ob} />)
              }
            </div>
          )}
          {wsTab === "entities" && (
            <div>
              {!d.entities || d.entities.length === 0
                ? <div className="empty-msg">No entities linked yet.</div>
                : d.entities.map(e => (
                  <div key={e.id} className="entity-card" style={{ cursor: "default" }}>
                    <div className="entity-avatar-sm" style={{ background: domainColor(e.domain) }}>
                      <span>{domainIcon(e.domain)}</span>
                    </div>
                    <div className="entity-card-body">
                      <div className="entity-name">{e.canonical_name}</div>
                      <div className="entity-meta">{e.domain}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
          {wsTab === "updates" && (
            <div>
              {!d.state_updates || d.state_updates.length === 0
                ? <div className="empty-msg">No state updates yet.</div>
                : d.state_updates.map((u, i) => (
                  <div key={i} className="prov-row" style={{ padding: "10px 16px" }}>
                    <div className="prov-content">
                      <div className="prov-field">{u.entity_label} · {u.field}</div>
                      <div className="prov-source">{String(u.new_value)}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Health Ring ─────────────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const r = 28; const circ = 2 * Math.PI * r;
  const color = score >= 80 ? "#34C759" : score >= 60 ? "#FF9500" : "#FF3B30";
  const label = score >= 80 ? "Healthy" : score >= 60 ? "Warning" : "Critical";
  return (
    <div className="health-ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#2c2c2e" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
          strokeLinecap="round" transform="rotate(-90 36 36)" />
      </svg>
      <div className="health-ring-inner">
        <span className="health-score" style={{ color }}>{score}</span>
        <span className="health-label" style={{ color }}>{label}</span>
      </div>
    </div>
  );
}

// ─── World State Dashboard ────────────────────────────────────────────────────

function WorldDashboard({ world, onObligationClick }: { world: WorldState; onObligationClick: (ob: WorldObligation) => void }) {
  const s = world.summary;
  const maxUpdates = Math.max(1, ...world.most_active_entities.map(e => e.update_count));
  return (
    <div className="feed-list">
      {/* Health card */}
      <div className="world-health-card">
        <HealthRing score={s.health_score} />
        <div className="world-stats-grid">
          {[
            { num: s.total_signals, lbl: "Signals" },
            { num: s.total_entities, lbl: "Entities" },
            { num: s.open_obligations, lbl: "Open", warn: s.open_obligations > 0 },
            { num: s.overdue_obligations, lbl: "Overdue", warn: s.overdue_obligations > 0 },
            { num: s.active_contradictions, lbl: "Conflicts", warn: s.active_contradictions > 0 },
            { num: s.active_workspaces, lbl: "Workspaces" },
          ].map(({ num, lbl, warn }) => (
            <div key={lbl} className="world-stat">
              <span className="world-stat-num" style={warn ? { color: "#FF9500" } : {}}>{num}</span>
              <span className="world-stat-lbl">{lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Overdue obligations */}
      {world.overdue_obligations.length > 0 && (
        <>
          <div className="section-title" style={{ color: "#FF3B30" }}>⚠ Overdue</div>
          {world.overdue_obligations.map(ob => (
            <div key={ob.id} className="world-ob-card overdue" style={{ cursor: "pointer" }} onClick={() => onObligationClick(ob)}>
              <div className="ob-dot" style={{ background: "#FF3B30" }} />
              <div className="ob-body">
                <div className="ob-title">{ob.title}</div>
                <div className="ob-meta">{ob.owed_by} → {ob.owed_to}{ob.due_date ? ` · due ${new Date(ob.due_date).toLocaleDateString()}` : ""}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text3)", flexShrink: 0 }}><path d="m9 18 6-6-6-6"/></svg>
            </div>
          ))}
        </>
      )}

      {/* Open obligations */}
      {world.open_obligations.length > 0 && (
        <>
          <div className="section-title">Open Tasks</div>
          {world.open_obligations.slice(0, 5).map(ob => (
            <div key={ob.id} className="world-ob-card" style={{ cursor: "pointer" }} onClick={() => onObligationClick(ob)}>
              <div className="ob-dot" style={{ background: priorityColor(ob.priority) }} />
              <div className="ob-body">
                <div className="ob-title">{ob.title}</div>
                <div className="ob-meta">{ob.owed_by} → {ob.owed_to}{ob.due_hint ? ` · ${ob.due_hint}` : ""}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text3)", flexShrink: 0 }}><path d="m9 18 6-6-6-6"/></svg>
            </div>
          ))}
        </>
      )}

      {/* Active contradictions */}
      {world.active_contradictions.length > 0 && (
        <>
          <div className="section-title" style={{ color: "#FF9500" }}>Active Contradictions</div>
          {world.active_contradictions.map(c => (
            <div key={c.id} className="contra-card">
              <div className="contra-icon">⚡</div>
              <div className="contra-body">
                <div className="contra-desc">{c.description}</div>
                {c.entity_label && <div className="contra-entities">{c.entity_label}</div>}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Most active entities */}
      {world.most_active_entities.length > 0 && (
        <>
          <div className="section-title">Most Active Entities</div>
          {world.most_active_entities.map(e => (
            <div key={e.id} className="world-entity-row">
              <div className="entity-avatar-sm" style={{ background: domainColor(e.domain), width: 36, height: 36, minWidth: 36 }}>
                <span style={{ fontSize: 16 }}>{domainIcon(e.domain)}</span>
              </div>
              <div className="world-entity-body">
                <div className="entity-name" style={{ fontSize: 14 }}>{e.canonical_name}</div>
                <div className="entity-meta">{e.update_count} update{e.update_count !== 1 ? "s" : ""}</div>
              </div>
              <div className="world-entity-bar-wrap">
                <div className="world-entity-bar" style={{ width: `${Math.min(100, (e.update_count / maxUpdates) * 100)}%`, background: domainColor(e.domain) }} />
              </div>
            </div>
          ))}
        </>
      )}

      {/* Recent activity */}
      {world.recent_activity.length > 0 && (
        <>
          <div className="section-title">Recent Activity</div>
          {world.recent_activity.map(a => (
            <div key={a.id} className="world-activity-row">
              <div className="activity-dot" />
              <div className="activity-body">
                <span className="activity-entity">{a.entity_label}</span>
                <span className="activity-field"> · {a.field}</span>
                <span className="activity-value"> → {a.new_value}</span>
              </div>
              <span className="activity-time">{timeAgo(a.mutated_at)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

type Tab = "feed" | "tasks" | "review" | "entities" | "world" | "connect" | "simulate";

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "feed", label: "Signal Feed", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
  { id: "tasks", label: "Tasks", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
  { id: "review", label: "Review Queue", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
  { id: "entities", label: "Entities", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg> },
  { id: "world", label: "World State", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> },
  { id: "connect", label: "Connect", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> },
  // Recipes tab removed — static templates with no trigger engine
  { id: "simulate", label: "Simulate", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg> },
];

function Sidebar({ tab, setTab, pendingCount, onClose }: { tab: Tab; setTab: (t: Tab) => void; pendingCount: number; onClose: () => void }) {
  return (
    <>
      <div className="sidebar-overlay" onClick={onClose} />
      <div className="sidebar">
        <div className="sidebar-head">
          <div className="topbar-logo">
            <span className="logo-mark">◈</span>
            <span className="logo-name">Axiom</span>
          </div>
          <button className="sheet-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`sidebar-item${tab === item.id ? " active" : ""}`}
              onClick={() => { setTab(item.id); onClose(); }}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
              {item.id === "review" && pendingCount > 0 && (
                <span className="sidebar-badge">{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontSize: 12, color: "var(--text3)" }}>Axiom World State</div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>v0.13.0</div>
        </div>
      </div>
    </>
  );
}

// ─── Search Bar ───────────────────────────────────────────────────────────────

function SearchBar({ query, setQuery, onClose }: { query: string; setQuery: (q: string) => void; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="search-bar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--text3)", flexShrink: 0 }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Search signals, entities, tasks…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {query && (
        <button className="search-clear" onClick={() => setQuery("")}>✕</button>
      )}
      <button className="search-cancel" onClick={() => { setQuery(""); onClose(); }}>Cancel</button>
    </div>
  );
}

// ─── Connect Tab ──────────────────────────────────────────────────────────────

interface GmailStatus {
  connected: boolean;
  email?: string;
  last_sync?: string;
  signal_count?: number;
}

function ConnectTab({ onIngest }: { onIngest: (signal: Signal) => void }) {
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({ connected: false });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ added: number; skipped: number } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteFrom, setPasteFrom] = useState("");
  const [pasteSubject, setPasteSubject] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [processStatus, setProcessStatus] = useState<{ total: number; processed: number; unprocessed: number } | null>(null);
  const [processResult, setProcessResult] = useState<{ processed: number; noise: number; errors: number } | null>(null);

  // Load real Gmail status and process queue status on mount
  useEffect(() => {
    fetch("/api/connect/gmail/status")
      .then(r => r.json())
      .then((data: GmailStatus) => setGmailStatus(data))
      .catch(() => {});
    fetch("/api/process/status")
      .then(r => r.json())
      .then((data: { total: number; processed: number; unprocessed: number }) => setProcessStatus(data))
      .catch(() => {});
  }, []);

  // Check for ?gmail_connected=1 in URL after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "1") {
      // Remove query param from URL
      window.history.replaceState({}, "", window.location.pathname);
      // Refresh status
      fetch("/api/connect/gmail/status")
        .then(r => r.json())
        .then((data: GmailStatus) => setGmailStatus(data))
        .catch(() => {});
      const added = parseInt(params.get("added") ?? "0", 10);
      if (added > 0) setSyncResult({ added, skipped: 0 });
    }
  }, []);

  const handleGmailConnect = () => {
    // Redirect the current tab to the OAuth flow (same-window so callback can redirect back)
    window.location.href = "/api/connect/gmail/auth";
  };

  const handleGmailSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/connect/gmail/sync", { method: "POST" });
      const data = await res.json() as { added: number; skipped: number; success: boolean; error?: string };
      if (data.success) {
        setSyncResult({ added: data.added, skipped: data.skipped });
        // Refresh status
        const statusRes = await fetch("/api/connect/gmail/status");
        const status = await statusRes.json() as GmailStatus;
        setGmailStatus(status);
      } else {
        setIngestResult({ ok: false, message: data.error ?? "Sync failed." });
      }
    } catch {
      setIngestResult({ ok: false, message: "Network error during sync." });
    }
    setSyncing(false);
  };

  const handleGmailDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/connect/gmail", { method: "DELETE" });
      setGmailStatus({ connected: false });
      setSyncResult(null);
    } catch { /* ignore */ }
    setDisconnecting(false);
  };

  const handleProcessQueue = async () => {
    setProcessingQueue(true);
    setProcessResult(null);
    try {
      const res = await fetch("/api/process/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: 50 }),
      });
      const data = await res.json() as { success: boolean; processed: number; noise: number; errors: number; total: number };
      if (data.success) {
        setProcessResult({ processed: data.processed, noise: data.noise, errors: data.errors });
        // Refresh queue status
        const statusRes = await fetch("/api/process/status");
        const status = await statusRes.json() as { total: number; processed: number; unprocessed: number };
        setProcessStatus(status);
      }
    } catch {
      setProcessResult({ processed: 0, noise: 0, errors: 1 });
    }
    setProcessingQueue(false);
  };

  const handleManualIngest = async () => {
    if (!pasteText.trim()) return;
    setIngesting(true);
    setIngestResult(null);
    try {
      const res = await fetch("/api/ingest/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_content: pasteText,
          from: pasteFrom || "manual@paste",
          subject: pasteSubject || "Manual ingest",
        }),
      });
      if (res.ok) {
        const signal = await res.json() as Signal;
        onIngest(signal);
        setPasteText("");
        setPasteFrom("");
        setPasteSubject("");
        setIngestResult({ ok: true, message: `Signal ${signal.id} ingested successfully.` });
      } else {
        const err = await res.json() as { error?: string };
        setIngestResult({ ok: false, message: err.error || "Ingest failed." });
      }
    } catch (e) {
      setIngestResult({ ok: false, message: "Network error — is the API server running?" });
    }
    setIngesting(false);
  };

  return (
    <div className="feed-list">
      <div className="section-title">Ingest Connections</div>

      {/* Gmail connection card */}
      <div className="connect-card">
        <div className="connect-icon">✉️</div>
        <div className="connect-body">
          <div className="connect-name">Gmail</div>
          {gmailStatus.connected ? (
            <>
              <div className="connect-status" style={{ color: "#34C759" }}>● Connected{gmailStatus.email ? ` · ${gmailStatus.email}` : ""}</div>
              {gmailStatus.signal_count !== undefined && (
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{gmailStatus.signal_count} emails synced</div>
              )}
              {gmailStatus.last_sync && (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>Last sync: {new Date(gmailStatus.last_sync).toLocaleString()}</div>
              )}
            </>
          ) : (
            <div className="connect-status" style={{ color: "var(--text3)" }}>○ Not connected</div>
          )}
        </div>
        {gmailStatus.connected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <button className="connect-btn" style={{ fontSize: 12, padding: "6px 12px" }} onClick={handleGmailSync} disabled={syncing}>
              {syncing ? "↻ Syncing…" : "↻ Sync Now"}
            </button>
            <button className="connect-btn connect-btn-danger" style={{ fontSize: 12, padding: "5px 10px" }} onClick={handleGmailDisconnect} disabled={disconnecting}>
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <button className="connect-btn" onClick={handleGmailConnect}>Connect</button>
        )}
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div style={{ margin: "0 16px 4px", padding: "10px 14px", background: "rgba(52,199,89,0.1)", borderRadius: 10, fontSize: 13, color: "#34C759" }}>
          ✓ Sync complete — {syncResult.added} new signal{syncResult.added !== 1 ? "s" : ""} added{syncResult.skipped > 0 ? `, ${syncResult.skipped} already seen` : ""}.
        </div>
      )}

      {/* Manual paste */}
      <div className="connect-card">
        <div className="connect-icon">📋</div>
        <div className="connect-body">
          <div className="connect-name">Manual Paste</div>
          <div className="connect-status" style={{ color: "#34C759" }}>● Always available</div>
        </div>
      </div>

      {/* Manual paste ingest */}
      <div className="section-title" style={{ marginTop: 8 }}>Manual Email Ingest</div>
      <div className="review-card">
        <div className="review-title" style={{ marginBottom: 12 }}>Paste an email to ingest it as a signal</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            className="review-note-input"
            style={{ padding: "8px 12px" }}
            placeholder="From (e.g. client@example.com)"
            value={pasteFrom}
            onChange={e => setPasteFrom(e.target.value)}
          />
          <input
            className="review-note-input"
            style={{ padding: "8px 12px" }}
            placeholder="Subject"
            value={pasteSubject}
            onChange={e => setPasteSubject(e.target.value)}
          />
          <textarea
            className="review-note-input"
            style={{ padding: "10px 12px", minHeight: 120, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            placeholder="Paste email body here…"
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
          />
          <button
            className="review-btn approve"
            style={{ alignSelf: "flex-start", padding: "10px 20px" }}
            disabled={ingesting || !pasteText.trim()}
            onClick={handleManualIngest}
          >
            {ingesting ? "Ingesting…" : "Ingest Signal"}
          </button>
          {ingestResult && (
            <div style={{ fontSize: 13, color: ingestResult.ok ? "#34C759" : "#FF3B30", padding: "8px 12px", background: ingestResult.ok ? "rgba(52,199,89,0.08)" : "rgba(255,59,48,0.08)", borderRadius: 8 }}>
              {ingestResult.message}
            </div>
          )}
        </div>
      </div>

      {/* Processing Queue */}
      <div className="section-title" style={{ marginTop: 8 }}>Processing Queue</div>
      <div className="review-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div className="review-title" style={{ marginBottom: 4 }}>AI Signal Processor</div>
            {processStatus && (
              <div style={{ fontSize: 12, color: "var(--text3)" }}>
                {processStatus.processed} processed · {processStatus.unprocessed} queued · {processStatus.total} total
              </div>
            )}
          </div>
          <button
            className="connect-btn"
            style={{ fontSize: 12, padding: "8px 14px", opacity: processingQueue ? 0.6 : 1 }}
            onClick={handleProcessQueue}
            disabled={processingQueue || (processStatus?.unprocessed === 0)}
          >
            {processingQueue ? "⚙ Processing…" : processStatus?.unprocessed === 0 ? "✓ All processed" : `⚙ Process ${Math.min(processStatus?.unprocessed ?? 0, 50)} signals`}
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
          The AI processor runs the six-layer analysis on each signal, extracts entities, creates obligations, and flags risks. Noise (newsletters, promotions) is filtered automatically without using AI credits.
        </div>
        {processResult && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(52,199,89,0.08)", borderRadius: 8, fontSize: 13, color: "#34C759" }}>
            ✓ Batch complete — {processResult.processed} signals processed by AI, {processResult.noise} filtered as noise{processResult.errors > 0 ? `, ${processResult.errors} errors` : ""}.
          </div>
        )}
      </div>

      {/* Webhook info */}
      <div className="section-title" style={{ marginTop: 8 }}>Webhook Endpoint</div>
      <div className="review-card">
        <div className="review-desc">POST raw email payloads to this endpoint to ingest them programmatically:</div>
        <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 12px", marginTop: 8, fontFamily: "monospace", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>
          POST /api/ingest/manual
        </div>
        <div className="review-desc" style={{ marginTop: 8 }}>
          Body: <code style={{ fontFamily: "monospace", background: "var(--bg3)", padding: "1px 5px", borderRadius: 4 }}>{"{ from, subject, raw_content }"}</code>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>("feed");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Signal | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [selectedObligation, setSelectedObligation] = useState<Obligation | WorldObligation | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  // Per-item note state: map of id → note string
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [worldState, setWorldState] = useState<WorldState | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [simForm, setSimForm] = useState({ name: "", kind: "obligation_resolved", target_id: "", description: "" });
  const [simRunning, setSimRunning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hideNoise, setHideNoise] = useState(true);
  const [showDecided, setShowDecided] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/signals").then(r => r.json()),
      fetch("/api/obligations").then(r => r.json()),
      fetch("/api/entities").then(r => r.json()),
      fetch("/api/contradictions").then(r => r.json()),
      fetch("/api/summary").then(r => r.json()),
      fetch("/api/review").then(r => r.json()),
      fetch("/api/workspaces").then(r => r.json()),
      fetch("/api/world").then(r => r.json()),
      fetch("/api/recipes").then(r => r.json()),
      fetch("/api/simulations").then(r => r.json()),
    ]).then(([s, o, e, c, sum, rv, ws, wd, rec, sims]) => {
      setSignals(s); setObligations(o); setEntities(e);
      setContradictions(c); setSummary(sum); setReviewItems(rv); setWorkspaces(ws); setWorldState(wd);
      setRecipes(rec); setSimulations(sims);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const pendingReview = reviewItems.filter(r => r.status === "pending");

  const handleDecide = async (id: string, decision: string) => {
    setDecidingId(id);
    const note = reviewNotes[id] || "";
    try {
      const res = await fetch(`/api/review/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      if (res.ok) {
        const data = await res.json() as { item: ReviewItem; obligation?: Obligation; message: string };
        // Update the review item in state
        setReviewItems(prev => prev.map(r => r.id === id ? (data.item || r) : r));
        setReviewNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
        // If approve created a new obligation, add it to the tasks list
        if (data.obligation) {
          setObligations(prev => [data.obligation!, ...prev]);
          setSummary(prev => prev ? { ...prev, open_obligations: prev.open_obligations + 1 } : prev);
        }
      }
    } catch { /* ignore */ }
    setDecidingId(null);
  };

  const handleResolveObligation = async (id: string) => {
    try {
      const res = await fetch(`/api/obligations/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        // Remove from local state immediately so it disappears from Tasks view
        setObligations(prev => prev.filter(o => o.id !== id));
        setSummary(prev => prev ? { ...prev, open_obligations: Math.max(0, prev.open_obligations - 1) } : prev);
        // Also refresh world state so World tab updates
        fetch("/api/world").then(r => r.json()).then(setWorldState).catch(() => {});
        setSelectedObligation(null);
      }
    } catch { /* ignore */ }
  };

  const handleSnoozeObligation = async (id: string) => {
    try {
      const res = await fetch(`/api/obligations/${id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 3 }),
      });
      if (res.ok) {
        // Refresh obligations to get updated due date and remove from open list
        fetch("/api/obligations").then(r => r.json()).then(setObligations).catch(() => {});
        fetch("/api/world").then(r => r.json()).then(setWorldState).catch(() => {});
        setSelectedObligation(null);
      }
    } catch { /* ignore */ }
  };

  const handleSelect = async (sig: Signal) => {
    setSelected(sig);
    try {
      const r = await fetch(`/api/signals/${sig.id}/result`);
      setResult(r.ok ? await r.json() : null);
    } catch { setResult(null); }
  };

  const handleIngest = (signal: Signal) => {
    setSignals(prev => [signal, ...prev]);
    setSummary(prev => prev ? { ...prev, signals: prev.signals + 1 } : prev);
  };

  // Search filtering
  const q = searchQuery.toLowerCase();
  // hideNoise=true shows only real business signals (not noise)
  const noiseFilteredSignals = hideNoise
    ? signals.filter(s => s.is_noise !== true)
    : signals;
  const filteredSignals = q
    ? noiseFilteredSignals.filter(s => (s.metadata?.subject || "").toLowerCase().includes(q) || (s.metadata?.from || "").toLowerCase().includes(q) || s.raw_content?.toLowerCase().includes(q))
    : noiseFilteredSignals;
  // Only show open/pending obligations in Tasks tab — resolved/snoozed ones disappear
  const openObligations = obligations.filter(o => o.status === "open" || o.status === "pending");
  const filteredObligations = q
    ? openObligations.filter(o => o.title.toLowerCase().includes(q) || o.owed_by.toLowerCase().includes(q) || o.owed_to.toLowerCase().includes(q))
    : openObligations;
  const filteredEntities = q
    ? entities.filter(e => {
        const name = ((e as any).name || e.canonical_name || "").toLowerCase();
        const domain = ((e as any).type || e.domain || "").toLowerCase();
        const aliasMatch = Array.isArray(e.aliases) && e.aliases.some(a => (typeof a === "string" ? a : a.value || "").toLowerCase().includes(q));
        return name.includes(q) || domain.includes(q) || aliasMatch;
      })
    : entities;

  // Group entities by domain (new entities use 'type', old ones use 'domain')
  const getEntityType = (e: Entity) => (e as any).type || e.domain || "artifact";
  const people = filteredEntities.filter(e => getEntityType(e) === "person");
  const orgs = filteredEntities.filter(e => getEntityType(e) === "organization");
  const artifacts = filteredEntities.filter(e => getEntityType(e) === "artifact");

  const tabLabel = NAV_ITEMS.find(n => n.id === tab)?.label ?? "Axiom";

  return (
    <div className="app">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar tab={tab} setTab={setTab} pendingCount={pendingReview.length} onClose={() => setSidebarOpen(false)} />
      )}

      <header className="topbar">
        <button className="topbar-icon" onClick={() => setSidebarOpen(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        {searchOpen ? (
          <SearchBar query={searchQuery} setQuery={setSearchQuery} onClose={() => setSearchOpen(false)} />
        ) : (
          <>
            <div className="topbar-logo">
              <span className="logo-mark">◈</span>
              <span className="logo-name">{tabLabel}</span>
            </div>
            <button className="topbar-icon" onClick={() => setSearchOpen(true)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
          </>
        )}
      </header>

      {summary && !searchOpen && (
        <div className="summary-strip">
          <div className="s-pill"><span className="s-num">{summary.signals}</span><span className="s-lbl">signals</span></div>
          <div className="s-pill"><span className="s-num">{summary.entities}</span><span className="s-lbl">entities</span></div>
          <div className="s-pill s-hi"><span className="s-num">{summary.open_obligations}</span><span className="s-lbl">open</span></div>
          <div className="s-pill"><span className="s-num">{summary.state_updates}</span><span className="s-lbl">updates</span></div>
          {summary.unresolved_contradictions > 0 && (
            <div className="s-pill s-danger"><span className="s-num">{summary.unresolved_contradictions}</span><span className="s-lbl">conflicts</span></div>
          )}
          <div className="live-wrap"><span className="live-dot"/><span className="live-txt">Live</span></div>
        </div>
      )}

      <main className="main-content">
        {loading && <div className="loader"><div className="spinner"/></div>}

        {/* ── Feed Tab ── */}
        {!loading && tab === "feed" && (
          <div className="feed-list">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0 4px" }}>
              <div className="section-title" style={{ margin: 0 }}>
                {searchQuery ? `${filteredSignals.length} result${filteredSignals.length !== 1 ? "s" : ""} for "${searchQuery}"` : "Signal Feed"}
              </div>
              <button
                onClick={() => setHideNoise(h => !h)}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, border: "1px solid var(--border)", background: hideNoise ? "var(--accent)" : "var(--bg3)", color: hideNoise ? "#fff" : "var(--text2)", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {hideNoise ? "Showing processed" : "Showing all"}
              </button>
            </div>
            {filteredSignals.length === 0 && (
              <div className="empty-msg">
                {searchQuery ? "No signals match your search." : hideNoise ? "No processed signals yet. Use the Connect tab to run the processor." : "No signals yet. Connect Gmail or paste an email in the Connect tab."}
              </div>
            )}
            {filteredSignals.map(sig => (
              <SignalCard key={sig.id} signal={sig} isSelected={selected?.id === sig.id} onClick={() => handleSelect(sig)} />
            ))}
          </div>
        )}

        {/* ── Tasks Tab ── */}
        {!loading && tab === "tasks" && (
          <div className="feed-list">
            {searchQuery && <div className="section-title">{filteredObligations.length} result{filteredObligations.length !== 1 ? "s" : ""} for "{searchQuery}"</div>}
            {!searchQuery && <div className="section-title">Open Obligations</div>}
            {filteredObligations.length === 0 && <div className="empty-msg">{searchQuery ? "No tasks match your search." : "No open obligations."}</div>}
            {filteredObligations.map(ob => (
              <ObCard key={ob.id} ob={ob} onClick={() => setSelectedObligation(ob)} />
            ))}
          </div>
        )}

        {/* ── Entities Tab ── */}
        {!loading && tab === "entities" && (
          <div className="feed-list">
            {contradictions.length > 0 && !searchQuery && (
              <>
                <div className="section-title" style={{ color: "#FF3B30" }}>⚡ Contradictions</div>
                {contradictions.map(c => <ContraCard key={c.id} c={c} />)}
              </>
            )}
            {searchQuery && <div className="section-title">{filteredEntities.length} result{filteredEntities.length !== 1 ? "s" : ""} for "{searchQuery}"</div>}
            {people.length > 0 && (
              <>
                {!searchQuery && <div className="section-title">People</div>}
                {people.map(e => <EntityCard key={e.id} entity={e} onClick={() => setSelectedEntity(e)} />)}
              </>
            )}
            {orgs.length > 0 && (
              <>
                {!searchQuery && <div className="section-title">Organizations</div>}
                {orgs.map(e => <EntityCard key={e.id} entity={e} onClick={() => setSelectedEntity(e)} />)}
              </>
            )}
            {artifacts.length > 0 && (
              <>
                {!searchQuery && <div className="section-title">Artifacts</div>}
                {artifacts.map(e => <EntityCard key={e.id} entity={e} onClick={() => setSelectedEntity(e)} />)}
              </>
            )}
            {filteredEntities.length === 0 && <div className="empty-msg">{searchQuery ? "No entities match your search." : "No entities resolved yet."}</div>}
          </div>
        )}

        {/* ── Review Tab ── */}
        {!loading && tab === "review" && (
          <div className="feed-list">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0 4px" }}>
              <div className="section-title" style={{ margin: 0 }}>
                Review Queue
                {pendingReview.length > 0 && <span className="review-badge">{pendingReview.length}</span>}
              </div>
              <button
                onClick={() => setShowDecided(s => !s)}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, border: "1px solid var(--border)", background: showDecided ? "var(--accent)" : "var(--bg3)", color: showDecided ? "#fff" : "var(--text2)", cursor: "pointer", whiteSpace: "nowrap" }}
              >{showDecided ? "Showing all" : "Pending only"}</button>
            </div>
            {(showDecided ? reviewItems : reviewItems.filter(i => i.status === "pending" || i.status === "deferred")).length === 0 && <div className="empty-msg">{reviewItems.length === 0 ? "No items in the review queue." : "All items have been decided. Tap \"Showing all\" to see them."}</div>}
            {(showDecided ? reviewItems : reviewItems.filter(i => i.status === "pending" || i.status === "deferred")).map(item => (
              <div key={item.id} className={`review-card${item.status === "reviewed" ? " reviewed" : ""}`}>
                <div className="review-card-header">
                  <div className="review-sev-dot" style={{ background: item.severity === "critical" ? "#FF3B30" : item.severity === "high" ? "#FF9500" : item.severity === "medium" ? "#FFD60A" : "#34C759" }} />
                  <div className="review-kind-badge">
                    {item.kind === "high_risk_action" ? "⚡ Action" : item.kind === "entity_conflict" ? "🔀 Conflict" : item.kind === "contradiction" ? "⚠️ Contradiction" : "❓ Low Confidence"}
                  </div>
                  <span className="review-time">{timeAgo(item.created_at)}</span>
                  {item.status === "reviewed" && (
                    <span className="review-decision-chip" style={{ color: item.decision === "approved" ? "#34C759" : item.decision === "rejected" ? "#FF3B30" : "#FF9500" }}>
                      {item.decision}
                    </span>
                  )}
                </div>
                <div className="review-title">{item.title}</div>
                <div className="review-desc">{item.description}</div>
                {item.status === "pending" && (
                  <div className="review-actions">
                    <input
                      className="review-note-input"
                      placeholder="Optional note…"
                      value={reviewNotes[item.id] || ""}
                      onChange={e => setReviewNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                    />
                    <div className="review-btn-row">
                      <button className="review-btn approve" onClick={() => handleDecide(item.id, "approve")} disabled={decidingId === item.id} title="Creates a task from this item">
                        ✓ Approve → Task
                      </button>
                      <button className="review-btn resolve" onClick={() => handleDecide(item.id, "resolve")} disabled={decidingId === item.id} title="Mark as handled, no task needed">
                        ◎ Resolve
                      </button>
                      <button className="review-btn reject" onClick={() => handleDecide(item.id, "reject")} disabled={decidingId === item.id} title="Dismiss and teach noise filter">
                        ✕ Reject
                      </button>
                      <button className="review-btn defer" onClick={() => handleDecide(item.id, "defer")} disabled={decidingId === item.id} title="Snooze for 7 days">
                        ⟳ Defer 7d
                      </button>
                    </div>
                  </div>
                )}
                {item.status === "reviewed" && item.decision_note && (
                  <div className="review-note-display">Note: {item.decision_note}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── World Tab (Dashboard) ── */}
        {!loading && tab === "world" && (
          worldState
            ? <WorldDashboard world={worldState} onObligationClick={(ob) => setSelectedObligation(ob as unknown as Obligation)} />
            : <div className="feed-list"><div className="empty-msg">Loading world state...</div></div>
        )}

        {/* ── Connect Tab ── */}
        {!loading && tab === "connect" && (
          <ConnectTab onIngest={handleIngest} />
        )}

        {/* ── Simulate Tab ── */}
        {!loading && tab === "simulate" && (
          <div className="feed-list">
            <div className="section-title">Simulation Engine</div>
            <div className="review-card">
              <div className="review-title" style={{ marginBottom: 12 }}>Run a Hypothetical Simulation</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input className="review-note-input" style={{ padding: "8px 12px" }} placeholder="Simulation name (optional)" value={simForm.name} onChange={e => setSimForm(f => ({ ...f, name: e.target.value }))} />
                <select className="review-note-input" style={{ padding: "8px 12px" }} value={simForm.kind} onChange={e => setSimForm(f => ({ ...f, kind: e.target.value }))}>
                  <option value="obligation_resolved">Resolve an obligation</option>
                  <option value="obligation_created">Create a new obligation</option>
                  <option value="contradiction_resolved">Resolve a contradiction</option>
                  <option value="entity_attribute_change">Change an entity attribute</option>
                  <option value="signal_received">Receive a new signal</option>
                  <option value="custom">Custom change</option>
                </select>
                <input className="review-note-input" style={{ padding: "8px 12px" }} placeholder="Target ID (optional, e.g. ob-001)" value={simForm.target_id} onChange={e => setSimForm(f => ({ ...f, target_id: e.target.value }))} />
                <input className="review-note-input" style={{ padding: "8px 12px" }} placeholder="Description of the change" value={simForm.description} onChange={e => setSimForm(f => ({ ...f, description: e.target.value }))} />
                <button className="review-btn approve" style={{ alignSelf: "flex-start" }} disabled={simRunning} onClick={async () => {
                  setSimRunning(true);
                  try {
                    const res = await fetch("/api/simulations", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: simForm.name || undefined, change: { kind: simForm.kind, description: simForm.description, target_id: simForm.target_id || undefined, params: {} } }),
                    });
                    if (res.ok) {
                      const sim = await res.json();
                      setSimulations(prev => [sim, ...prev]);
                      setSimForm({ name: "", kind: "obligation_resolved", target_id: "", description: "" });
                    }
                  } catch { /* ignore */ }
                  setSimRunning(false);
                }}>
                  {simRunning ? "Running..." : "Run Simulation"}
                </button>
              </div>
            </div>
            {simulations.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16 }}>Past Simulations</div>
                {simulations.map(sim => (
                  <div key={sim.id} className="review-card">
                    <div className="review-card-header">
                      <div className="review-sev-dot" style={{ background: "#007AFF" }} />
                      <div className="review-kind-badge">{sim.change.kind.replace(/_/g, " ")}</div>
                      <span className="review-time">{timeAgo(sim.created_at)}</span>
                      <span className="badge" style={{ background: "#34C75922", color: "#34C759" }}>{sim.predicted_effects.length} effects</span>
                    </div>
                    <div className="review-title">{sim.name}</div>
                    {sim.summary && <div className="review-desc">{sim.summary}</div>}
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      {sim.predicted_effects.map((e, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderTop: "1px solid #1a1a2e" }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: e.confidence >= 0.8 ? "#34C759" : e.confidence >= 0.5 ? "#FF9500" : "#888", marginTop: 4, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: "var(--text)" }}>{e.description}</div>
                            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{Math.round(e.confidence * 100)}% confidence</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Health tab removed — replaced by action-oriented Review/Tasks flow */}
        {false && tab === ("health" as string) && (
          <div className="feed-list">
            <div className="section-title">System Health</div>
            {healthStatus && (
              <>
                <div className="review-card" style={{ borderLeft: `3px solid ${healthStatus.status === "healthy" ? "#34C759" : healthStatus.status === "degraded" ? "#FF9500" : "#FF3B30"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: healthStatus.status === "healthy" ? "#34C759" : healthStatus.status === "degraded" ? "#FF9500" : "#FF3B30" }}>
                      {healthStatus.metrics.health_score}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{healthStatus.status.toUpperCase()}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>{healthStatus.message}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[
                      { label: "Signals", value: healthStatus.metrics.signals_processed, sub: `${healthStatus.metrics.unprocessed_signals} pending` },
                      { label: "Entities", value: healthStatus.metrics.entity_count, sub: `${healthStatus.metrics.workspace_count} workspaces` },
                      { label: "Obligations", value: healthStatus.metrics.open_obligations, sub: `${healthStatus.metrics.overdue_obligations} overdue`, warn: healthStatus.metrics.overdue_obligations > 0 },
                      { label: "Contradictions", value: healthStatus.metrics.contradictions, sub: "active", warn: healthStatus.metrics.contradictions > 0 },
                      { label: "Review", value: healthStatus.metrics.review_backlog, sub: "pending", warn: healthStatus.metrics.review_backlog > 0 },
                      { label: "Failures", value: healthStatus.metrics.automation_failures, sub: "automation", warn: healthStatus.metrics.automation_failures > 0 },
                    ].map(m => (
                      <div key={m.label} style={{ background: "#0d0d1a", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: m.warn ? "#FF9500" : "var(--text)" }}>{m.value}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{m.label}</div>
                        <div style={{ fontSize: 10, color: "#555" }}>{m.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {healthStatus.alerts.length > 0 && (
                  <>
                    <div className="section-title" style={{ marginTop: 16, color: "#FF9500" }}>Active Alerts</div>
                    {healthStatus.alerts.map((a, i) => (
                      <div key={i} className="review-card">
                        <div className="review-card-header">
                          <div className="review-sev-dot" style={{ background: a.severity === "critical" ? "#FF3B30" : a.severity === "warning" ? "#FF9500" : "#007AFF" }} />
                          <div className="review-kind-badge">{a.severity.toUpperCase()}</div>
                          <span className="review-time">{a.code}</span>
                        </div>
                        <div className="review-desc">{a.message}</div>
                      </div>
                    ))}
                  </>
                )}
                <div className="section-title" style={{ marginTop: 16 }}>Automation Summary</div>
                <div className="review-card">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: "Total Runs", value: healthStatus.metrics.automation_summary.total_runs },
                      { label: "Completed", value: healthStatus.metrics.automation_summary.completed },
                      { label: "Failed", value: healthStatus.metrics.automation_summary.failed, warn: healthStatus.metrics.automation_summary.failed > 0 },
                      { label: "Pending Approval", value: healthStatus.metrics.automation_summary.pending_approval },
                    ].map(m => (
                      <div key={m.label} style={{ background: "#0d0d1a", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: m.warn ? "#FF3B30" : "var(--text)" }}>{m.value}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* ── Bottom Nav ── */}
      <nav className="bottom-nav" style={{ overflowX: "auto", justifyContent: "flex-start", gap: 0 }}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item${tab === item.id ? " active" : ""}`}
            onClick={() => setTab(item.id)}
            style={{ position: "relative" }}
          >
            {item.id === "review" && pendingReview.length > 0 && (
              <span style={{ position: "absolute", top: 4, right: 10, background: "#FF3B30", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{pendingReview.length}</span>
            )}
            {item.icon}
            <span>{item.label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>

      {/* ── Signal Inspector Sheet ── */}
      {selected && (
        <Inspector signal={selected} result={result} onClose={() => { setSelected(null); setResult(null); }} />
      )}

      {/* ── Entity Profile Sheet ── */}
      {selectedEntity && (
        <EntityProfile entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
      )}

      {/* ── Obligation Detail Sheet ── */}
      {selectedObligation && (
        <ObligationSheet
          ob={selectedObligation as Obligation}
          onClose={() => setSelectedObligation(null)}
          onResolve={(selectedObligation as Obligation).status === "open" || (selectedObligation as Obligation).status === "pending" ? handleResolveObligation : undefined}
          onSnooze={(selectedObligation as Obligation).status === "open" || (selectedObligation as Obligation).status === "pending" ? handleSnoozeObligation : undefined}
        />
      )}

      {/* ── Workspace Detail Sheet ── */}
      {selectedWorkspace && (
        <WorkspaceSheet ws={selectedWorkspace} onClose={() => setSelectedWorkspace(null)} />
      )}
    </div>
  );
}
