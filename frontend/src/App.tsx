// ============================================================
// OpenClaw Dashboard — Main App
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import api from "./lib/api";
import { useGateway, type GatewayStatus, type GatewayEvent } from "./hooks/useGateway";

// ── Types ─────────────────────────────────────────────────
export type JobStatus = "backlog" | "queued" | "running" | "done" | "failed";
export type JobPriority = "low" | "medium" | "high" | "critical";

export interface Job {
  id: string;
  title: string;
  description: string;
  status: JobStatus;
  priority: JobPriority;
  agent: string;
  createdAt: string;
  updatedAt: string;
  channel?: string;
  estimatedTokens?: number;
  result?: string;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  scope: "identity" | "soul" | "user" | "conversation";
  updatedAt: string;
}

export interface SessionEntry {
  id: string;
  channel: string;
  sender: string;
  agent: string;
  status: "active" | "idle" | "completed";
  messages: number;
  tokens: number;
  startedAt: string;
  lastActivity: string;
}

// ── Login Screen ──────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.auth.login(secret);
      onLogin();
    } catch (err: any) {
      setError(err.message || "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="oc-login">
      <div className="oc-login-card">
        <div className="oc-login-logo">🦞</div>
        <h1 className="oc-login-title">OpenClaw Dashboard</h1>
        <p className="oc-login-subtitle">Gateway Management Interface</p>
        <form onSubmit={handleSubmit} className="oc-login-form">
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Dashboard Secret"
            className="oc-login-input"
            autoFocus
            disabled={loading}
          />
          {error && <div className="oc-login-error">{error}</div>}
          <button type="submit" className="oc-login-btn" disabled={loading || !secret}>
            {loading ? "Verbinde..." : "Anmelden"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Kanban Lane Config ────────────────────────────────────
const LANES: { key: JobStatus; label: string; color: string; icon: string }[] = [
  { key: "backlog", label: "Backlog", color: "#64748b", icon: "📋" },
  { key: "queued", label: "Warteschlange", color: "#f59e0b", icon: "⏳" },
  { key: "running", label: "Ausführung", color: "#3b82f6", icon: "⚡" },
  { key: "done", label: "Erledigt", color: "#22c55e", icon: "✅" },
  { key: "failed", label: "Fehlgeschlagen", color: "#ef4444", icon: "❌" },
];

const PRIO: Record<JobPriority, { label: string; color: string; bg: string }> = {
  low: { label: "Niedrig", color: "#94a3b8", bg: "rgba(148,163,184,0.15)" },
  medium: { label: "Mittel", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  high: { label: "Hoch", color: "#f97316", bg: "rgba(249,115,22,0.15)" },
  critical: { label: "Kritisch", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
};

const SCOPE_CFG: Record<string, { label: string; color: string; bg: string; icon: string; desc: string }> = {
  identity: { label: "Identity", color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", icon: "🪪", desc: "Name, Rolle, Avatar" },
  soul: { label: "Soul", color: "#ec4899", bg: "rgba(236,72,153,0.12)", icon: "💫", desc: "Verhalten, Sprache" },
  user: { label: "User", color: "#06b6d4", bg: "rgba(6,182,212,0.12)", icon: "👤", desc: "Benutzer-Info" },
  conversation: { label: "Conversation", color: "#84cc16", bg: "rgba(132,204,22,0.12)", icon: "💬", desc: "Chat-Kontext" },
};

function timeAgo(d: string): string {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h}h`;
  return `vor ${Math.floor(h / 24)}d`;
}

// ── Kanban Board ──────────────────────────────────────────
function KanbanBoard({ jobs, onMove, onAdd, onDelete }: {
  jobs: Job[];
  onMove: (id: string, s: JobStatus) => void;
  onAdd: (j: Omit<Job, "id" | "createdAt" | "updatedAt">) => void;
  onDelete: (id: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", priority: "medium" as JobPriority, status: "backlog" as JobStatus });

  const handleAdd = () => {
    if (!form.title.trim()) return;
    onAdd({ ...form, agent: "AJBot" });
    setForm({ title: "", description: "", priority: "medium", status: "backlog" });
    setShowAdd(false);
  };

  return (
    <div className="oc-kanban">
      <div className="oc-section-header">
        <h2 className="oc-view-title">Job Board</h2>
        <button className="oc-btn-primary" onClick={() => setShowAdd(!showAdd)}>+ Neuer Job</button>
      </div>
      {showAdd && (
        <div className="oc-add-panel">
          <input className="oc-input" placeholder="Job-Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
          <textarea className="oc-input oc-textarea" placeholder="Beschreibung" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <div className="oc-add-row">
            <select className="oc-input oc-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as JobPriority })}>
              <option value="low">Niedrig</option><option value="medium">Mittel</option><option value="high">Hoch</option><option value="critical">Kritisch</option>
            </select>
            <select className="oc-input oc-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as JobStatus })}>
              {LANES.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}
            </select>
            <button className="oc-btn-primary" onClick={handleAdd} disabled={!form.title.trim()}>Erstellen</button>
            <button className="oc-btn-ghost" onClick={() => setShowAdd(false)}>Abbrechen</button>
          </div>
        </div>
      )}
      <div className="oc-lanes">
        {LANES.map((lane) => {
          const lj = jobs.filter((j) => j.status === lane.key);
          return (
            <div key={lane.key} className="oc-lane">
              <div className="oc-lane-head" style={{ borderBottomColor: lane.color }}>
                <span>{lane.icon}</span>
                <span className="oc-lane-label">{lane.label}</span>
                <span className="oc-lane-count" style={{ background: lane.color }}>{lj.length}</span>
              </div>
              <div className="oc-lane-body">
                {lj.length === 0 && <div className="oc-empty">Keine Jobs</div>}
                {lj.map((job) => (
                  <div key={job.id} className="oc-card" onClick={() => setExpanded(expanded === job.id ? null : job.id)}>
                    <div className="oc-card-top">
                      <span className="oc-card-title">{job.title}</span>
                      <span className="oc-prio" style={{ color: PRIO[job.priority].color, background: PRIO[job.priority].bg }}>{PRIO[job.priority].label}</span>
                    </div>
                    <p className="oc-card-desc">{job.description}</p>
                    <div className="oc-card-meta">
                      {job.channel && <span className="oc-tag">{job.channel}</span>}
                      {job.estimatedTokens && <span className="oc-tok">~{(job.estimatedTokens / 1000).toFixed(1)}k</span>}
                      <span className="oc-time">{timeAgo(job.updatedAt)}</span>
                    </div>
                    {job.result && <div className={`oc-result ${job.status === "failed" ? "oc-result--err" : ""}`}>{job.result}</div>}
                    {expanded === job.id && (
                      <div className="oc-card-actions" onClick={(e) => e.stopPropagation()}>
                        <div className="oc-move-btns">
                          {LANES.filter((l) => l.key !== job.status).map((l) => (
                            <button key={l.key} className="oc-move-btn" style={{ borderColor: l.color, color: l.color }} onClick={() => onMove(job.id, l.key)}>{l.icon} {l.label}</button>
                          ))}
                        </div>
                        <button className="oc-del-btn" onClick={() => onDelete(job.id)}>Löschen</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Memory Editor ─────────────────────────────────────────
function MemoryEditor({ entries, onUpdate, onAdd, onDelete }: {
  entries: MemoryEntry[];
  onUpdate: (id: string, val: string) => void;
  onAdd: (e: Omit<MemoryEntry, "id" | "updatedAt">) => void;
  onDelete: (id: string) => void;
}) {
  const [scope, setScope] = useState<string>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ key: "", value: "", scope: "identity" as MemoryEntry["scope"] });

  const filtered = scope === "all" ? entries : entries.filter((e) => e.scope === scope);

  return (
    <div>
      <div className="oc-section-header">
        <h2 className="oc-view-title">Memory & Identity</h2>
        <button className="oc-btn-primary" onClick={() => setShowAdd(!showAdd)}>+ Eintrag</button>
      </div>
      {showAdd && (
        <div className="oc-add-panel">
          <div className="oc-add-row">
            <input className="oc-input" placeholder="Schlüssel" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} style={{ flex: 1 }} />
            <select className="oc-input oc-select" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as any })} style={{ width: 140 }}>
              {Object.entries(SCOPE_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <textarea className="oc-input oc-textarea" placeholder="Wert" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} rows={2} />
          <div className="oc-add-row">
            <button className="oc-btn-primary" onClick={() => { if (form.key && form.value) { onAdd(form); setForm({ key: "", value: "", scope: "identity" }); setShowAdd(false); } }} disabled={!form.key || !form.value}>Erstellen</button>
            <button className="oc-btn-ghost" onClick={() => setShowAdd(false)}>Abbrechen</button>
          </div>
        </div>
      )}
      <div className="oc-scope-bar">
        {Object.entries(SCOPE_CFG).map(([k, v]) => {
          const c = entries.filter((e) => e.scope === k).length;
          return (
            <button key={k} className={`oc-scope-btn ${scope === k ? "oc-scope-btn--active" : ""}`} style={scope === k ? { borderColor: v.color, color: v.color } : {}} onClick={() => setScope(scope === k ? "all" : k)}>
              {v.icon} {v.label} <span className="oc-scope-count" style={{ background: v.bg, color: v.color }}>{c}</span>
            </button>
          );
        })}
      </div>
      <div className="oc-mem-grid">
        {filtered.map((entry) => {
          const s = SCOPE_CFG[entry.scope];
          return (
            <div key={entry.id} className="oc-mem-card">
              <div className="oc-mem-top">
                <code className="oc-mem-key">{entry.key}</code>
                <span className="oc-mem-scope" style={{ color: s.color, background: s.bg }}>{s.icon} {s.label}</span>
              </div>
              {editing === entry.id ? (
                <div className="oc-mem-edit">
                  <textarea className="oc-input oc-textarea" value={editVal} onChange={(e) => setEditVal(e.target.value)} rows={2} autoFocus />
                  <div className="oc-add-row">
                    <button className="oc-btn-primary" onClick={() => { onUpdate(entry.id, editVal); setEditing(null); }}>Speichern</button>
                    <button className="oc-btn-ghost" onClick={() => setEditing(null)}>Abbrechen</button>
                  </div>
                </div>
              ) : (
                <div className="oc-mem-val" onClick={() => { setEditing(entry.id); setEditVal(entry.value); }}>{entry.value}</div>
              )}
              <div className="oc-mem-foot">
                <span className="oc-time">{new Date(entry.updatedAt).toLocaleString("de-AT")}</span>
                <div className="oc-mem-btns">
                  {editing !== entry.id && <button className="oc-icon-btn" onClick={() => { setEditing(entry.id); setEditVal(entry.value); }}>✏️</button>}
                  <button className="oc-icon-btn" onClick={() => onDelete(entry.id)}>🗑️</button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="oc-empty" style={{ gridColumn: "1/-1" }}>Keine Einträge</div>}
      </div>
    </div>
  );
}

// ── Session Monitor ───────────────────────────────────────
function SessionMonitor({ sessions, events }: { sessions: SessionEntry[]; events: GatewayEvent[] }) {
  const total = sessions.reduce((s, x) => s + x.tokens, 0);
  const msgs = sessions.reduce((s, x) => s + x.messages, 0);
  const active = sessions.filter((s) => s.status === "active").length;
  const CH: Record<string, { icon: string; color: string }> = {
    whatsapp: { icon: "📱", color: "#25D366" }, telegram: { icon: "✈️", color: "#0088cc" },
    webchat: { icon: "🌐", color: "#6366f1" }, discord: { icon: "🎮", color: "#5865F2" },
    slack: { icon: "💼", color: "#4A154B" }, signal: { icon: "🔒", color: "#3A76F0" },
  };
  const ST: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: "Aktiv", color: "#22c55e", bg: "rgba(34,197,94,0.15)" },
    idle: { label: "Idle", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
    completed: { label: "Beendet", color: "#64748b", bg: "rgba(100,116,139,0.15)" },
  };

  return (
    <div>
      <div className="oc-section-header">
        <h2 className="oc-view-title">Live Sessions</h2>
        <span className="oc-live-badge"><span className="oc-pulse" /> {active} aktiv</span>
      </div>
      <div className="oc-stats-row">
        <div className="oc-stat-card"><span className="oc-stat-icon">💬</span><div><span className="oc-stat-num">{msgs}</span><span className="oc-stat-lbl">Nachrichten</span></div></div>
        <div className="oc-stat-card"><span className="oc-stat-icon">🪙</span><div><span className="oc-stat-num">{(total / 1000).toFixed(1)}k</span><span className="oc-stat-lbl">Tokens</span></div></div>
        <div className="oc-stat-card"><span className="oc-stat-icon">📡</span><div><span className="oc-stat-num">{new Set(sessions.map((s) => s.channel)).size}</span><span className="oc-stat-lbl">Kanäle</span></div></div>
        <div className="oc-stat-card"><span className="oc-stat-icon">🤖</span><div><span className="oc-stat-num">{sessions.length}</span><span className="oc-stat-lbl">Sessions</span></div></div>
      </div>
      <div className="oc-session-list">
        {sessions.sort((a, b) => ({ active: 0, idle: 1, completed: 2 }[a.status] ?? 3) - ({ active: 0, idle: 1, completed: 2 }[b.status] ?? 3)).map((s) => {
          const ch = CH[s.channel] || { icon: "📨", color: "#888" };
          const st = ST[s.status];
          const pct = Math.min((s.tokens / 20000) * 100, 100);
          return (
            <div key={s.id} className={`oc-sess-card ${s.status === "active" ? "oc-sess-card--active" : ""}`}>
              <span className="oc-sess-ch" style={{ background: ch.color + "22", color: ch.color }}>{ch.icon}</span>
              <div className="oc-sess-info">
                <div className="oc-sess-row1"><span className="oc-sess-sender">{s.sender}</span><span className="oc-sess-status" style={{ color: st.color, background: st.bg }}>{s.status === "active" && <span className="oc-pulse-sm" />}{st.label}</span></div>
                <div className="oc-sess-row2"><span>{s.channel}</span><span>•</span><span>{s.messages} msg</span><span>•</span><span>{(s.tokens / 1000).toFixed(1)}k tok</span></div>
              </div>
              <div className="oc-sess-bar-wrap"><div className="oc-sess-bar"><div className="oc-sess-fill" style={{ width: `${pct}%`, background: pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e" }} /></div></div>
            </div>
          );
        })}
      </div>
      <div className="oc-log-box">
        <h3 className="oc-log-head">Event Log</h3>
        <div className="oc-log-scroll">
          {events.slice(0, 50).map((ev, i) => (
            <div key={i} className={`oc-log-row oc-log-row--${ev.level || "info"}`}>
              <span className="oc-log-ts">{new Date(ev.timestamp || Date.now()).toLocaleTimeString("de-AT")}</span>
              <span className={`oc-log-lvl oc-log-lvl--${ev.level || "info"}`}>{ev.level || ev.type?.split(":")[0] || "info"}</span>
              <span className="oc-log-msg">{ev.message || ev.type || JSON.stringify(ev).slice(0, 120)}</span>
            </div>
          ))}
          {events.length === 0 && <div className="oc-empty">Warte auf Events...</div>}
        </div>
      </div>
    </div>
  );
}

// ── Config Editor ─────────────────────────────────────────
function ConfigEditor({ config, onSave }: { config: any; onSave: (c: any) => void }) {
  const [json, setJson] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState("agents");

  const SECTS = [
    { key: "agents", label: "Agents", icon: "🤖" },
    { key: "channels", label: "Channels", icon: "📡" },
    { key: "gateway", label: "Gateway", icon: "🌐" },
    { key: "messages", label: "Messages", icon: "💬" },
    { key: "commands", label: "Commands", icon: "⌨️" },
    { key: "plugins", label: "Plugins", icon: "🔌" },
  ];

  const openJson = () => { setJson(JSON.stringify(config, null, 2)); setJsonMode(true); setError(""); };
  const saveJson = () => { try { onSave(JSON.parse(json)); setError(""); } catch (e: any) { setError(e.message); } };

  const renderSection = (data: any, path: string[] = []) => {
    if (!data || typeof data !== "object") return <span className="oc-cfg-val">{String(data)}</span>;
    return Object.entries(data).map(([k, v]) => (
      <div key={k} className="oc-cfg-field">
        <span className="oc-cfg-key">{k}</span>
        {typeof v === "object" && v !== null && !Array.isArray(v) ? (
          <div className="oc-cfg-nested">{renderSection(v, [...path, k])}</div>
        ) : Array.isArray(v) ? (
          <div className="oc-cfg-list">{v.map((item, i) => <code key={i} className="oc-cfg-list-item">{String(item)}</code>)}</div>
        ) : typeof v === "boolean" ? (
          <span className={`oc-cfg-bool ${v ? "oc-cfg-bool--true" : ""}`}>{v ? "true" : "false"}</span>
        ) : (
          <span className="oc-cfg-val">{String(v)}</span>
        )}
      </div>
    ));
  };

  return (
    <div>
      <div className="oc-section-header">
        <h2 className="oc-view-title">Konfiguration</h2>
        <div className="oc-mode-toggle">
          <button className={`oc-mode-btn ${!jsonMode ? "oc-mode-btn--on" : ""}`} onClick={() => setJsonMode(false)}>Visuell</button>
          <button className={`oc-mode-btn ${jsonMode ? "oc-mode-btn--on" : ""}`} onClick={openJson}>JSON</button>
        </div>
      </div>
      {jsonMode ? (
        <div className="oc-json-editor">
          <div className="oc-json-bar"><span className="oc-json-path">openclaw.json</span>{error && <span className="oc-json-err">{error}</span>}<button className="oc-btn-primary" onClick={saveJson}>Speichern</button></div>
          <textarea className="oc-json-area" value={json} onChange={(e) => setJson(e.target.value)} rows={28} spellCheck={false} />
        </div>
      ) : (
        <div className="oc-cfg-layout">
          <div className="oc-cfg-nav">
            {SECTS.map((s) => (
              <button key={s.key} className={`oc-cfg-nav-btn ${section === s.key ? "oc-cfg-nav-btn--on" : ""}`} onClick={() => setSection(s.key)}>
                <span>{s.icon}</span><span>{s.label}</span>
              </button>
            ))}
          </div>
          <div className="oc-cfg-content">{config[section] ? renderSection(config[section]) : <div className="oc-empty">Keine Daten</div>}</div>
        </div>
      )}
    </div>
  );
}

// ── Demo Data ─────────────────────────────────────────────
const DEMO_JOBS: Job[] = [
  { id: "j1", title: "Täglicher News-Digest", description: "Tech-News sammeln und zusammenfassen", status: "done", priority: "medium", agent: "AJBot", createdAt: "2026-02-13T06:00:00Z", updatedAt: "2026-02-13T06:12:00Z", channel: "whatsapp", estimatedTokens: 4200, result: "12 Artikel zusammengefasst" },
  { id: "j2", title: "Backup-Status prüfen", description: "Coolify Container Backups überprüfen", status: "running", priority: "high", agent: "AJBot", createdAt: "2026-02-13T08:00:00Z", updatedAt: "2026-02-13T08:02:00Z", channel: "whatsapp", estimatedTokens: 1800 },
  { id: "j3", title: "KDS Demo vorbereiten", description: "Demo-Daten für Kitchen Display System erstellen", status: "queued", priority: "high", agent: "AJBot", createdAt: "2026-02-13T09:00:00Z", updatedAt: "2026-02-13T09:00:00Z", estimatedTokens: 6000 },
  { id: "j4", title: "n8n Workflow-Check", description: "Aktive n8n Workflows auf Fehler testen", status: "backlog", priority: "medium", agent: "AJBot", createdAt: "2026-02-12T14:00:00Z", updatedAt: "2026-02-12T14:00:00Z", estimatedTokens: 3200 },
  { id: "j5", title: "SSL Zertifikate erneuern", description: "Ablaufende SSL Zertifikate prüfen", status: "backlog", priority: "critical", agent: "AJBot", createdAt: "2026-02-12T10:00:00Z", updatedAt: "2026-02-12T10:00:00Z", estimatedTokens: 800 },
  { id: "j6", title: "M365 Lizenzen auswerten", description: "Überblick M365 Lizenzen erstellen", status: "failed", priority: "medium", agent: "AJBot", createdAt: "2026-02-12T16:00:00Z", updatedAt: "2026-02-12T16:05:00Z", estimatedTokens: 5000, result: "M365 API Token abgelaufen" },
];
const DEMO_MEM: MemoryEntry[] = [
  { id: "m1", key: "name", value: "AJBot", scope: "identity", updatedAt: "2026-02-04T12:00:00Z" },
  { id: "m2", key: "role", value: "Persönlicher AI-Assistent für vbdata IT-Services", scope: "identity", updatedAt: "2026-02-04T12:00:00Z" },
  { id: "m3", key: "vibe", value: "Professionell, hilfsbereit, technisch versiert", scope: "soul", updatedAt: "2026-02-04T12:00:00Z" },
  { id: "m4", key: "owner", value: "Jürgen", scope: "user", updatedAt: "2026-02-04T12:00:00Z" },
  { id: "m5", key: "company", value: "vbdata IT-Services", scope: "user", updatedAt: "2026-02-04T12:00:00Z" },
  { id: "m6", key: "language", value: "Deutsch (primär), Englisch (technisch)", scope: "soul", updatedAt: "2026-02-04T12:00:00Z" },
];
const DEMO_SESS: SessionEntry[] = [
  { id: "s1", channel: "whatsapp", sender: "+43 XXX", agent: "AJBot", status: "active", messages: 14, tokens: 8420, startedAt: "2026-02-13T07:45:00Z", lastActivity: "2026-02-13T08:12:00Z" },
  { id: "s2", channel: "webchat", sender: "Control UI", agent: "AJBot", status: "active", messages: 3, tokens: 1200, startedAt: "2026-02-13T08:00:00Z", lastActivity: "2026-02-13T08:05:00Z" },
  { id: "s3", channel: "whatsapp", sender: "+43 YYY", agent: "AJBot", status: "idle", messages: 8, tokens: 3100, startedAt: "2026-02-12T14:00:00Z", lastActivity: "2026-02-12T14:30:00Z" },
];
const DEMO_CFG = {
  agents: { defaults: { compaction: { mode: "safeguard" }, maxConcurrent: 4, subagents: { maxConcurrent: 8 } } },
  channels: { whatsapp: { dmPolicy: "open", allowFrom: ["*"], groupPolicy: "allowlist", mediaMaxMb: 50, debounceMs: 0 } },
  gateway: { mode: "local", bind: "lan", controlUi: { allowInsecureAuth: true }, trustedProxies: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"] },
  messages: { ackReactionScope: "group-mentions" },
  commands: { native: "auto", nativeSkills: "auto" },
  plugins: { entries: { whatsapp: { enabled: true } } },
};

// ── Main App ──────────────────────────────────────────────
type View = "kanban" | "memory" | "sessions" | "config";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("kanban");
  const [jobs, setJobs] = useState<Job[]>(DEMO_JOBS);
  const [memory, setMemory] = useState<MemoryEntry[]>(DEMO_MEM);
  const [sessions] = useState<SessionEntry[]>(DEMO_SESS);
  const [cfg, setCfg] = useState(DEMO_CFG);
  const [gwStatus, setGwStatus] = useState<GatewayStatus>("disconnected");

  const { status: wsStatus, events: wsEvents, connect: wsConnect } = useGateway({
    autoConnect: authed === true,
    onEvent: (ev) => {
      if (ev.type === "gateway:status") setGwStatus(ev.status);
    },
  });

  // Auth check on mount
  useEffect(() => {
    api.auth.check().then((r) => setAuthed(r.authenticated)).catch(() => setAuthed(false));
    const handler = () => setAuthed(false);
    window.addEventListener("oc:auth:expired", handler);
    return () => window.removeEventListener("oc:auth:expired", handler);
  }, []);

  // Load real data when authenticated
  useEffect(() => {
    if (!authed) return;
    api.config.get().then(setCfg).catch(() => {});
    // Sessions und Memory würden hier auch geladen
  }, [authed]);

  const moveJob = useCallback((id: string, s: JobStatus) => {
    setJobs((p) => p.map((j) => (j.id === id ? { ...j, status: s, updatedAt: new Date().toISOString() } : j)));
  }, []);
  const addJob = useCallback((j: Omit<Job, "id" | "createdAt" | "updatedAt">) => {
    setJobs((p) => [...p, { ...j, id: `j${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
  }, []);
  const delJob = useCallback((id: string) => setJobs((p) => p.filter((j) => j.id !== id)), []);
  const updMem = useCallback((id: string, v: string) => setMemory((p) => p.map((m) => (m.id === id ? { ...m, value: v, updatedAt: new Date().toISOString() } : m))), []);
  const addMem = useCallback((e: Omit<MemoryEntry, "id" | "updatedAt">) => setMemory((p) => [...p, { ...e, id: `m${Date.now()}`, updatedAt: new Date().toISOString() }]), []);
  const delMem = useCallback((id: string) => setMemory((p) => p.filter((m) => m.id !== id)), []);

  if (authed === null) return <div className="oc-loading"><span className="oc-loading-logo">🦞</span></div>;
  if (!authed) return <LoginScreen onLogin={() => { setAuthed(true); wsConnect(); }} />;

  const running = jobs.filter((j) => j.status === "running").length;
  const activeSess = sessions.filter((s) => s.status === "active").length;

  const TABS: { key: View; label: string; icon: string; badge?: number }[] = [
    { key: "kanban", label: "Jobs", icon: "▦", badge: running || undefined },
    { key: "memory", label: "Memory", icon: "◉" },
    { key: "sessions", label: "Sessions", icon: "⚡", badge: activeSess || undefined },
    { key: "config", label: "Config", icon: "⚙" },
  ];

  return (
    <div className="oc-app">
      <header className="oc-header">
        <div className="oc-header-l">
          <span className="oc-logo">🦞</span>
          <h1 className="oc-brand">OpenClaw Dashboard</h1>
          <span className={`oc-conn oc-conn--${wsStatus}`}><span className="oc-conn-dot" />{wsStatus === "connected" ? "Gateway verbunden" : wsStatus === "connecting" ? "Verbinde..." : "Getrennt"}</span>
        </div>
        <div className="oc-header-r">
          <div className="oc-hstat"><span className="oc-hstat-v">{running}</span><span className="oc-hstat-l">laufend</span></div>
          <div className="oc-hstat"><span className="oc-hstat-v">{activeSess}</span><span className="oc-hstat-l">Sessions</span></div>
          <button className="oc-logout" onClick={() => { api.auth.logout(); setAuthed(false); }}>Abmelden</button>
        </div>
      </header>
      <nav className="oc-nav">
        {TABS.map((t) => (
          <button key={t.key} className={`oc-nav-btn ${view === t.key ? "oc-nav-btn--on" : ""}`} onClick={() => setView(t.key)}>
            <span className="oc-nav-icon">{t.icon}</span><span>{t.label}</span>
            {t.badge && <span className="oc-nav-badge">{t.badge}</span>}
          </button>
        ))}
      </nav>
      <main className="oc-main">
        {view === "kanban" && <KanbanBoard jobs={jobs} onMove={moveJob} onAdd={addJob} onDelete={delJob} />}
        {view === "memory" && <MemoryEditor entries={memory} onUpdate={updMem} onAdd={addMem} onDelete={delMem} />}
        {view === "sessions" && <SessionMonitor sessions={sessions} events={wsEvents} />}
        {view === "config" && <ConfigEditor config={cfg} onSave={(c) => { setCfg(c); api.config.update(c).catch(() => {}); }} />}
      </main>
    </div>
  );
}
