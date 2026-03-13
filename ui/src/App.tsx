import { useState, useEffect } from "react";
import "./App.css";
import KnowledgeGraph from "./KnowledgeGraph";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Signal {
  id: string; source: string; raw_content: string;
  metadata: { from: string; subject: string; date: string; thread_id: string };
  received_at: string; processed: boolean; adapter: string;
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
interface ReviewItem {
  id: string;
  kind: "entity_conflict" | "high_risk_action" | "contradiction" | "low_confidence";
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "reviewed";
  decision?: string;
  decision_note?: string;
  decided_at?: string;
  signal_id: string;
  entity_ids?: string[];
  action_description?: string;
  action_risk?: string;
  requires_approval: boolean;
  created_at: string;
  metadata?: Record<string, unknown>;
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

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SignalCard({ signal, isSelected, onClick }: { signal: Signal; isSelected: boolean; onClick: () => void }) {
  const from = signal.metadata?.from || signal.source;
  const subject = signal.metadata?.subject || "No subject";
  const date = signal.metadata?.date || signal.received_at;
  const isNoise = !signal.processed;
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
        <div className="card-actions">
          <button className="icon-btn" onClick={e => e.stopPropagation()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>
          <button className="icon-btn" onClick={e => e.stopPropagation()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 6 9 17l-5-5"/></svg>
          </button>
          <button className="icon-btn" onClick={e => e.stopPropagation()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
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
  const [activeTab, setActiveTab] = useState<"overview" | "provenance" | "obligations">("overview");

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
        {/* Header */}
        <div className="sheet-head">
          <div className="entity-avatar" style={{ background: domainColor(entity.domain) }}>
            <span style={{ fontSize: 22 }}>{domainIcon(entity.domain)}</span>
          </div>
          <div className="sheet-head-text">
            <div className="sheet-from">{entity.canonical_name}</div>
            <div className="sheet-meta">{entity.domain} · since {new Date(entity.created_at).toLocaleDateString()}</div>
          </div>
          <button className="sheet-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="entity-tabs">
          {(["overview", "provenance", "obligations"] as const).map(t => (
            <button key={t} className={`entity-tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === "overview" && (
          <div className="entity-body">
            {entity.email && (
              <div className="detail-row"><span className="d-sub">Email</span><span className="d-main">{entity.email}</span></div>
            )}
            {entity.organization && (
              <div className="detail-row"><span className="d-sub">Organization</span><span className="d-main">{entity.organization}</span></div>
            )}
            {entity.role && (
              <div className="detail-row"><span className="d-sub">Role</span><span className="d-main">{entity.role}</span></div>
            )}
            <div className="detail-row">
              <span className="d-sub">Domain</span>
              <span className="d-main" style={{ color: domainColor(entity.domain) }}>{entity.domain}</span>
            </div>
            <div className="detail-row">
              <span className="d-sub">First seen</span>
              <span className="d-main">{new Date(entity.created_at).toLocaleString()}</span>
            </div>
            {entity.aliases.length > 0 && (
              <div className="detail-row">
                <span className="d-sub">Also known as</span>
                <div className="alias-chips">
                  {entity.aliases.map((a, i) => (
                    <span key={i} className="alias-chip">{a.value}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Provenance Trace */}
        {activeTab === "provenance" && (
          <div className="entity-body">
            {loadingProv && <div className="loader"><div className="spinner" /></div>}
            {!loadingProv && !prov && <div className="detail-note">No provenance data available.</div>}
            {!loadingProv && prov && prov.state_updates.length === 0 && (
              <div className="detail-note">No state changes recorded for this entity yet.</div>
            )}
            {!loadingProv && prov && prov.state_updates.map((u, i) => (
              <div key={i} className="prov-row">
                <div className="prov-line" />
                <div className="prov-content">
                  <div className="prov-field">{u.field} → <span className="prov-value">{u.new_value}</span></div>
                  <div className="prov-source">{u.source_fact}</div>
                  {u.mutated_at && <div className="prov-time">{new Date(u.mutated_at).toLocaleString()}</div>}
                  {u.signal_id && (
                    <div className="prov-signal-ref">
                      from signal: <span className="prov-signal-id">{u.signal_id}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Obligations */}
        {activeTab === "obligations" && (
          <div className="entity-body">
            {loadingProv && <div className="loader"><div className="spinner" /></div>}
            {!loadingProv && prov && prov.obligations.length === 0 && (
              <div className="detail-note">No obligations linked to this entity.</div>
            )}
            {!loadingProv && prov && prov.obligations.map((ob, i) => (
              <div key={i} className="detail-row">
                <span className="d-main" style={{ color: priorityColor(ob.priority) }}>● {ob.title}</span>
                <span className="d-sub">{ob.owed_by} → {ob.owed_to}</span>
                <div className="action-chips">
                  <span className="chip" style={{ color: ob.status === "open" ? "#FF9500" : "#34C759" }}>{ob.status}</span>
                  <span className="chip">{ob.priority}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Entity Card ──────────────────────────────────────────────────────────────

function EntityCard({ entity, onClick }: { entity: Entity; onClick: () => void }) {
  return (
    <div className="entity-card" onClick={onClick}>
      <div className="entity-avatar-sm" style={{ background: domainColor(entity.domain) }}>
        <span>{domainIcon(entity.domain)}</span>
      </div>
      <div className="entity-card-body">
        <div className="entity-name">{entity.canonical_name}</div>
        <div className="entity-meta">
          {entity.domain}
          {entity.aliases.length > 0 && ` · ${entity.aliases.length} alias${entity.aliases.length > 1 ? "es" : ""}`}
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

function ObCard({ ob }: { ob: Obligation }) {
  return (
    <div className="ob-card">
      <div className="ob-dot" style={{ background: priorityColor(ob.priority) }} />
      <div className="ob-body">
        <div className="ob-title">{ob.title}</div>
        <div className="ob-meta">{ob.owed_by} → {ob.owed_to}{ob.due_hint ? ` · ${ob.due_hint}` : ""}</div>
      </div>
    </div>
  );
}

// ─── Workspace Types ─────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  name: string;
  description?: string;
  status: string;
  client_name?: string;
  entity_ids: string[];
  signal_ids: string[];
  obligation_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  last_activity_at?: string;
  // enriched fields from /api/workspaces/:id
  signals?: Signal[];
  entities?: Entity[];
  obligations?: Obligation[];
  state_updates?: StateUpdate[];
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
        <div className="sheet-scroll">
          {wsTab === "signals" && (
            <div>
              {!d.signals || d.signals.length === 0
                ? <div className="empty-msg">No signals linked yet.</div>
                : d.signals.map(sig => (
                  <div key={sig.id} className="prov-entry">
                    <div className="prov-field">{sig.metadata?.subject || "No subject"}</div>
                    <div className="prov-val">{sig.metadata?.from || sig.source} · {timeAgo(sig.received_at)}</div>
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
                  <div key={i} className="prov-entry">
                    <div className="prov-field">{u.entity_label} · {u.field}</div>
                    <div className="prov-val">{String(u.new_value)}</div>
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

// ─── World State Dashboard Types ────────────────────────────────────────────

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

function WorldDashboard({ world }: { world: WorldState }) {
  const s = world.summary;
  return (
    <div className="feed-list">
      <div className="section-title">World State</div>

      <div className="world-health-card">
        <HealthRing score={s.health_score} />
        <div className="world-stats-grid">
          <div className="world-stat"><span className="world-stat-num">{s.total_signals}</span><span className="world-stat-lbl">Signals</span></div>
          <div className="world-stat"><span className="world-stat-num">{s.total_entities}</span><span className="world-stat-lbl">Entities</span></div>
          <div className="world-stat" style={{ color: s.open_obligations > 0 ? "#FF9500" : "var(--text1)" }}>
            <span className="world-stat-num">{s.open_obligations}</span><span className="world-stat-lbl">Open</span>
          </div>
          <div className="world-stat" style={{ color: s.overdue_obligations > 0 ? "#FF3B30" : "var(--text1)" }}>
            <span className="world-stat-num">{s.overdue_obligations}</span><span className="world-stat-lbl">Overdue</span>
          </div>
          <div className="world-stat" style={{ color: s.active_contradictions > 0 ? "#FF3B30" : "var(--text1)" }}>
            <span className="world-stat-num">{s.active_contradictions}</span><span className="world-stat-lbl">Conflicts</span>
          </div>
          <div className="world-stat" style={{ color: s.pending_review > 0 ? "#FFD60A" : "var(--text1)" }}>
            <span className="world-stat-num">{s.pending_review}</span><span className="world-stat-lbl">Review</span>
          </div>
        </div>
      </div>

      {world.overdue_obligations.length > 0 && (
        <>
          <div className="section-title" style={{ color: "#FF3B30" }}>🔴 Overdue</div>
          {world.overdue_obligations.map(ob => (
            <div key={ob.id} className="world-ob-card overdue">
              <div className="ob-dot" style={{ background: "#FF3B30" }} />
              <div className="ob-body">
                <div className="ob-title">{ob.title}</div>
                <div className="ob-meta">{ob.owed_by} → {ob.owed_to}{ob.due_hint ? ` · ${ob.due_hint}` : ""}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {world.open_obligations.length > 0 && (
        <>
          <div className="section-title">Open Obligations</div>
          {world.open_obligations.map(ob => (
            <div key={ob.id} className="world-ob-card">
              <div className="ob-dot" style={{ background: priorityColor(ob.priority) }} />
              <div className="ob-body">
                <div className="ob-title">{ob.title}</div>
                <div className="ob-meta">
                  <span className="badge" style={{ background: priorityColor(ob.priority) + "22", color: priorityColor(ob.priority), marginRight: 6 }}>{ob.priority}</span>
                  {ob.owed_by} → {ob.owed_to}{ob.due_hint ? ` · ${ob.due_hint}` : ""}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {world.active_contradictions.length > 0 && (
        <>
          <div className="section-title" style={{ color: "#FF3B30" }}>⚡ Active Contradictions</div>
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

      {world.most_active_entities.length > 0 && (
        <>
          <div className="section-title">Most Active Entities</div>
          {world.most_active_entities.map(e => (
            <div key={e.id} className="world-entity-row">
              <div className="entity-avatar-sm" style={{ background: domainColor(e.domain) }}>
                <span>{domainIcon(e.domain)}</span>
              </div>
              <div className="world-entity-body">
                <div className="entity-name">{e.canonical_name}</div>
                <div className="entity-meta">{e.domain} · {e.update_count} update{e.update_count !== 1 ? "s" : ""}</div>
              </div>
              <div className="world-entity-bar-wrap">
                <div className="world-entity-bar" style={{ width: `${Math.min(100, e.update_count * 20)}%`, background: domainColor(e.domain) }} />
              </div>
            </div>
          ))}
        </>
      )}

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

// ─── App ──────────────────────────────────────────────────────────────────────

type Tab = "feed" | "tasks" | "review" | "entities" | "world" | "graph";

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
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewNote, setReviewNote] = useState<string>("");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [worldState, setWorldState] = useState<WorldState | null>(null);
  const [loading, setLoading] = useState(true);

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
    ]).then(([s, o, e, c, sum, rv, ws, wd]) => {
      setSignals(s); setObligations(o); setEntities(e);
      setContradictions(c); setSummary(sum); setReviewItems(rv); setWorkspaces(ws); setWorldState(wd); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const pendingReview = reviewItems.filter(r => r.status === "pending");

  const handleDecide = async (id: string, decision: string) => {
    setDecidingId(id);
    try {
      const res = await fetch(`/api/review/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: reviewNote }),
      });
      if (res.ok) {
        const updated = await res.json();
        setReviewItems(prev => prev.map(r => r.id === id ? updated : r));
        setReviewNote("");
      }
    } catch { /* ignore */ }
    setDecidingId(null);
  };

  const handleSelect = async (sig: Signal) => {
    setSelected(sig);
    try {
      const r = await fetch(`/api/signals/${sig.id}/result`);
      setResult(r.ok ? await r.json() : null);
    } catch { setResult(null); }
  };

  // Group entities by domain
  const people = entities.filter(e => e.domain === "person");
  const orgs = entities.filter(e => e.domain === "organization");
  const artifacts = entities.filter(e => e.domain === "artifact");

  return (
    <div className="app">
      <header className="topbar">
        <button className="topbar-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div className="topbar-logo">
          <span className="logo-mark">◈</span>
          <span className="logo-name">Axiom</span>
        </div>
        <button className="topbar-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
      </header>

      {summary && (
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
            <div className="section-title">Signal Feed</div>
            {signals.length === 0 && <div className="empty-msg">No signals yet. Connect Gmail to get started.</div>}
            {signals.map(sig => (
              <SignalCard key={sig.id} signal={sig} isSelected={selected?.id === sig.id} onClick={() => handleSelect(sig)} />
            ))}
          </div>
        )}

        {/* ── Tasks Tab ── */}
        {!loading && tab === "tasks" && (
          <div className="feed-list">
            <div className="section-title">Open Obligations</div>
            {obligations.length === 0 && <div className="empty-msg">No open obligations.</div>}
            {obligations.map(ob => <ObCard key={ob.id} ob={ob} />)}
          </div>
        )}

        {/* ── Entities Tab ── */}
        {!loading && tab === "entities" && (
          <div className="feed-list">
            {contradictions.length > 0 && (
              <>
                <div className="section-title" style={{ color: "#FF3B30" }}>⚡ Contradictions</div>
                {contradictions.map(c => <ContraCard key={c.id} c={c} />)}
              </>
            )}
            {people.length > 0 && (
              <>
                <div className="section-title">People</div>
                {people.map(e => <EntityCard key={e.id} entity={e} onClick={() => setSelectedEntity(e)} />)}
              </>
            )}
            {orgs.length > 0 && (
              <>
                <div className="section-title">Organizations</div>
                {orgs.map(e => <EntityCard key={e.id} entity={e} onClick={() => setSelectedEntity(e)} />)}
              </>
            )}
            {artifacts.length > 0 && (
              <>
                <div className="section-title">Artifacts</div>
                {artifacts.map(e => <EntityCard key={e.id} entity={e} onClick={() => setSelectedEntity(e)} />)}
              </>
            )}
            {entities.length === 0 && <div className="empty-msg">No entities resolved yet.</div>}
          </div>
        )}

        {/* ── Review Tab ── */}
        {!loading && tab === "review" && (
          <div className="feed-list">
            <div className="section-title">
              Review Queue
              {pendingReview.length > 0 && <span className="review-badge">{pendingReview.length}</span>}
            </div>
            {reviewItems.length === 0 && <div className="empty-msg">No items in the review queue.</div>}
            {reviewItems.map(item => (
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
                      placeholder="Optional note..."
                      value={decidingId === item.id ? reviewNote : ""}
                      onChange={e => { setDecidingId(item.id); setReviewNote(e.target.value); }}
                    />
                    <div className="review-btn-row">
                      {item.requires_approval && (
                        <button className="review-btn approve" onClick={() => handleDecide(item.id, "approved")} disabled={decidingId === item.id}>
                          ✓ Approve
                        </button>
                      )}
                      <button className="review-btn reject" onClick={() => handleDecide(item.id, "rejected")} disabled={decidingId === item.id}>
                        ✕ Reject
                      </button>
                      <button className="review-btn resolve" onClick={() => handleDecide(item.id, "resolved")} disabled={decidingId === item.id}>
                        ◎ Resolve
                      </button>
                      <button className="review-btn defer" onClick={() => handleDecide(item.id, "deferred")} disabled={decidingId === item.id}>
                        ⟳ Defer
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
            ? <WorldDashboard world={worldState} />
            : <div className="feed-list"><div className="empty-msg">Loading world state...</div></div>
        )}
        {/* ── Graph Tab ── */}
        {tab === "graph" && <KnowledgeGraph />}
      </main>

      {/* ── Bottom Nav ── */}
      <nav className="bottom-nav">
        <button className={`nav-item${tab === "feed" ? " active" : ""}`} onClick={() => setTab("feed")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Feed</span>
        </button>
        <button className={`nav-item${tab === "tasks" ? " active" : ""}`} onClick={() => setTab("tasks")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span>Tasks</span>
        </button>
        <button className={`nav-item${tab === "review" ? " active" : ""}`} onClick={() => setTab("review")} style={{ position: "relative" }}>
          {pendingReview.length > 0 && (
            <span style={{ position: "absolute", top: 4, right: 10, background: "#FF3B30", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{pendingReview.length}</span>
          )}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Review</span>
        </button>
        <button className={`nav-item${tab === "entities" ? " active" : ""}`} onClick={() => setTab("entities")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          <span>Entities</span>
        </button>
        <button className={`nav-item${tab === "world" ? " active" : ""}`} onClick={() => setTab("world")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span>World</span>
        </button>
        <button className={`nav-item${tab === "graph" ? " active" : ""}`} onClick={() => setTab("graph")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><line x1="7" y1="12" x2="17" y2="6"/><line x1="7" y1="12" x2="17" y2="18"/></svg>
          <span>Graph</span>
        </button>
      </nav>

      {/* ── Signal Inspector Sheet ── */}
      {selected && (
        <Inspector signal={selected} result={result} onClose={() => { setSelected(null); setResult(null); }} />
      )}

      {/* ── Entity Profile Sheet ── */}
      {selectedEntity && (
        <EntityProfile entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
      )}

      {/* ── Workspace Detail Sheet ── */}
      {selectedWorkspace && (
        <WorkspaceSheet ws={selectedWorkspace} onClose={() => setSelectedWorkspace(null)} />
      )}
    </div>
  );
}
