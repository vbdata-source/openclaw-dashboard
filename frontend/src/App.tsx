// ============================================================
// OpenClaw Dashboard — Main App
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "./lib/api";
import { useGateway, type GatewayStatus, type GatewayEvent } from "./hooks/useGateway";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Types ─────────────────────────────────────────────────
export type JobStatus = "backlog" | "queued" | "running" | "pending" | "done" | "failed";
export type JobPriority = "low" | "medium" | "high" | "critical";

export interface JobHistoryEntry {
  timestamp: string;
  status: JobStatus;
  message?: string;
}

export interface JobClarification {
  question: string;
  answer: string;
  timestamp: string;
}

export interface Job {
  id: string;
  title: string;
  description: string;
  status: JobStatus;
  priority: JobPriority;
  agent: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt?: string | null;
  finishedAt?: string | null;
  channel?: string;
  estimatedTokens?: number | null;
  result?: string | null;
  resultUrl?: string | null;
  error?: string | null;
  clarifications?: JobClarification[];
  history: JobHistoryEntry[];
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
  { key: "pending", label: "Rückfrage", color: "#a855f7", icon: "❓" },
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
// ── Sortable Job Card ─────────────────────────────────────
function SortableJobCard({ job, expanded, setExpanded, onMove, onDelete, onOpenDetail }: {
  job: Job;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onMove: (id: string, s: JobStatus) => void;
  onDelete: (id: string) => void;
  onOpenDetail: (job: Job) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`oc-card ${isDragging ? "oc-card--dragging" : ""}`}
      {...attributes}
      {...listeners}
      onClick={() => setExpanded(expanded === job.id ? null : job.id)}
    >
      <div className="oc-card-top">
        <span className="oc-card-title">{job.title}</span>
        <span className="oc-prio" style={{ color: PRIO[job.priority].color, background: PRIO[job.priority].bg }}>{PRIO[job.priority].label}</span>
      </div>
      <p className="oc-card-desc">{job.description}</p>
      <div className="oc-card-meta">
        {job.scheduledAt && <span className="oc-tag" title="Geplant">⏰ {new Date(job.scheduledAt).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })}</span>}
        {job.channel && <span className="oc-tag">{job.channel}</span>}
        {job.estimatedTokens && <span className="oc-tok">~{(job.estimatedTokens / 1000).toFixed(1)}k</span>}
        <span className="oc-time">{timeAgo(job.updatedAt)}</span>
      </div>
      {job.error && <div className="oc-result oc-result--err">❌ {job.error.slice(0, 80)}{job.error.length > 80 ? "..." : ""}</div>}
      {job.result && !job.error && <div className="oc-result-preview">✅ Ergebnis vorhanden</div>}
      {job.status === "pending" && <div className="oc-result-preview oc-result-preview--pending">❓ Rückfrage offen</div>}
      {expanded === job.id && (
        <div className="oc-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="oc-detail-btn" onClick={() => onOpenDetail(job)}>🔍 Details</button>
          <div className="oc-move-btns">
            {LANES.filter((l) => l.key !== job.status).map((l) => (
              <button key={l.key} className="oc-move-btn" style={{ borderColor: l.color, color: l.color }} onClick={() => onMove(job.id, l.key)}>{l.icon} {l.label}</button>
            ))}
          </div>
          <button className="oc-del-btn" onClick={() => onDelete(job.id)}>Löschen</button>
        </div>
      )}
    </div>
  );
}

