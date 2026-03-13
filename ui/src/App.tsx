import { useState, useEffect, useCallback } from "react";
import "./App.css";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API = "/api";
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}
function priorityColor(p: string) {
  return p === "critical" ? "#ef4444" : p === "high" ? "#f97316" : p === "medium" ? "#eab308" : "#6b7280";
}
function riskColor(r: string) {
  return r === "high" || r === "critical" ? "#ef4444" : r === "medium" ? "#f97316" : "#22c55e";
}
function domainIcon(d: string) {
  return d === "person" ? "👤" : d === "organization" ? "🏢" : d === "artifact" ? "📄" : "◆";
}

// ─── Components ───────────────────────────────────────────────────────────────

function SummaryBar({ summary }: { summary: Summary }) {
  const items: [string, number, boolean][] = [
    ["Signals", summary.signals, false],
    ["Entities", summary.entities, false],
    ["Open Obligations", summary.open_obligations, true],
    ["State Updates", summary.state_updates, false],
    ["Contradictions", summary.unresolved_contradictions, false],
  ];
  return (
    <div className="summary-bar">
      {items.map(([label, value, highlight]) => (
        <div key={label} className={`summary-item${highlight ? " highlight" : ""}`}>
          <span className="summary-value" style={label === "Contradictions" && value > 0 ? { color: "#ef4444" } : {}}>
            {value}
          </span>
          <span className="summary-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function LayerView({ result }: { result: ProcessingResult }) {
  const [open, setOpen] = useState<number | null>(1);
  const toggle = (n: number) => setOpen(open === n ? null : n);

  return (
    <div className="layer-view">
      {/* Layer 1 */}
      <div className="layer">
        <button className="layer-header" onClick={() => toggle(1)}>
          <span className="layer-badge l1">L1</span>
          <span className="layer-title">Raw Truth</span>
          <span className="layer-count">{result.layer_1.raw_facts.length} facts</span>
          <span className="layer-chevron">{open === 1 ? "▲" : "▼"}</span>
        </button>
        {open === 1 && (
          <div className="layer-body">
            {result.layer_1.is_noise
              ? <p className="noise-reason">Noise: {result.layer_1.noise_reason}</p>
              : <ul className="fact-list">
                  {result.layer_1.raw_facts.map((f, i) => (
                    <li key={i}><span className="fact-text">{f.fact}</span><span className="fact-ref">{f.source_ref}</span></li>
                  ))}
                </ul>
            }
          </div>
        )}
      </div>

      {/* Layer 2 */}
      <div className="layer">
        <button className="layer-header" onClick={() => toggle(2)}>
          <span className="layer-badge l2">L2</span>
          <span className="layer-title">Entity Linking</span>
          <span className="layer-count">{result.layer_2.entity_candidates.length} entities</span>
          <span className="layer-chevron">{open === 2 ? "▲" : "▼"}</span>
        </button>
        {open === 2 && (
          <div className="layer-body">
            {result.layer_2.entity_candidates.length === 0
              ? <p className="empty-note">No entities identified.</p>
              : <div className="entity-chips">
                  {result.layer_2.entity_candidates.map((e, i) => (
                    <span key={i} className="entity-chip">
                      {domainIcon(e.domain)} {e.label}
                      {e.email && <span className="entity-email"> · {e.email}</span>}
                    </span>
                  ))}
                </div>
            }
          </div>
        )}
      </div>

      {/* Layer 3 */}
      <div className="layer">
        <button className="layer-header" onClick={() => toggle(3)}>
          <span className="layer-badge l3">L3</span>
          <span className="layer-title">State Check</span>
          <span className="layer-count">{result.layer_3.state_updates.length} updates</span>
          <span className="layer-chevron">{open === 3 ? "▲" : "▼"}</span>
        </button>
        {open === 3 && (
          <div className="layer-body">
            {result.layer_3.state_updates.length === 0
              ? <p className="empty-note">No state changes.</p>
              : <table className="state-table">
                  <thead><tr><th>Entity</th><th>Field</th><th>New Value</th></tr></thead>
                  <tbody>
                    {result.layer_3.state_updates.map((u, i) => (
                      <tr key={i}>
                        <td>{domainIcon(u.entity_domain)} {u.entity_label}</td>
                        <td><code>{u.field}</code></td>
                        <td><strong>{u.new_value}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        )}
      </div>

      {/* Layer 4 */}
      <div className="layer">
        <button className="layer-header" onClick={() => toggle(4)}>
          <span className="layer-badge l4">L4</span>
          <span className="layer-title">Obligations</span>
          <span className="layer-count">{result.layer_4.new_obligations.length} new</span>
          <span className="layer-chevron">{open === 4 ? "▲" : "▼"}</span>
        </button>
        {open === 4 && (
          <div className="layer-body">
            {result.layer_4.new_obligations.length === 0
              ? <p className="empty-note">No new obligations.</p>
              : result.layer_4.new_obligations.map((o, i) => (
                  <div key={i} className="obligation-card">
                    <div className="obligation-title">
                      <span className="priority-dot" style={{ background: priorityColor(o.priority) }} />
                      {o.title}
                    </div>
                    <div className="obligation-meta">{o.owed_by} &rarr; {o.owed_to}{o.due_hint ? ` · Due: ${o.due_hint}` : ""}</div>
                    <div className="obligation-desc">{o.description}</div>
                  </div>
                ))
            }
          </div>
        )}
      </div>

      {/* Layer 5 */}
      <div className="layer">
        <button className="layer-header" onClick={() => toggle(5)}>
          <span className="layer-badge l5">L5</span>
          <span className="layer-title">Inferences</span>
          <span className="layer-count">{result.layer_5.inferences.length + result.layer_5.risk_flags.length} items</span>
          <span className="layer-chevron">{open === 5 ? "▲" : "▼"}</span>
        </button>
        {open === 5 && (
          <div className="layer-body">
            {result.layer_5.risk_flags.map((r, i) => (
              <div key={i} className="risk-flag" style={{ borderColor: riskColor(r.severity) }}>
                <span className="risk-icon">&#9873;</span> {r.flag}
                <span className="risk-severity" style={{ color: riskColor(r.severity) }}>{r.severity}</span>
              </div>
            ))}
            {result.layer_5.inferences.map((inf, i) => (
              <div key={i} className="inference-item">
                <span className="inference-conf">{Math.round(inf.confidence * 100)}%</span>
                <span className="inference-text">{inf.statement}</span>
              </div>
            ))}
            {result.layer_5.inferences.length === 0 && result.layer_5.risk_flags.length === 0 && (
              <p className="empty-note">No inferences.</p>
            )}
          </div>
        )}
      </div>

      {/* Layer 6 */}
      <div className="layer">
        <button className="layer-header" onClick={() => toggle(6)}>
          <span className="layer-badge l6">L6</span>
          <span className="layer-title">Proposed Actions</span>
          <span className="layer-count">{result.layer_6.proposed_actions.length} actions &middot; {Math.round(result.layer_6.confidence * 100)}% conf</span>
          <span className="layer-chevron">{open === 6 ? "▲" : "▼"}</span>
        </button>
        {open === 6 && (
          <div className="layer-body">
            {result.layer_6.proposed_actions.length === 0
              ? <p className="empty-note">No actions proposed.</p>
              : result.layer_6.proposed_actions.map((a, i) => (
                  <div key={i} className="action-card">
                    <div className="action-header">
                      <span className="action-rank">#{a.rank}</span>
                      <span className="action-kind">{a.kind.replace(/_/g, " ")}</span>
                      <span className="action-risk" style={{ color: riskColor(a.risk) }}>{a.risk}</span>
                      {a.requires_approval && <span className="approval-badge">Needs Approval</span>}
                    </div>
                    <div className="action-desc">{a.description}</div>
                    <div className="action-rationale">{a.rationale}</div>
                  </div>
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

function SignalCard({ signal, isSelected, onClick }: { signal: Signal; isSelected: boolean; onClick: () => void }) {
  return (
    <div className={`signal-card${isSelected ? " selected" : ""}`} onClick={onClick}>
      <div className="signal-source">
        <span className="source-badge">{signal.source}</span>
        <span className="signal-time">{timeAgo(signal.received_at)}</span>
      </div>
      <div className="signal-subject">{signal.metadata?.subject ?? signal.raw_content.slice(0, 60)}</div>
      <div className="signal-from">{signal.metadata?.from}</div>
    </div>
  );
}

function ObligationsPanel({ obligations }: { obligations: Obligation[] }) {
  const open = obligations.filter(o => o.status === "open");
  return (
    <div className="obligations-panel">
      <h3 className="panel-title">Open Obligations <span className="panel-count">{open.length}</span></h3>
      {open.length === 0
        ? <p className="empty-note">No open obligations.</p>
        : open.map(o => (
            <div key={o.id} className="obl-item">
              <div className="obl-header">
                <span className="priority-dot" style={{ background: priorityColor(o.priority) }} />
                <span className="obl-title">{o.title}</span>
              </div>
              <div className="obl-meta">
                {o.owed_by} &rarr; {o.owed_to}
                {o.due_hint && <span className="obl-due"> &middot; {o.due_hint}</span>}
              </div>
            </div>
          ))
      }
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [processingResult, setProcessingResult] = useState<ProcessingResult | null>(null);
  const [loadingResult, setLoadingResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [s, sigs, obls] = await Promise.all([
        fetchJson<Summary>(`${API}/summary`),
        fetchJson<Signal[]>(`${API}/signals`),
        fetchJson<Obligation[]>(`${API}/obligations`),
      ]);
      setSummary(s); setSignals(sigs); setObligations(obls);
    } catch {
      setError("Failed to connect to Axiom API. Is the server running?");
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => void loadData(), 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleSelectSignal = async (signal: Signal) => {
    setSelectedSignal(signal);
    setProcessingResult(null);
    setLoadingResult(true);
    try {
      setProcessingResult(await fetchJson<ProcessingResult>(`${API}/signals/${signal.id}/result`));
    } catch {
      setProcessingResult(null);
    } finally {
      setLoadingResult(false);
    }
  };

  if (error) {
    return (
      <div className="error-screen">
        <div className="error-box">
          <h2>Connection Error</h2>
          <p>{error}</p>
          <button onClick={() => { setError(null); void loadData(); }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">&#9672;</span>
          <span className="brand-name">Axiom</span>
          <span className="brand-sub">World State</span>
        </div>
        {summary && <SummaryBar summary={summary} />}
        <div className="header-status">
          <span className="status-dot" />
          <span className="status-text">Live</span>
        </div>
      </header>

      <div className="main-layout">
        <aside className="signal-feed">
          <div className="feed-header">
            <h2>Signal Feed</h2>
            <span className="feed-count">{signals.length}</span>
          </div>
          <div className="feed-list">
            {signals.map(s => (
              <SignalCard
                key={s.id}
                signal={s}
                isSelected={selectedSignal?.id === s.id}
                onClick={() => void handleSelectSignal(s)}
              />
            ))}
          </div>
        </aside>

        <main className="inspector">
          {!selectedSignal ? (
            <div className="inspector-empty">
              <span className="inspector-empty-icon">&#9672;</span>
              <p>Select a signal to inspect its six-layer analysis</p>
            </div>
          ) : (
            <div className="inspector-content">
              <div className="inspector-header">
                <div className="inspector-signal-meta">
                  <span className="source-badge">{selectedSignal.source}</span>
                  <span className="inspector-time">{new Date(selectedSignal.received_at).toLocaleString()}</span>
                  {processingResult?.is_noise && <span className="noise-badge">NOISE</span>}
                </div>
                <h2 className="inspector-subject">{selectedSignal.metadata?.subject ?? "Signal"}</h2>
                <div className="inspector-from">{selectedSignal.metadata?.from}</div>
              </div>
              <div className="raw-content">
                <div className="raw-label">Raw Content</div>
                <pre className="raw-text">{selectedSignal.raw_content}</pre>
              </div>
              {loadingResult
                ? <div className="loading-layers"><div className="spinner" /><span>Loading analysis...</span></div>
                : processingResult
                  ? <LayerView result={processingResult} />
                  : <div className="no-result">No processing result available.</div>
              }
            </div>
          )}
        </main>

        <aside className="right-panel">
          <ObligationsPanel obligations={obligations} />
        </aside>
      </div>
    </div>
  );
}
