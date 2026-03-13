import { useState, useEffect } from "react";
import "./App.css";

interface Signal {
  id: string; source: string; raw_content: string;
  metadata: { from: string; subject: string; date: string; thread_id: string };
  received_at: string; processed: boolean; adapter: string;
}
interface Fact { fact: string; source_ref: string }
interface EntityCandidate { label: string; domain: string; likely_existing: boolean; lookup_key: string; email?: string }
interface StateUpdate { entity_label: string; entity_domain: string; field: string; new_value: string; source_fact: string }
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
interface Summary {
  signals: number; entities: number; open_obligations: number; total_obligations: number;
  state_updates: number; unresolved_contradictions: number; audit_entries: number;
}

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

function Avatar({ from, size = 44 }: { from: string; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size, minWidth: size, background: getAvatarColor(from), fontSize: Math.round(size * 0.36) }}>
      {getInitials(from)}
    </div>
  );
}

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

type Tab = "feed" | "tasks" | "entities" | "world";

export default function App() {
  const [tab, setTab] = useState<Tab>("feed");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Signal | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/signals").then(r => r.json()),
      fetch("/api/obligations").then(r => r.json()),
      fetch("/api/summary").then(r => r.json()),
    ]).then(([s, o, sum]) => {
      setSignals(s); setObligations(o); setSummary(sum); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSelect = async (sig: Signal) => {
    setSelected(sig);
    try {
      const r = await fetch(`/api/signals/${sig.id}/result`);
      setResult(r.ok ? await r.json() : null);
    } catch { setResult(null); }
  };

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
        {!loading && tab === "feed" && (
          <div className="feed-list">
            <div className="section-title">Signal Feed</div>
            {signals.length === 0 && <div className="empty-msg">No signals yet. Connect Gmail to get started.</div>}
            {signals.map(sig => (
              <SignalCard key={sig.id} signal={sig} isSelected={selected?.id === sig.id} onClick={() => handleSelect(sig)} />
            ))}
          </div>
        )}
        {!loading && tab === "tasks" && (
          <div className="feed-list">
            <div className="section-title">Open Obligations</div>
            {obligations.length === 0 && <div className="empty-msg">No open obligations.</div>}
            {obligations.map(ob => <ObCard key={ob.id} ob={ob} />)}
          </div>
        )}
        {!loading && tab === "entities" && (
          <div className="feed-list">
            <div className="section-title">Entities</div>
            <div className="coming-soon"><div className="cs-icon">🕸️</div><div>Entity graph — Phase 10</div></div>
          </div>
        )}
        {!loading && tab === "world" && (
          <div className="feed-list">
            <div className="section-title">World State</div>
            <div className="coming-soon"><div className="cs-icon">🌐</div><div>World state dashboard — Phase 9</div></div>
          </div>
        )}
      </main>

      <nav className="bottom-nav">
        <button className={`nav-item${tab === "feed" ? " active" : ""}`} onClick={() => setTab("feed")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Feed</span>
        </button>
        <button className={`nav-item${tab === "tasks" ? " active" : ""}`} onClick={() => setTab("tasks")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span>Tasks</span>
        </button>
        <button className="nav-item compose">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button className={`nav-item${tab === "entities" ? " active" : ""}`} onClick={() => setTab("entities")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          <span>Entities</span>
        </button>
        <button className={`nav-item${tab === "world" ? " active" : ""}`} onClick={() => setTab("world")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span>World</span>
        </button>
      </nav>

      {selected && (
        <Inspector signal={selected} result={result} onClose={() => { setSelected(null); setResult(null); }} />
      )}
    </div>
  );
}