// ── Droppable Lane Wrapper ────────────────────────────────
function DroppableLane({ id, children, isHighlighted }: { id: string; children: React.ReactNode; isHighlighted?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  
  return (
    <div
      ref={setNodeRef}
      className={`oc-lane-body ${isOver || isHighlighted ? "oc-lane-body--over" : ""}`}
      data-lane={id}
    >
      {children}
    </div>
  );
}

// ── Job Detail Modal ──────────────────────────────────────
function JobDetailModal({ job, onClose, onMove, onDelete, onAddContext, onUpdate }: {
  job: Job;
  onClose: () => void;
  onMove: (id: string, s: JobStatus) => void;
  onDelete: (id: string) => void;
  onAddContext?: (id: string, context: string) => void;
  onUpdate?: (id: string, updates: Partial<Job>) => void;
}) {
  const [fullResult, setFullResult] = useState<string | null>(null);
  const [loadingResult, setLoadingResult] = useState(false);
  const [additionalContext, setAdditionalContext] = useState("");
  const [submittingContext, setSubmittingContext] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: job.title, description: job.description, priority: job.priority });
  const [saving, setSaving] = useState(false);

  // Vollständiges Ergebnis automatisch laden wenn URL vorhanden
  useEffect(() => {
    if (job.resultUrl && !fullResult) {
      setLoadingResult(true);
      console.log("[Modal] Loading full result from:", job.resultUrl);
      fetch(job.resultUrl)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then(text => {
          console.log("[Modal] Full result loaded:", text.length, "chars");
          setFullResult(text);
        })
        .catch(err => {
          console.error("[Modal] Failed to load result:", err);
          setFullResult(null);
        })
        .finally(() => setLoadingResult(false));
    }
  }, [job.resultUrl]);

  const statusInfo = LANES.find(l => l.key === job.status);

  return (
    <div className="oc-modal-overlay" onClick={onClose}>
      <div className="oc-modal" onClick={e => e.stopPropagation()}>
        <div className="oc-modal-header">
          <div className="oc-modal-title">
            <span className="oc-modal-icon">{statusInfo?.icon || "📋"}</span>
            <div>
              <h2>{job.title}</h2>
              <span className="oc-modal-status" style={{ color: statusInfo?.color }}>{statusInfo?.label}</span>
            </div>
          </div>
          <button className="oc-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="oc-modal-content">
          {/* Edit Mode für Backlog Jobs */}
          {job.status === "backlog" && editing ? (
            <div className="oc-modal-section oc-edit-section">
              <h3>✏️ Job bearbeiten</h3>
              <div className="oc-edit-form">
                <label>Titel</label>
                <input 
                  type="text" 
                  value={editForm.title} 
                  onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="oc-edit-input"
                />
                <label>Beschreibung</label>
                <textarea 
                  value={editForm.description} 
                  onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="oc-edit-textarea"
                  rows={6}
                />
                <label>Priorität</label>
                <select 
                  value={editForm.priority} 
                  onChange={(e) => setEditForm(f => ({ ...f, priority: e.target.value as JobPriority }))}
                  className="oc-edit-select"
                >
                  <option value="low">🟢 Niedrig</option>
                  <option value="medium">🟡 Mittel</option>
                  <option value="high">🟠 Hoch</option>
                  <option value="critical">🔴 Kritisch</option>
                </select>
                <div className="oc-edit-actions">
                  <button 
                    className="oc-edit-save"
                    disabled={saving || !editForm.title.trim()}
                    onClick={async () => {
                      if (!onUpdate) return;
                      setSaving(true);
                      try {
                        await onUpdate(job.id, editForm);
                        setEditing(false);
                      } catch (err) {
                        console.error("Save failed:", err);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {saving ? "⏳ Speichern..." : "💾 Speichern"}
                  </button>
                  <button className="oc-edit-cancel" onClick={() => { setEditing(false); setEditForm({ title: job.title, description: job.description, priority: job.priority }); }}>
                    Abbrechen
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Beschreibung / Task */}
              <div className="oc-modal-section">
                <h3>📝 Aufgabe {job.status === "backlog" && <button className="oc-edit-btn" onClick={() => setEditing(true)}>✏️ Bearbeiten</button>}</h3>
                <div className="oc-modal-task">{job.description || "(Keine Beschreibung)"}</div>
              </div>
            </>
          )}

          {/* Ergebnis (nicht bei pending, da Frage in eigener Sektion) */}
          {(job.result || fullResult || job.resultUrl) && job.status !== "pending" && (
            <div className="oc-modal-section">
              <h3>✅ Ergebnis {job.resultUrl && !fullResult && !loadingResult && <button className="oc-load-full-btn" onClick={() => {
                setLoadingResult(true);
                fetch(job.resultUrl!)
                  .then(res => res.text())
                  .then(text => setFullResult(text))
                  .catch(err => setFullResult(`Fehler: ${err.message}`))
                  .finally(() => setLoadingResult(false));
              }}>📄 Vollständig laden</button>}</h3>
              <div className="oc-modal-result">
                {loadingResult ? "⏳ Lade vollständiges Ergebnis..." : (fullResult || job.result || "(Kein Ergebnis)")}
              </div>
              {fullResult && fullResult !== job.result && (
                <div className="oc-result-info">✅ Vollständiges Ergebnis geladen ({fullResult.length} Zeichen)</div>
              )}
            </div>
          )}

          {/* Bisherige Rückfragen */}
          {job.clarifications && job.clarifications.length > 0 && (
            <div className="oc-modal-section oc-clarifications-section">
              <h3>💬 Bisherige Rückfragen ({job.clarifications.length})</h3>
              <div className="oc-clarifications-list">
                {job.clarifications.map((c, i) => (
                  <div key={i} className="oc-clarification-entry">
                    <div className="oc-clarification-q">
                      <span className="oc-clarification-icon">❓</span>
                      <span className="oc-clarification-text">{c.question}</span>
                    </div>
                    <div className="oc-clarification-a">
                      <span className="oc-clarification-icon">✅</span>
                      <span className="oc-clarification-text">{c.answer}</span>
                    </div>
                    <span className="oc-clarification-time">{new Date(c.timestamp).toLocaleString("de-AT")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rückfrage - Kontext ergänzen */}
          {job.status === "pending" && (
            <div className="oc-modal-section oc-pending-section">
              <h3>❓ Aktuelle Rückfrage</h3>
              {job.result && (
                <div className="oc-pending-question">{job.result}</div>
              )}
              <p className="oc-pending-hint">Der Agent braucht weitere Informationen. Ergänze den Kontext und sende den Job erneut.</p>
              <textarea 
                className="oc-context-input"
                placeholder="Deine Antwort eingeben..."
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                rows={4}
              />
              <button 
                className="oc-continue-btn"
                disabled={!additionalContext.trim() || submittingContext}
                onClick={async () => {
                  if (!additionalContext.trim() || !onAddContext) return;
                  setSubmittingContext(true);
                  try {
                    await onAddContext(job.id, additionalContext.trim());
                    setAdditionalContext("");
                    onClose();
                  } catch (err) {
                    console.error("Failed to add context:", err);
                  } finally {
                    setSubmittingContext(false);
                  }
                }}
              >
                {submittingContext ? "⏳ Wird gesendet..." : "🚀 Mit Kontext fortsetzen"}
              </button>
            </div>
          )}

          {/* Fehler */}
          {job.error && (
            <div className="oc-modal-section">
              <h3>❌ Fehler</h3>
              <div className="oc-modal-error">{job.error}</div>
            </div>
          )}

          {/* Historie */}
          {job.history && job.history.length > 0 && (
            <div className="oc-modal-section">
              <h3>📜 Verlauf</h3>
              <div className="oc-modal-history">
                {job.history.map((entry, i) => (
                  <div key={i} className="oc-history-entry">
                    <span className="oc-history-time">{new Date(entry.timestamp).toLocaleString("de-AT")}</span>
                    <span className="oc-history-status">{LANES.find(l => l.key === entry.status)?.icon} {entry.status}</span>
                    {entry.message && <span className="oc-history-msg">{entry.message}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta-Info */}
          <div className="oc-modal-section oc-modal-meta">
            <div><strong>ID:</strong> <code>{job.id}</code></div>
            <div><strong>Erstellt:</strong> {new Date(job.createdAt).toLocaleString("de-AT")}</div>
            <div><strong>Aktualisiert:</strong> {new Date(job.updatedAt).toLocaleString("de-AT")}</div>
            {job.finishedAt && <div><strong>Abgeschlossen:</strong> {new Date(job.finishedAt).toLocaleString("de-AT")}</div>}
            <div><strong>Priorität:</strong> <span style={{ color: PRIO[job.priority].color }}>{PRIO[job.priority].label}</span></div>
          </div>
        </div>

        <div className="oc-modal-actions">
          <div className="oc-move-btns">
            {LANES.filter(l => l.key !== job.status).map(l => (
              <button key={l.key} className="oc-move-btn" style={{ borderColor: l.color, color: l.color }} onClick={() => { onMove(job.id, l.key); onClose(); }}>
                {l.icon} {l.label}
              </button>
            ))}
          </div>
          <button className="oc-del-btn" onClick={() => { onDelete(job.id); onClose(); }}>🗑️ Löschen</button>
        </div>
      </div>
    </div>
  );
}

// ── Job Card Overlay (während Drag) ───────────────────────
function JobCardOverlay({ job }: { job: Job }) {
  return (
    <div className="oc-card oc-card--overlay">
      <div className="oc-card-top">
        <span className="oc-card-title">{job.title}</span>
        <span className="oc-prio" style={{ color: PRIO[job.priority].color, background: PRIO[job.priority].bg }}>{PRIO[job.priority].label}</span>
      </div>
      <p className="oc-card-desc">{job.description}</p>
    </div>
  );
}

// ── Kanban Board mit Drag & Drop ──────────────────────────
function KanbanBoard({ jobs, onMove, onAdd, onDelete, onAddContext, onUpdate, loading }: {
  jobs: Job[];
  onMove: (id: string, s: JobStatus) => void;
  onAdd: (j: Omit<Job, "id" | "createdAt" | "updatedAt" | "history">) => void;
  onDelete: (id: string) => void;
  onAddContext: (id: string, context: string) => void;
  onUpdate: (id: string, updates: Partial<Job>) => void;
  loading?: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [form, setForm] = useState({ 
    title: "", 
    description: "", 
    priority: "medium" as JobPriority, 
    status: "backlog" as JobStatus,
    scheduledAt: "" as string,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<JobStatus | null>(null);

  // Sensors für Mouse, Touch und Keyboard
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAdd = () => {
    if (!form.title.trim()) return;
    onAdd({ 
      ...form, 
      agent: "AJBot",
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    });
    setForm({ title: "", description: "", priority: "medium", status: "backlog", scheduledAt: "" });
    setShowAdd(false);
  };

  // Hilfsfunktion: Finde Lane für eine ID
  const findLaneForId = (id: string): JobStatus | null => {
    const laneKeys = LANES.map((l) => l.key);
    if (laneKeys.includes(id as JobStatus)) {
      return id as JobStatus;
    }
    const job = jobs.find((j) => j.id === id);
    return job?.status || null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveId(id);
    setExpanded(null);
    console.log("[DnD] Start:", id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverLane(null);
      return;
    }
    const lane = findLaneForId(over.id as string);
    setOverLane(lane);
    console.log("[DnD] Over:", over.id, "→ Lane:", lane);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const draggedId = active.id as string;
    
    console.log("[DnD] End:", draggedId, "over:", over?.id);
    
    setActiveId(null);
    setOverLane(null);

    if (!over) return;

    const targetLane = findLaneForId(over.id as string);
    if (!targetLane) return;

    const activeJob = jobs.find((j) => j.id === draggedId);
    if (!activeJob) return;

    if (targetLane !== activeJob.status) {
      console.log("[DnD] Moving", draggedId, "from", activeJob.status, "to", targetLane);
      onMove(draggedId, targetLane);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverLane(null);
  };

  const activeJob = activeId ? jobs.find((j) => j.id === activeId) : null;

  return (
    <div className="oc-kanban">
      <div className="oc-section-header">
        <h2 className="oc-view-title">Job Board {loading && <span className="oc-loading-sm">⏳</span>}</h2>
        <button className="oc-btn-primary" onClick={() => setShowAdd(!showAdd)}>+ Neuer Job</button>
      </div>
      {showAdd && (
        <div className="oc-add-panel">
          <input className="oc-input" placeholder="Job-Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
          <textarea className="oc-input oc-textarea" placeholder="Beschreibung (Task für den Agent)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <div className="oc-add-row">
            <select className="oc-input oc-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as JobPriority })}>
              <option value="low">Niedrig</option><option value="medium">Mittel</option><option value="high">Hoch</option><option value="critical">Kritisch</option>
            </select>
            <select className="oc-input oc-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as JobStatus })}>
              {LANES.map((l) => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}
            </select>
          </div>
          <div className="oc-add-row">
            <label className="oc-input-label" style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
              <span style={{ whiteSpace: "nowrap" }}>⏰ Ausführung:</span>
              <input 
                type="datetime-local" 
                className="oc-input" 
                value={form.scheduledAt} 
                onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                style={{ flex: 1 }}
              />
            </label>
            <span style={{ color: "var(--txd)", fontSize: "12px" }}>{form.scheduledAt ? "" : "(leer = sofort)"}</span>
          </div>
          <div className="oc-add-row">
            <button className="oc-btn-primary" onClick={handleAdd} disabled={!form.title.trim()}>Erstellen</button>
            <button className="oc-btn-ghost" onClick={() => setShowAdd(false)}>Abbrechen</button>
          </div>
        </div>
      )}
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="oc-lanes">
          {LANES.map((lane) => {
            const laneJobs = jobs.filter((j) => j.status === lane.key);
            return (
              <div key={lane.key} className="oc-lane" id={lane.key}>
                <div className="oc-lane-head" style={{ borderBottomColor: lane.color }}>
                  <span>{lane.icon}</span>
                  <span className="oc-lane-label">{lane.label}</span>
                  <span className="oc-lane-count" style={{ background: lane.color }}>{laneJobs.length}</span>
                </div>
                <SortableContext
                  items={laneJobs.map((j) => j.id)}
                  strategy={verticalListSortingStrategy}
                  id={lane.key}
                >
                  <DroppableLane id={lane.key} isHighlighted={overLane === lane.key && activeId !== null}>
                    {laneJobs.length === 0 && <div className="oc-empty">Keine Jobs</div>}
                    {laneJobs.map((job) => (
                      <SortableJobCard
                        key={job.id}
                        job={job}
                        expanded={expanded}
                        setExpanded={setExpanded}
                        onMove={onMove}
                        onDelete={onDelete}
                        onOpenDetail={setSelectedJob}
                      />
                    ))}
                  </DroppableLane>
                </SortableContext>
              </div>
            );
          })}
        </div>
        
        <DragOverlay>
          {activeJob ? <JobCardOverlay job={activeJob} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Job Detail Modal */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onMove={onMove}
          onDelete={onDelete}
          onAddContext={onAddContext}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}

// ── Memory Editor ─────────────────────────────────────────
function MemoryEditor({ entries, onUpdate, onAdd, onDelete, loading }: {
  entries: MemoryEntry[];
  onUpdate: (id: string, val: string) => void;
  onAdd: (e: Omit<MemoryEntry, "id" | "updatedAt">) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
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
        <h2 className="oc-view-title">Memory & Identity {loading && <span className="oc-loading-sm">⏳</span>}</h2>
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
          const s = SCOPE_CFG[entry.scope] || SCOPE_CFG.user;
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
        {filtered.length === 0 && <div className="oc-empty" style={{ gridColumn: "1/-1" }}>{loading ? "Lade Memory..." : "Keine Einträge"}</div>}
      </div>
    </div>
  );
}

// ── Session Detail Panel ──────────────────────────────────
interface SessionPreviewItem {
  role: "user" | "assistant" | "system";
  text: string;
  ts?: number;
}

function SessionDetailPanel({ session, preview, loading, onClose }: {
  session: SessionEntry;
  preview: SessionPreviewItem[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="oc-detail-panel">
      <div className="oc-detail-header">
        <div className="oc-detail-title">
          <span className="oc-detail-icon">💬</span>
          <div>
            <h3>{session.sender}</h3>
            <span className="oc-detail-sub">{session.channel} • {session.id}</span>
          </div>
        </div>
        <button className="oc-detail-close" onClick={onClose}>✕</button>
      </div>
      <div className="oc-detail-content">
        {loading && <div className="oc-empty">Lade Verlauf...</div>}
        {!loading && preview.length === 0 && <div className="oc-empty">Keine Nachrichten</div>}
        {!loading && preview.map((msg, i) => (
          <div key={i} className={`oc-chat-msg oc-chat-msg--${msg.role}`}>
            <div className="oc-chat-role">{msg.role === "user" ? "👤 User" : msg.role === "assistant" ? "🤖 Assistant" : "⚙️ System"}</div>
            <div className="oc-chat-text">{msg.text}</div>
            {msg.ts && <div className="oc-chat-ts">{new Date(msg.ts).toLocaleString("de-AT")}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Session Monitor ───────────────────────────────────────
function SessionMonitor({ sessions, events, loading, onSelectSession, selectedSession, sessionPreview, previewLoading }: {
  sessions: SessionEntry[];
  events: GatewayEvent[];
  loading?: boolean;
  onSelectSession: (session: SessionEntry | null) => void;
  selectedSession: SessionEntry | null;
  sessionPreview: SessionPreviewItem[];
  previewLoading: boolean;
}) {
  const total = sessions.reduce((s, x) => s + x.tokens, 0);
  const msgs = sessions.reduce((s, x) => s + x.messages, 0);
  const active = sessions.filter((s) => s.status === "active").length;
  const CH: Record<string, { icon: string; color: string }> = {
    whatsapp: { icon: "📱", color: "#25D366" }, telegram: { icon: "✈️", color: "#0088cc" },
    webchat: { icon: "🌐", color: "#6366f1" }, discord: { icon: "🎮", color: "#5865F2" },
    slack: { icon: "💼", color: "#4A154B" }, signal: { icon: "🔒", color: "#3A76F0" },
    msteams: { icon: "🏢", color: "#6264A7" },
  };
  const ST: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: "Aktiv", color: "#22c55e", bg: "rgba(34,197,94,0.15)" },
    idle: { label: "Idle", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
    completed: { label: "Beendet", color: "#64748b", bg: "rgba(100,116,139,0.15)" },
  };

  return (
    <div className="oc-sessions-layout">
      <div className={`oc-sessions-main ${selectedSession ? "oc-sessions-main--narrow" : ""}`}>
        <div className="oc-section-header">
          <h2 className="oc-view-title">Live Sessions {loading && <span className="oc-loading-sm">⏳</span>}</h2>
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
            const st = ST[s.status] || ST.idle;
            const pct = Math.min((s.tokens / 20000) * 100, 100);
            const isSelected = selectedSession?.id === s.id;
            return (
              <div
                key={s.id}
                className={`oc-sess-card ${s.status === "active" ? "oc-sess-card--active" : ""} ${isSelected ? "oc-sess-card--selected" : ""}`}
                onClick={() => onSelectSession(isSelected ? null : s)}
                style={{ cursor: "pointer" }}
              >
                <span className="oc-sess-ch" style={{ background: ch.color + "22", color: ch.color }}>{ch.icon}</span>
                <div className="oc-sess-info">
                  <div className="oc-sess-row1"><span className="oc-sess-sender">{s.sender}</span><span className="oc-sess-status" style={{ color: st.color, background: st.bg }}>{s.status === "active" && <span className="oc-pulse-sm" />}{st.label}</span></div>
                  <div className="oc-sess-row2"><span>{s.channel}</span><span>•</span><span>{s.messages} msg</span><span>•</span><span>{(s.tokens / 1000).toFixed(1)}k tok</span></div>
                </div>
                <div className="oc-sess-bar-wrap"><div className="oc-sess-bar"><div className="oc-sess-fill" style={{ width: `${pct}%`, background: pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e" }} /></div></div>
              </div>
            );
          })}
          {sessions.length === 0 && <div className="oc-empty">{loading ? "Lade Sessions..." : "Keine Sessions"}</div>}
        </div>
        <div className="oc-log-box">
          <h3 className="oc-log-head">Event Log</h3>
          <div className="oc-log-scroll">
            {events.slice(0, 50).map((ev, i) => (
              <div key={i} className={`oc-log-row oc-log-row--${ev.level || "info"}`}>
                <span className="oc-log-ts">{new Date(ev.timestamp || Date.now()).toLocaleTimeString("de-AT")}</span>
                <span className={`oc-log-lvl oc-log-lvl--${ev.level || "info"}`}>{ev.level || ev.event || ev.type?.split(":")[0] || "info"}</span>
                <span className="oc-log-msg">{ev.message || ev.event || JSON.stringify(ev).slice(0, 120)}</span>
              </div>
            ))}
            {events.length === 0 && <div className="oc-empty">Warte auf Events...</div>}
          </div>
        </div>
      </div>
      {selectedSession && (
        <SessionDetailPanel
          session={selectedSession}
          preview={sessionPreview}
          loading={previewLoading}
          onClose={() => onSelectSession(null)}
        />
      )}
    </div>
  );
}

// ── Config Editor ─────────────────────────────────────────
function ConfigEditor({ config, onSave, loading }: { config: any; onSave: (c: any) => void; loading?: boolean }) {
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

  // Dynamisch Sektionen aus Config-Keys ableiten
  const configKeys = Object.keys(config || {});
  const dynamicSects = configKeys
    .filter((k) => !SECTS.some((s) => s.key === k))
    .map((k) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), icon: "📄" }));
  const allSects = [...SECTS, ...dynamicSects];

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
          <div className="oc-cfg-list">{v.map((item, i) => <code key={i} className="oc-cfg-list-item">{typeof item === "object" ? JSON.stringify(item) : String(item)}</code>)}</div>
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
        <h2 className="oc-view-title">Konfiguration {loading && <span className="oc-loading-sm">⏳</span>}</h2>
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
            {allSects.map((s) => (
              <button key={s.key} className={`oc-cfg-nav-btn ${section === s.key ? "oc-cfg-nav-btn--on" : ""}`} onClick={() => setSection(s.key)}>
                <span>{s.icon}</span><span>{s.label}</span>
              </button>
            ))}
          </div>
          <div className="oc-cfg-content">{config && config[section] ? renderSection(config[section]) : <div className="oc-empty">Keine Daten für "{section}"</div>}</div>
        </div>
      )}
    </div>
  );
}

// ── Data Mapping Helpers ──────────────────────────────────
function mapSessionsResponse(payload: any): SessionEntry[] {
  // Gateway sessions.list kann verschiedene Formate haben
  const raw = payload?.sessions || payload?.items || payload || [];
  if (!Array.isArray(raw)) return [];

  return raw.map((s: any, i: number) => {
    // Session-Key als ID verwenden (z.B. "agent:main:whatsapp:dm:+43...")
    const key = s.key || s.id || s.sessionKey || `s${i}`;
    const parts = key.split(":");

    // Channel und Sender aus Session-Key extrahieren
    const channel = s.channel || parts[2] || "unknown";
    const sender = s.sender || s.peer || s.from || parts.slice(3).join(":") || key;

    return {
      id: key,
      channel,
      sender,
      agent: s.agent || s.agentId || parts[1] || "main",
      status: s.status === "active" || s.active ? "active" : s.status === "idle" ? "idle" : "completed",
      messages: s.messages || s.messageCount || s.turns || 0,
      tokens: s.tokens || s.totalTokens || s.tokenCount || 0,
      startedAt: s.startedAt || s.createdAt || s.created || new Date().toISOString(),
      lastActivity: s.lastActivity || s.updatedAt || s.lastMessage || s.updated || new Date().toISOString(),
    } as SessionEntry;
  });
}

function mapCronToJobs(payload: any): Job[] {
  const raw = payload?.jobs || payload?.items || payload || [];
  if (!Array.isArray(raw)) return [];

  return raw.map((j: any, i: number) => ({
    id: j.id || j.name || `cron-${i}`,
    title: j.name || j.label || j.title || `Cron Job ${i + 1}`,
    description: j.description || j.command || j.schedule || "",
    status: j.enabled === false ? "backlog" : j.running ? "running" : j.lastError ? "failed" : j.lastRun ? "done" : "queued",
    priority: "medium" as JobPriority,
    agent: j.agent || j.agentId || "main",
    createdAt: j.createdAt || j.created || new Date().toISOString(),
    updatedAt: j.lastRun || j.updatedAt || new Date().toISOString(),
    channel: j.channel,
    estimatedTokens: j.estimatedTokens || j.tokens,
    result: j.lastResult || j.lastError,
  }));
}

function mapStatusToMemory(status: any, config: any): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const now = new Date().toISOString();

  // Bot-Identity aus Config/Status ableiten
  const assistantName = status?.assistant?.name || config?.agents?.defaults?.name || "AJBot";
  entries.push({ id: "m-name", key: "name", value: assistantName, scope: "identity", updatedAt: now });

  if (status?.assistant?.avatar) {
    entries.push({ id: "m-avatar", key: "avatar", value: status.assistant.avatar, scope: "identity", updatedAt: now });
  }

  // Agents info
  if (config?.agents) {
    const model = config.agents?.defaults?.model?.primary || "";
    if (model) entries.push({ id: "m-model", key: "model", value: model, scope: "identity", updatedAt: now });
    
    const workspace = config.agents?.defaults?.workspace || "";
    if (workspace) entries.push({ id: "m-workspace", key: "workspace", value: workspace, scope: "identity", updatedAt: now });
  }

  // Gateway info
  if (config?.gateway) {
    entries.push({ id: "m-mode", key: "gateway.mode", value: config.gateway.mode || "local", scope: "user", updatedAt: now });
    entries.push({ id: "m-bind", key: "gateway.bind", value: config.gateway.bind || "loopback", scope: "user", updatedAt: now });
  }

  // Channels
  if (config?.channels) {
    Object.keys(config.channels).forEach((ch, i) => {
      const chCfg = config.channels[ch];
      const enabled = chCfg.enabled !== false;
      entries.push({
        id: `m-ch-${i}`,
        key: `channel.${ch}`,
        value: enabled ? `Aktiv (DM: ${chCfg.dmPolicy || "??"})` : "Deaktiviert",
        scope: "user",
        updatedAt: now,
      });
    });
  }

  // Uptime
  if (status?.uptime) {
    const h = Math.floor(status.uptime / 3600);
    const m = Math.floor((status.uptime % 3600) / 60);
    entries.push({ id: "m-uptime", key: "uptime", value: `${h}h ${m}m`, scope: "user", updatedAt: now });
  }

  // Version
  if (status?.version) {
    entries.push({ id: "m-version", key: "version", value: status.version, scope: "identity", updatedAt: now });
  }

  return entries;
}

// ── Chat View ─────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  pending?: boolean;
}

function ChatView({ request, events }: { 
  request: (method: string, params: any) => Promise<any>;
  events: GatewayEvent[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionKey, setSessionKey] = useState("agent:main:webchat:dashboard");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for gateway events (agent + chat)
  useEffect(() => {
    const latest = events[0];
    if (!latest) return;
    
    const eventName = latest.event || latest.type;
    const payload = latest.payload || latest;
    
    // Debug logging
    console.log("[Chat] Event:", eventName, payload);
    
    // ─── AGENT Events (streaming) ───────────────────────────
    if (eventName === "agent") {
      const stream = payload.stream;
      const data = payload.data || {};
      
      // Text from assistant - Gateway sends full text, not deltas!
      if (stream === "assistant" && typeof data.text === "string") {
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.pending && lastMsg.role === "assistant") {
            // Replace content entirely (Gateway sends cumulative text, not deltas)
            return [...prev.slice(0, -1), {
              ...lastMsg,
              content: data.text,
            }];
          }
          return prev;
        });
      }
      
      // Lifecycle events (end/error)
      if (stream === "lifecycle") {
        const phase = data.phase;
        if (phase === "end" || phase === "error") {
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.pending) {
              const content = phase === "error" && data.error
                ? lastMsg.content + `\n\n❌ ${data.error}`
                : lastMsg.content;
              return [...prev.slice(0, -1), { ...lastMsg, content, pending: false }];
            }
            return prev;
          });
          setSending(false);
        }
      }
    }
    
    // ─── CHAT Events (final messages) ───────────────────────
    if (eventName === "chat") {
      const state = payload.state;
      
      // Final message
      if (state === "final" && payload.message) {
        const msgContent = payload.message.content;
        const text = Array.isArray(msgContent)
          ? msgContent.map((c: any) => c.text || "").join("")
          : (typeof msgContent === "string" ? msgContent : "");
        
        if (text) {
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.pending && lastMsg.role === "assistant") {
              return [...prev.slice(0, -1), {
                ...lastMsg,
                content: text,
                pending: false,
              }];
            }
            return prev;
          });
        }
        setSending(false);
      }
      
      // Error state
      if (state === "error") {
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.pending) {
            return [...prev.slice(0, -1), {
              ...lastMsg,
              content: lastMsg.content + `\n\n❌ ${payload.errorMessage || "Fehler"}`,
              pending: false,
            }];
          }
          return prev;
        });
        setSending(false);
      }
    }
  }, [events]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: `msg-${Date.now()}-response`,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      pending: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSending(true);

    try {
      await request("chat.send", {
        sessionKey,
        message: text,
        idempotencyKey: `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        deliver: false, // Don't deliver to external channels
      });
    } catch (err: any) {
      console.error("[Chat] Send error:", err);
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg?.pending) {
          return [...prev.slice(0, -1), {
            ...lastMsg,
            content: `❌ Fehler: ${err.message}`,
            pending: false,
          }];
        }
        return prev;
      });
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="oc-chat-view">
      <div className="oc-chat-header">
        <div className="oc-chat-title">
          <span className="oc-chat-icon">💬</span>
          <div>
            <h2>Live Chat</h2>
            <span className="oc-chat-session">Session: {sessionKey}</span>
          </div>
        </div>
        <div className="oc-chat-status">
          {sending && <span className="oc-chat-typing">🤖 Schreibt...</span>}
        </div>
      </div>
      
      <div className="oc-chat-messages">
        {messages.length === 0 && (
          <div className="oc-chat-welcome">
            <div className="oc-chat-welcome-icon">🦞</div>
            <h3>Willkommen im Live Chat!</h3>
            <p>Schreibe eine Nachricht um mit dem Agent zu sprechen.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`oc-chat-bubble oc-chat-bubble--${msg.role} ${msg.pending ? "oc-chat-bubble--pending" : ""}`}>
            <div className="oc-chat-bubble-role">
              {msg.role === "user" ? "👤 Du" : msg.role === "assistant" ? "🤖 Agent" : "⚙️ System"}
            </div>
            <div className="oc-chat-bubble-content">
              {msg.content || (msg.pending ? "..." : "")}
              {msg.pending && <span className="oc-chat-cursor">▊</span>}
            </div>
            <div className="oc-chat-bubble-time">
              {new Date(msg.timestamp).toLocaleTimeString("de-AT")}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="oc-chat-input-area">
        <textarea
          ref={inputRef}
          className="oc-chat-input"
          placeholder="Nachricht eingeben... (Enter zum Senden)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={1}
        />
        <button 
          className="oc-chat-send" 
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          {sending ? "⏳" : "➤"}
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────
type View = "kanban" | "memory" | "sessions" | "chat" | "config";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("chat");

  // Echte Daten (leer initialisiert, Jobs von API laden)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [cfg, setCfg] = useState<any>({});
  const [dataLoading, setDataLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);

  // Session Detail State
  const [selectedSession, setSelectedSession] = useState<SessionEntry | null>(null);
  const [sessionPreview, setSessionPreview] = useState<SessionPreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const { status: wsStatus, events: wsEvents, connect: wsConnect, request: gwRequest } = useGateway({
    autoConnect: authed === true,
  });

  // Session Preview laden
  const handleSelectSession = useCallback(async (session: SessionEntry | null) => {
    setSelectedSession(session);
    setSessionPreview([]);
    
    if (!session) return;
    
    setPreviewLoading(true);
    try {
      const res = await gwRequest("sessions.preview", { 
        keys: [session.id], 
        limit: 50,
        maxChars: 500 
      });
      const preview = res?.previews?.[0];
      if (preview?.items) {
        setSessionPreview(preview.items.map((item: any) => ({
          role: item.role || "user",
          text: item.text || item.content || "",
          ts: item.ts || item.timestamp,
        })));
      }
    } catch (err) {
      console.error("[App] Session preview error:", err);
    } finally {
      setPreviewLoading(false);
    }
  }, [gwRequest]);

  // Auth check on mount
  useEffect(() => {
    api.auth.check().then((r) => setAuthed(r.authenticated)).catch(() => setAuthed(false));
    const handler = () => setAuthed(false);
    window.addEventListener("oc:auth:expired", handler);
    return () => window.removeEventListener("oc:auth:expired", handler);
  }, []);

  // ── Echte Daten laden wenn Gateway verbunden ─────────────
  const dataLoadedRef = useRef(false);

  useEffect(() => {
    if (wsStatus !== "connected") {
      dataLoadedRef.current = false;
      return;
    }
    if (dataLoadedRef.current) return;
    dataLoadedRef.current = true;

    setDataLoading(true);
    console.log("[App] Lade Echtdaten vom Gateway...");

    const loadData = async () => {
      let configData: any = {};
      let statusData: any = {};

      // 1. Config laden
      try {
        const res = await gwRequest("config.get");
        configData = res?.config || res || {};
        setCfg(configData);
        console.log("[App] Config geladen:", Object.keys(configData));
      } catch (err: any) {
        console.warn("[App] Config laden fehlgeschlagen:", err.message);
      }

      // 2. Status/Health laden
      try {
        const res = await gwRequest("status");
        statusData = res || {};
        console.log("[App] Status geladen:", statusData);
      } catch {
        try {
          const res = await gwRequest("health");
          statusData = res || {};
          console.log("[App] Health geladen:", statusData);
        } catch (err: any) {
          console.warn("[App] Status/Health fehlgeschlagen:", err.message);
        }
      }

      // 3. Sessions laden
      try {
        const res = await gwRequest("sessions.list");
        const mapped = mapSessionsResponse(res);
        setSessions(mapped);
        console.log("[App] Sessions geladen:", mapped.length);
      } catch (err: any) {
        console.warn("[App] Sessions laden fehlgeschlagen:", err.message);
      }

      // 4. Dashboard Jobs laden (von Dashboard API, nicht Gateway)
      try {
        const res = await api.jobs.list();
        setJobs(res.jobs || []);
        console.log("[App] Dashboard-Jobs geladen:", res.jobs?.length || 0);
      } catch (err: any) {
        console.warn("[App] Jobs laden fehlgeschlagen:", err.message);
      }

      // 5. Memory aus Status + Config ableiten
      const memEntries = mapStatusToMemory(statusData, configData);
      if (memEntries.length > 0) {
        setMemory(memEntries);
        console.log("[App] Memory-Einträge abgeleitet:", memEntries.length);
      }

      setDataLoading(false);
    };

    loadData();
  }, [wsStatus, gwRequest]);

  // ── Live-Event-Updates ─────────────────────────────────
  useEffect(() => {
    if (!wsEvents.length) return;
    const latest = wsEvents[0];

    // Session-Updates live verarbeiten
    if (latest.event === "session.started" || latest.event === "session.updated") {
      const s = latest.payload;
      if (s) {
        setSessions((prev) => {
          const key = s.key || s.id || s.sessionKey;
          const existing = prev.find((x) => x.id === key);
          const entry = mapSessionsResponse({ sessions: [s] })[0];
          if (!entry) return prev;
          if (existing) return prev.map((x) => (x.id === key ? entry : x));
          return [entry, ...prev];
        });
      }
    }

    if (latest.event === "session.ended" || latest.event === "session.closed") {
      const key = latest.payload?.key || latest.payload?.id;
      if (key) {
        setSessions((prev) =>
          prev.map((x) => (x.id === key ? { ...x, status: "completed" as const } : x))
        );
      }
    }

    // ── Job-Events live verarbeiten ─────────────────────────
    if (latest.event === "job.created") {
      const job = latest.payload;
      if (job?.id) {
        console.log("[App] Job created:", job.id);
        setJobs((prev) => {
          if (prev.find((j) => j.id === job.id)) return prev;
          return [job, ...prev];
        });
      }
    }

    if (latest.event === "job.updated") {
      const job = latest.payload;
      if (job?.id) {
        console.log("[App] Job updated:", job.id, job.status);
        setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      }
    }

    if (latest.event === "job.deleted") {
      const { id } = latest.payload || {};
      if (id) {
        console.log("[App] Job deleted:", id);
        setJobs((prev) => prev.filter((j) => j.id !== id));
      }
    }
  }, [wsEvents]);

  // ── Job Actions (API-basiert) ─────────────────────────────
  const moveJob = useCallback(async (id: string, status: JobStatus) => {
    // Optimistic update
    setJobs((p) => p.map((j) => (j.id === id ? { ...j, status, updatedAt: new Date().toISOString() } : j)));
    try {
      await api.jobs.move(id, status);
    } catch (err: any) {
      console.error("[App] Job move failed:", err.message);
      // Reload jobs on error
      api.jobs.list().then((res) => setJobs(res.jobs || []));
    }
  }, []);

  const addJob = useCallback(async (j: Omit<Job, "id" | "createdAt" | "updatedAt" | "history">) => {
    try {
      const created = await api.jobs.create({
        title: j.title,
        description: j.description,
        priority: j.priority,
        status: j.status,
        agent: j.agent,
        channel: j.channel,
        scheduledAt: j.scheduledAt,
      });
      // Job wird via WebSocket Event hinzugefügt
      console.log("[App] Job created:", created.id);
    } catch (err: any) {
      console.error("[App] Job create failed:", err.message);
    }
  }, []);

  const delJob = useCallback(async (id: string) => {
    // Optimistic update
    setJobs((p) => p.filter((j) => j.id !== id));
    try {
      await api.jobs.delete(id);
    } catch (err: any) {
      console.error("[App] Job delete failed:", err.message);
      // Reload jobs on error
      api.jobs.list().then((res) => setJobs(res.jobs || []));
    }
  }, []);

  const addContextToJob = useCallback(async (id: string, context: string) => {
    try {
      // Neuer strukturierter Endpoint für Clarifications
      await api.jobs.clarify(id, context);
      console.log("[App] Clarification added to job:", id);
    } catch (err: any) {
      console.error("[App] Failed to add clarification:", err.message);
      throw err;
    }
  }, []);

  const updateJob = useCallback(async (id: string, updates: Partial<Job>) => {
    // Optimistic update
    setJobs((p) => p.map((j) => (j.id === id ? { ...j, ...updates, updatedAt: new Date().toISOString() } : j)));
    try {
      await api.jobs.update(id, updates);
      console.log("[App] Job updated:", id);
    } catch (err: any) {
      console.error("[App] Job update failed:", err.message);
      // Reload jobs on error
      api.jobs.list().then((res) => setJobs(res.jobs || []));
      throw err;
    }
  }, []);

  const updMem = useCallback((id: string, v: string) => setMemory((p) => p.map((m) => (m.id === id ? { ...m, value: v, updatedAt: new Date().toISOString() } : m))), []);

  const addMem = useCallback((e: Omit<MemoryEntry, "id" | "updatedAt">) => setMemory((p) => [...p, { ...e, id: `m${Date.now()}`, updatedAt: new Date().toISOString() }]), []);

  const delMem = useCallback((id: string) => setMemory((p) => p.filter((m) => m.id !== id)), []);

  if (authed === null) return <div className="oc-loading"><span className="oc-loading-logo">🦞</span></div>;
  if (!authed) return <LoginScreen onLogin={() => { setAuthed(true); wsConnect(); }} />;

  const running = jobs.filter((j) => j.status === "running").length;
  const activeSess = sessions.filter((s) => s.status === "active").length;

  const TABS: { key: View; label: string; icon: string; badge?: number }[] = [
    { key: "chat", label: "Chat", icon: "💬" },
    { key: "sessions", label: "Sessions", icon: "⚡", badge: activeSess || undefined },
    { key: "kanban", label: "Jobs", icon: "▦", badge: running || undefined },
    { key: "memory", label: "Memory", icon: "◉" },
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
        {view === "chat" && <ChatView request={gwRequest} events={wsEvents} />}
        {view === "kanban" && <KanbanBoard jobs={jobs} onMove={moveJob} onAdd={addJob} onDelete={delJob} onAddContext={addContextToJob} onUpdate={updateJob} loading={dataLoading} />}
        {view === "memory" && <MemoryEditor entries={memory} onUpdate={updMem} onAdd={addMem} onDelete={delMem} loading={dataLoading} />}
        {view === "sessions" && <SessionMonitor sessions={sessions} events={wsEvents} loading={dataLoading} onSelectSession={handleSelectSession} selectedSession={selectedSession} sessionPreview={sessionPreview} previewLoading={previewLoading} />}
        {view === "config" && <ConfigEditor config={cfg} onSave={(c) => { setCfg(c); gwRequest("config.patch", { patch: c }).catch(() => {}); }} loading={dataLoading} />}
      </main>
    </div>
  );
}
