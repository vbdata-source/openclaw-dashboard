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
import { SessionsView } from "./components/SessionsView";
import { SettingsView } from "./components/settings";
import { TemplatesView } from "./components/TemplatesView";
import { RagView } from "./components/RagView";

// ── Types ─────────────────────────────────────────────────
export type JobStatus = "backlog" | "queued" | "running" | "pending" | "done" | "failed" | "archived";
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
  lastMessage?: string;
  model?: string;
  cost?: number;
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

// Archiv ist separat (nicht im Haupt-Board)
const ARCHIVE_LANE = { key: "archived" as JobStatus, label: "Archiv", color: "#475569", icon: "📦" };

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

// Truncate text to N lines for card preview
function truncateLines(text: string | undefined, maxLines: number): string {
  if (!text) return "";
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + "…";
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
      <p className="oc-card-desc">{truncateLines(job.description, 5)}</p>
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
          {/* Archivieren für done/failed Jobs */}
          {(job.status === "done" || job.status === "failed") && (
            <button 
              className="oc-archive-btn" 
              style={{ borderColor: ARCHIVE_LANE.color, color: ARCHIVE_LANE.color }}
              onClick={() => { onMove(job.id, "archived"); onClose(); }}
            >
              {ARCHIVE_LANE.icon} Archivieren
            </button>
          )}
          {/* Wiederherstellen für archivierte Jobs */}
          {job.status === "archived" && (
            <button 
              className="oc-restore-btn" 
              style={{ borderColor: "#22c55e", color: "#22c55e" }}
              onClick={() => { onMove(job.id, "done"); onClose(); }}
            >
              ♻️ Wiederherstellen
            </button>
          )}
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
      <p className="oc-card-desc">{truncateLines(job.description, 5)}</p>
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
  const [showArchive, setShowArchive] = useState(false);
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
  
  // Jobs filtern: aktive vs archivierte
  const activeJobs = jobs.filter(j => j.status !== "archived");
  const archivedJobs = jobs.filter(j => j.status === "archived");

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
    const allLaneKeys = [...LANES.map((l) => l.key), ARCHIVE_LANE.key];
    if (allLaneKeys.includes(id as JobStatus)) {
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
        <div className="oc-header-actions">
          <button 
            className={`oc-archive-toggle ${showArchive ? "oc-archive-toggle--active" : ""}`}
            onClick={() => setShowArchive(!showArchive)}
          >
            📦 Archiv {archivedJobs.length > 0 && <span className="oc-archive-count">{archivedJobs.length}</span>}
          </button>
          <button className="oc-btn-primary" onClick={() => setShowAdd(!showAdd)}>+ Neuer Job</button>
        </div>
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
            const laneJobs = activeJobs.filter((j) => j.status === lane.key);
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

      {/* Archiv-Sektion */}
      {showArchive && (
        <div className="oc-archive-section">
          <div className="oc-archive-header">
            <h3>{ARCHIVE_LANE.icon} {ARCHIVE_LANE.label}</h3>
            <span className="oc-archive-info">{archivedJobs.length} Job{archivedJobs.length !== 1 ? "s" : ""} archiviert</span>
          </div>
          <div className="oc-archive-list">
            {archivedJobs.length === 0 && (
              <div className="oc-empty">Keine archivierten Jobs</div>
            )}
            {archivedJobs.map((job) => (
              <div key={job.id} className="oc-archive-card" onClick={() => setSelectedJob(job)}>
                <div className="oc-archive-card-main">
                  <span className="oc-archive-card-title">{job.title}</span>
                  <span className="oc-prio" style={{ color: PRIO[job.priority].color, background: PRIO[job.priority].bg }}>{PRIO[job.priority].label}</span>
                </div>
                <div className="oc-archive-card-meta">
                  <span>{job.description?.slice(0, 60)}{job.description && job.description.length > 60 ? "..." : ""}</span>
                  <span className="oc-time">Archiviert {timeAgo(job.updatedAt)}</span>
                </div>
                <div className="oc-archive-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="oc-restore-btn-sm" onClick={() => onMove(job.id, "done")} title="Wiederherstellen">♻️</button>
                  <button className="oc-del-btn-sm" onClick={() => onDelete(job.id)} title="Endgültig löschen">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

// ── Workspace Files Editor ────────────────────────────────
const WORKSPACE_FILES = [
  { name: "MEMORY.md", icon: "🧠", desc: "Langzeitgedächtnis", color: "#8b5cf6" },
  { name: "IDENTITY.md", icon: "🪪", desc: "Name & Rolle", color: "#ec4899" },
  { name: "SOUL.md", icon: "💫", desc: "Persönlichkeit", color: "#f59e0b" },
  { name: "USER.md", icon: "👤", desc: "Benutzer-Info", color: "#06b6d4" },
  { name: "TOOLS.md", icon: "🔧", desc: "Tool-Notizen", color: "#84cc16" },
  { name: "HEARTBEAT.md", icon: "💓", desc: "Heartbeat Tasks", color: "#ef4444" },
  { name: "AGENTS.md", icon: "📋", desc: "Agent-Anweisungen", color: "#64748b" },
];

function WorkspaceFilesEditor({ loading: initialLoading }: { loading?: boolean }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [folderFiles, setFolderFiles] = useState<{ name: string; size: number }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"main" | "memory">("main");

  // Dateien laden
  useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      const loaded: Record<string, string> = {};
      
      // Hauptdateien laden
      for (const file of WORKSPACE_FILES) {
        try {
          const res = await api.memory.getFile(file.name);
          loaded[file.name] = res.content;
        } catch {
          loaded[file.name] = ""; // Datei existiert nicht
        }
      }
      setFiles(loaded);

      // memory/ Ordner laden
      try {
        const folderRes = await api.memory.listFolder();
        setFolderFiles(folderRes.files || []);
      } catch {
        setFolderFiles([]);
      }

      setLoading(false);
    };
    loadFiles();
  }, []);

  // Datei öffnen
  const openFile = async (filename: string, isFolder = false) => {
    if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    
    setSelectedFile(filename);
    setDirty(false);
    
    if (isFolder) {
      try {
        const res = await api.memory.getFolderFile(filename);
        setEditContent(res.content);
      } catch {
        setEditContent("");
      }
    } else {
      setEditContent(files[filename] || "");
    }
  };

  // Datei speichern
  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    
    try {
      const isFolder = !WORKSPACE_FILES.some(f => f.name === selectedFile);
      if (isFolder) {
        await api.memory.updateFolderFile(selectedFile, editContent);
      } else {
        await api.memory.updateFile(selectedFile, editContent);
        setFiles(prev => ({ ...prev, [selectedFile]: editContent }));
      }
      setDirty(false);
      alert("✅ Gespeichert!");
    } catch (err: any) {
      alert("❌ Fehler: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const fileInfo = selectedFile ? WORKSPACE_FILES.find(f => f.name === selectedFile) : null;

  return (
    <div className="oc-workspace">
      <div className="oc-section-header">
        <h2 className="oc-view-title">Workspace Dateien {loading && <span className="oc-loading-sm">⏳</span>}</h2>
        <div className="oc-view-tabs">
          <button className={`oc-view-tab ${view === "main" ? "oc-view-tab--active" : ""}`} onClick={() => setView("main")}>📄 Hauptdateien</button>
          <button className={`oc-view-tab ${view === "memory" ? "oc-view-tab--active" : ""}`} onClick={() => setView("memory")}>📁 memory/</button>
        </div>
      </div>

      <div className="oc-workspace-layout">
        {/* Dateiliste */}
        <div className="oc-file-list">
          {view === "main" ? (
            WORKSPACE_FILES.map(file => (
              <div 
                key={file.name}
                className={`oc-file-item ${selectedFile === file.name ? "oc-file-item--active" : ""} ${!files[file.name] ? "oc-file-item--empty" : ""}`}
                onClick={() => openFile(file.name)}
                style={{ borderLeftColor: file.color }}
              >
                <span className="oc-file-icon">{file.icon}</span>
                <div className="oc-file-info">
                  <span className="oc-file-name">{file.name}</span>
                  <span className="oc-file-desc">{file.desc}</span>
                </div>
                {files[file.name] && <span className="oc-file-size">{(files[file.name].length / 1024).toFixed(1)}k</span>}
              </div>
            ))
          ) : (
            <>
              {folderFiles.length === 0 && <div className="oc-empty">Keine Dateien in memory/</div>}
              {folderFiles.map(file => (
                <div 
                  key={file.name}
                  className={`oc-file-item ${selectedFile === file.name ? "oc-file-item--active" : ""}`}
                  onClick={() => openFile(file.name, true)}
                >
                  <span className="oc-file-icon">📝</span>
                  <div className="oc-file-info">
                    <span className="oc-file-name">{file.name}</span>
                  </div>
                  <span className="oc-file-size">{(file.size / 1024).toFixed(1)}k</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Editor */}
        <div className="oc-file-editor">
          {selectedFile ? (
            <>
              <div className="oc-editor-header">
                <div className="oc-editor-title">
                  <span>{fileInfo?.icon || "📝"}</span>
                  <span>{selectedFile}</span>
                  {dirty && <span className="oc-dirty-badge">●</span>}
                </div>
                <button 
                  className="oc-btn-primary" 
                  onClick={saveFile} 
                  disabled={saving || !dirty}
                >
                  {saving ? "⏳ Speichern..." : "💾 Speichern"}
                </button>
              </div>
              <textarea 
                className="oc-editor-textarea"
                value={editContent}
                onChange={(e) => { setEditContent(e.target.value); setDirty(true); }}
                placeholder="Dateiinhalt..."
                spellCheck={false}
              />
            </>
          ) : (
            <div className="oc-editor-empty">
              <span className="oc-editor-empty-icon">📄</span>
              <p>Wähle eine Datei zum Bearbeiten</p>
            </div>
          )}
        </div>
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

    // Spezialfall: agent:main:main ist die Multi-Channel Haupt-Session
    const isMainSession = key === "agent:main:main" || key.endsWith(":main:main");
    
    // Debug: Log main session detection
    if (i === 0) {
      console.log("[Map] First session - key:", key, "isMain:", isMainSession, "apiChannel:", s.channel);
    }
    
    // Channel aus verschiedenen Quellen extrahieren (Priorität)
    let channel = isMainSession 
      ? "multi"  // Main-Session ist IMMER multi-channel
      : (s.channel 
          || s.deliveryContext?.channel 
          || (parts.length > 3 ? parts[2] : null)
          || "main");
    
    // "main" als Channel-Name -> "multi" (bedient mehrere Kanäle)
    if (channel === "main") channel = "multi";
    
    // Sender aus verschiedenen Quellen - origin.label hat den echten Namen!
    const sender = s.origin?.label  // "Juergen Viertbauer id:5249745642"
      || s.sender 
      || s.peer 
      || s.from 
      || s.deliveryContext?.to 
      || (parts.length > 3 ? parts.slice(3).join(":") : null)
      || s.displayName
      || key;

    // Extract last message text if available
    let lastMessageText: string | undefined;
    if (Array.isArray(s.messages) && s.messages.length > 0) {
      const lastMsg = s.messages[s.messages.length - 1];
      const content = lastMsg?.content;
      if (Array.isArray(content)) {
        lastMessageText = content.find((c: any) => c.type === "text")?.text?.slice(0, 100);
      } else if (typeof content === "string") {
        lastMessageText = content.slice(0, 100);
      }
    }

    return {
      id: key,
      channel,
      sender,
      agent: s.agent || s.agentId || parts[1] || "main",
      status: s.status === "active" || s.active ? "active" : s.status === "idle" ? "idle" : "completed",
      // API liefert keinen Message-Count - nur wenn vorhanden anzeigen
      messages: Array.isArray(s.messages) ? s.messages.length : (s.messageCount || s.turns || s.totalMessages || s.msgCount || -1),
      tokens: s.tokens || s.totalTokens || s.tokenCount || s.contextTokens || 0,
      startedAt: s.startedAt || s.createdAt || s.created || new Date().toISOString(),
      lastActivity: s.lastActivity || s.updatedAt || s.updated || new Date().toISOString(),
      lastMessage: lastMessageText,
      model: s.model,
      cost: s.cost,
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

// ── Cron Job Types ────────────────────────────────────────
export interface CronJob {
  id: string;
  name?: string;
  schedule: {
    kind: "at" | "every" | "cron";
    at?: string;      // ISO-String (von API)
    atMs?: number;    // Milliseconds (legacy)
    everyMs?: number;
    anchorMs?: number;
    expr?: string;
    tz?: string;
  };
  payload: {
    kind: "systemEvent" | "agentTurn";
    text?: string;
    message?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    deliver?: boolean;
    channel?: string;
    to?: string;
  };
  sessionTarget: "main" | "isolated";
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount?: number;
}

// ── Cron Manager Component ────────────────────────────────
function CronManager({ request, loading }: { request: (method: string, params?: any) => Promise<any>; loading?: boolean }) {
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [showRunsFor, setShowRunsFor] = useState<string | null>(null);
  const [jobRuns, setJobRuns] = useState<any[]>([]);
  const [filter, setFilter] = useState<"active" | "disabled" | "all">("active");
  
  // Helper: convert ms to value + unit
  const msToInterval = (ms: number): { value: number; unit: string } => {
    if (ms % 86400000 === 0) return { value: ms / 86400000, unit: "days" };
    if (ms % 3600000 === 0) return { value: ms / 3600000, unit: "hours" };
    if (ms % 60000 === 0) return { value: ms / 60000, unit: "minutes" };
    return { value: ms / 1000, unit: "seconds" };
  };
  
  // Helper: convert value + unit to ms
  const intervalToMs = (value: number, unit: string): number => {
    switch (unit) {
      case "seconds": return value * 1000;
      case "minutes": return value * 60000;
      case "hours": return value * 3600000;
      case "days": return value * 86400000;
      default: return value * 60000;
    }
  };
  
  const [form, setForm] = useState({
    name: "",
    scheduleKind: "every" as "at" | "every" | "daily" | "weekly" | "cron",
    cronExpr: "0 9 * * 1", // Montag 9:00
    intervalValue: 1,
    intervalUnit: "hours" as "seconds" | "minutes" | "hours" | "days",
    dailyTime: "09:00",
    weeklyTime: "09:00",
    weeklyDays: [1] as number[], // 0=So, 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa
    atDateTime: "",
    timezone: "Europe/Vienna",
    payloadKind: "systemEvent" as "systemEvent" | "agentTurn",
    text: "",
    sessionTarget: "main" as "main" | "isolated",
    enabled: true,
    deliver: false,
    deliverChannel: "telegram",
    // Auto-Cleanup Rules
    autoDelete: false,
    deleteCondition: "agent" as "agent" | "contains" | "regex" | "maxRuns",
    deletePattern: "",
    maxRuns: 10,
    // Auto-Pause Rules
    autoPause: false,
    pauseCondition: "agent" as "agent" | "time",
    pausePattern: "",
    // Stall Detection
    detectStall: false,
    stallThreshold: 3,
    stallAction: "watchdog" as "watchdog" | "restart" | "alert" | "custom",
    stallCustomAction: "",
  });

  // Form für neuen Job öffnen
  const openAddForm = () => {
    setEditingJob(null);
    setForm({
      name: "",
      scheduleKind: "every",
      cronExpr: "0 9 * * 1",
      intervalValue: 1,
      intervalUnit: "hours",
      dailyTime: "09:00",
      weeklyTime: "09:00",
      weeklyDays: [1],
      atDateTime: "",
      timezone: "Europe/Vienna",
      payloadKind: "agentTurn",
      text: "",
      sessionTarget: "isolated",
      enabled: true,
      deliver: true,
      deliverChannel: "telegram",
      autoDelete: false,
      deleteCondition: "contains",
      deletePattern: "",
      maxRuns: 10,
      autoPause: false,
      pauseCondition: "agent",
      pausePattern: "",
      detectStall: false,
      stallThreshold: 3,
      stallAction: "watchdog",
      stallCustomAction: "",
    });
    setShowForm(true);
  };

  // Helper: Parse cron expression to detect daily/weekly patterns
  const parseCronExpr = (expr: string): { kind: "daily" | "weekly" | "cron"; time: string; days: number[] } => {
    const parts = expr.split(" ");
    if (parts.length !== 5) return { kind: "cron", time: "09:00", days: [1] };
    const [min, hour, dayOfMonth, month, dayOfWeek] = parts;
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    
    // Daily: "M H * * *"
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return { kind: "daily", time, days: [1] };
    }
    // Weekly: "M H * * D" or "M H * * D,D,D"
    if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
      const days = dayOfWeek.split(",").map(d => parseInt(d)).filter(d => !isNaN(d));
      return { kind: "weekly", time, days: days.length > 0 ? days : [1] };
    }
    return { kind: "cron", time: "09:00", days: [1] };
  };

  // Form für Edit öffnen
  const openEditForm = (job: CronJob) => {
    setEditingJob(job);
    const interval = msToInterval(job.schedule.everyMs || 3600000);
    
    // Detect if cron expression is actually daily/weekly
    let scheduleKind = job.schedule.kind as any;
    let dailyTime = "09:00";
    let weeklyTime = "09:00";
    let weeklyDays = [1];
    
    if (job.schedule.kind === "cron" && job.schedule.expr) {
      const parsed = parseCronExpr(job.schedule.expr);
      if (parsed.kind === "daily") {
        scheduleKind = "daily";
        dailyTime = parsed.time;
      } else if (parsed.kind === "weekly") {
        scheduleKind = "weekly";
        weeklyTime = parsed.time;
        weeklyDays = parsed.days;
      }
    }
    
    // Parse AUTO-CLEANUP settings from prompt text (since Gateway doesn't store autoCleanup)
    let rawText = job.payload.text || job.payload.message || "";
    let autoDelete = false;
    let deleteCondition: "agent" | "contains" | "regex" | "maxRuns" = "contains";
    let deletePattern = "";
    let maxRuns = 10;
    
    // Match: [AUTO-CLEANUP: Prüfe nach jeder Ausführung: "BEDINGUNG". ...]
    const agentMatch = rawText.match(/\[AUTO-CLEANUP: Prüfe nach jeder Ausführung: "([^"]*)"\./);
    if (agentMatch) {
      autoDelete = true;
      deleteCondition = "agent";
      deletePattern = agentMatch[1];
    }
    
    // Match: [AUTO-CLEANUP: Falls die Ausgabe "PATTERN" enthält, ...]
    const containsMatch = rawText.match(/\[AUTO-CLEANUP: Falls die Ausgabe "([^"]*)" enthält/);
    if (containsMatch) {
      autoDelete = true;
      deleteCondition = "contains";
      deletePattern = containsMatch[1];
    }
    
    // Match: [AUTO-CLEANUP: Falls die Ausgabe das Regex-Pattern /PATTERN/ matcht, ...]
    const regexMatch = rawText.match(/\[AUTO-CLEANUP: Falls die Ausgabe das Regex-Pattern \/([^/]*)\/ matcht/);
    if (regexMatch) {
      autoDelete = true;
      deleteCondition = "regex";
      deletePattern = regexMatch[1];
    }
    
    // Match: [AUTO-CLEANUP: Dieser Job soll nach X Ausführungen ...]
    const maxRunsMatch = rawText.match(/\[AUTO-CLEANUP: Dieser Job soll nach (\d+) Ausführungen/);
    if (maxRunsMatch) {
      autoDelete = true;
      deleteCondition = "maxRuns";
      maxRuns = parseInt(maxRunsMatch[1]);
    }
    
    // Parse AUTO-PAUSE
    let autoPause = false;
    let pauseCondition: "agent" | "time" = "agent";
    let pausePattern = "";
    
    const pauseMatch = rawText.match(/\[AUTO-PAUSE: Überspringe Ausführung wenn: "([^"]*)"\./);
    if (pauseMatch) {
      autoPause = true;
      pauseCondition = "agent";
      pausePattern = pauseMatch[1];
    }
    
    // Parse STALL-DETECTION
    let detectStall = false;
    let stallThreshold = 3;
    let stallAction: "watchdog" | "restart" | "alert" | "custom" = "watchdog";
    let stallCustomAction = "";
    
    // Match both old format "gleichen Ergebnissen" and new "keinem Fortschritt"
    const stallMatch = rawText.match(/\[STALL-DETECTION: Bei (\d+)x? (?:gleichen Ergebnissen|keinem Fortschritt): ([^.]+)/);
    if (stallMatch) {
      detectStall = true;
      stallThreshold = parseInt(stallMatch[1]);
      const actionText = stallMatch[2];
      if (actionText.includes("Watchdog") || actionText.includes("watchdog")) stallAction = "watchdog";
      else if (actionText.includes("Neustart") || actionText.includes("neu starten")) stallAction = "restart";
      else if (actionText.includes("Alarm") || actionText.includes("alarm")) stallAction = "alert";
      else {
        stallAction = "custom";
        stallCustomAction = actionText.trim();
      }
    }
    
    // Strip AUTO-CLEANUP, AUTO-PAUSE and STALL-DETECTION suffix from text for editing
    rawText = rawText.replace(/\n\n\[AUTO-CLEANUP:.*?\]/gs, "").trim();
    rawText = rawText.replace(/\n\n\[AUTO-PAUSE:.*?\]/gs, "").trim();
    rawText = rawText.replace(/\n\n\[STALL-DETECTION:.*?\]/gs, "").trim();
    
    setForm({
      name: job.name || "",
      scheduleKind,
      cronExpr: job.schedule.expr || "0 9 * * 1",
      intervalValue: interval.value,
      intervalUnit: interval.unit as any,
      dailyTime,
      weeklyTime,
      weeklyDays,
      atDateTime: job.schedule.atMs ? new Date(job.schedule.atMs).toISOString().slice(0, 16) : "",
      timezone: job.schedule.tz || "Europe/Vienna",
      payloadKind: job.payload.kind,
      text: rawText,
      sessionTarget: job.sessionTarget,
      enabled: job.enabled,
      deliver: job.payload.deliver || false,
      deliverChannel: job.payload.channel || "telegram",
      // Auto-Cleanup Rules (parsed from prompt text)
      autoDelete,
      deleteCondition,
      deletePattern,
      maxRuns,
      // Auto-Pause Rules
      autoPause,
      pauseCondition,
      pausePattern,
      // Stall Detection
      detectStall,
      stallThreshold,
      stallAction,
      stallCustomAction,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingJob(null);
  };

  // Cron Jobs laden
  const loadCronJobs = useCallback(async () => {
    setCronLoading(true);
    try {
      const res = await request("cron.list", { includeDisabled: true });
      const jobs = res?.jobs || res || [];
      setCronJobs(Array.isArray(jobs) ? jobs : []);
      console.log("[Cron] Jobs geladen:", jobs.length);
    } catch (err: any) {
      console.error("[Cron] Laden fehlgeschlagen:", err.message);
    } finally {
      setCronLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadCronJobs();
  }, [loadCronJobs]);

  // Job erstellen oder aktualisieren
  const handleSubmit = async () => {
    if (!form.text.trim()) return;
    
    let schedule: CronJob["schedule"];
    if (form.scheduleKind === "cron") {
      schedule = { kind: "cron", expr: form.cronExpr, tz: form.timezone };
    } else if (form.scheduleKind === "every") {
      schedule = { kind: "every", everyMs: intervalToMs(form.intervalValue, form.intervalUnit) };
    } else if (form.scheduleKind === "daily") {
      // Generate cron: "M H * * *"
      const [hour, min] = form.dailyTime.split(":").map(Number);
      schedule = { kind: "cron", expr: `${min} ${hour} * * *`, tz: form.timezone };
    } else if (form.scheduleKind === "weekly") {
      // Generate cron: "M H * * D,D,D"
      const [hour, min] = form.weeklyTime.split(":").map(Number);
      const days = form.weeklyDays.length > 0 ? form.weeklyDays.sort().join(",") : "1";
      schedule = { kind: "cron", expr: `${min} ${hour} * * ${days}`, tz: form.timezone };
    } else {
      schedule = { kind: "at", atMs: new Date(form.atDateTime).getTime() };
    }

    // Build message with auto-pause instruction if enabled
    let messageText = form.text;
    if (form.autoPause && form.pausePattern) {
      messageText += `\n\n[AUTO-PAUSE: Überspringe Ausführung wenn: "${form.pausePattern}". Falls diese Bedingung zutrifft, führe NICHTS aus und antworte nur mit HEARTBEAT_OK.]`;
    }
    
    // Build message with stall-detection instruction if enabled
    if (form.detectStall) {
      let actionText = "";
      switch (form.stallAction) {
        case "watchdog":
          actionText = "Führe Watchdog aus: node scripts/reindex-watchdog.js";
          break;
        case "restart":
          actionText = "Starte den hängenden Prozess neu";
          break;
        case "alert":
          actionText = "Sende Alarm an Juergen: 'ACHTUNG: Job hängt!'";
          break;
        case "custom":
          actionText = form.stallCustomAction || "Melde Stillstand";
          break;
      }
      messageText += `\n\n[STALL-DETECTION: Bei ${form.stallThreshold}x keinem Fortschritt: ${actionText}. Prüfe mit cron.runs die letzten ${form.stallThreshold} Ergebnisse. Vergleiche SEMANTISCH: Hat sich der Fortschritt geändert? Falls kein Fortschritt → führe die Aktion aus und PROTOKOLLIERE: "🔧 SELF-HEALING: [Grund] → [Aktion] → [Ergebnis]". Falls die Aktion NICHT erfolgreich war, erstelle ein Dashboard-Todo mit POST an /internal/jobs: {"title":"Self-Healing fehlgeschlagen: [Job-Name]","description":"[Details]","priority":"high"}]`;
    }
    
    // Build message with auto-cleanup instruction if enabled
    if (form.autoDelete) {
      if (form.deleteCondition === "agent" && form.deletePattern) {
        messageText += `\n\n[AUTO-CLEANUP: Prüfe nach jeder Ausführung: "${form.deletePattern}". Falls diese Bedingung erfüllt ist, deaktiviere diesen Cron-Job mit: cron action=update id=<job-id> patch={enabled:false}]`;
      } else if (form.deleteCondition === "contains" && form.deletePattern) {
        messageText += `\n\n[AUTO-CLEANUP: Falls die Ausgabe "${form.deletePattern}" enthält, deaktiviere diesen Cron-Job mit: cron action=update id=<job-id> patch={enabled:false}]`;
      } else if (form.deleteCondition === "regex" && form.deletePattern) {
        messageText += `\n\n[AUTO-CLEANUP: Falls die Ausgabe das Regex-Pattern /${form.deletePattern}/ matcht, deaktiviere diesen Cron-Job mit: cron action=update id=<job-id> patch={enabled:false}]`;
      } else if (form.deleteCondition === "maxRuns" && form.maxRuns) {
        messageText += `\n\n[AUTO-CLEANUP: Dieser Job soll nach ${form.maxRuns} Ausführungen deaktiviert werden.]`;
      }
    }

    const payload = form.payloadKind === "systemEvent" 
      ? { kind: "systemEvent" as const, text: messageText }
      : { 
          kind: "agentTurn" as const, 
          message: messageText,
          ...(form.deliver && { deliver: true, channel: form.deliverChannel }),
        };

    const jobData: any = {
      name: form.name || undefined,
      schedule,
      payload,
      sessionTarget: form.payloadKind === "systemEvent" ? "main" as const : "isolated" as const,
      enabled: form.enabled,
    };
    
    // Auto-cleanup is stored locally in Dashboard, not sent to Gateway
    // (Gateway doesn't support autoCleanup field)
    const autoCleanupData = form.autoDelete ? {
      condition: form.deleteCondition,
      pattern: form.deletePattern || undefined,
      maxRuns: form.maxRuns || undefined,
    } : undefined;

    try {
      if (editingJob) {
        // Update existing job - use 'id' not 'jobId' for Gateway compatibility
        await request("cron.update", { id: editingJob.id, patch: jobData });
        console.log("[Cron] Job aktualisiert:", editingJob.id);
      } else {
        // Create new job
        await request("cron.add", { job: jobData });
        console.log("[Cron] Job erstellt");
      }
      closeForm();
      loadCronJobs();
    } catch (err: any) {
      console.error("[Cron] Speichern fehlgeschlagen:", err.message);
      alert("Fehler: " + err.message);
    }
  };

  // Job löschen (nur intern, nicht im UI)
  const handleDelete = async (id: string) => {
    if (!confirm("Cron-Job wirklich löschen?")) return;
    try {
      await request("cron.remove", { id });
      loadCronJobs();
    } catch (err: any) {
      console.error("[Cron] Löschen fehlgeschlagen:", err.message);
    }
  };

  // Run-History anzeigen
  const handleShowRuns = async (jobId: string) => {
    try {
      const result = await request("cron.runs", { jobId });
      // API returns { entries: [...] }
      setJobRuns(result?.entries || result?.runs || []);
      setShowRunsFor(jobId);
    } catch (err: any) {
      console.error("[Cron] Runs laden fehlgeschlagen:", err.message);
      setJobRuns([]);
      setShowRunsFor(jobId);
    }
  };

  // Job aktivieren/deaktivieren
  const handleToggle = async (job: CronJob) => {
    try {
      await request("cron.update", { id: job.id, patch: { enabled: !job.enabled } });
      loadCronJobs();
    } catch (err: any) {
      console.error("[Cron] Toggle fehlgeschlagen:", err.message);
    }
  };

  // Job sofort ausführen
  const handleRunNow = async (id: string) => {
    const job = cronJobs.find(j => j.id === id);
    if (!job) return;

    try {
      // Erst versuchen über cron.run
      const result = await request("cron.run", { id });
      
      // Wenn "not-due", dann einen neuen einmaligen Test-Job erstellen
      if (result?.ran === false && result?.reason === "not-due") {
        console.log("[Cron] Job not due, creating one-shot test job...");
        
        // Neuen einmaligen Job mit gleichem Payload erstellen
        const testJob = {
          name: `🧪 Test: ${job.name || job.id.slice(0, 8)}`,
          schedule: { 
            kind: "at" as const, 
            atMs: Date.now() + 1000 // In 1 Sekunde
          },
          payload: job.payload,
          sessionTarget: job.sessionTarget,
          enabled: true,
        };
        
        await request("cron.add", { job: testJob });
        alert("✅ Test-Job erstellt! Wird in 1 Sekunde ausgeführt.");
        
        // Liste neu laden
        setTimeout(() => loadCronJobs(), 2000);
      } else {
        alert("✅ Job wurde ausgelöst!");
        loadCronJobs();
      }
    } catch (err: any) {
      console.error("[Cron] Ausführen fehlgeschlagen:", err.message);
      alert("Fehler: " + err.message);
    }
  };

  // Schedule-Beschreibung
  const describeSchedule = (schedule: CronJob["schedule"]): string => {
    if (schedule.kind === "cron") {
      // Try to display friendly format for daily/weekly patterns
      const expr = schedule.expr || "";
      const parts = expr.split(" ");
      if (parts.length === 5) {
        const [min, hour, dom, mon, dow] = parts;
        
        // Check for hourly pattern: "0 * * * *" or "30 * * * *"
        if (hour === "*" && dom === "*" && mon === "*" && dow === "*") {
          if (min === "0") return `🔄 Stündlich`;
          if (min.match(/^\d+$/)) return `🔄 Stündlich um :${min.padStart(2, "0")}`;
          return `🔄 ${min} Min jede Stunde`;
        }
        
        // Only show as "daily" if hour is a specific number (not wildcard)
        if (hour.match(/^\d+$/) && min.match(/^\d+$/) && dom === "*" && mon === "*" && dow === "*") {
          const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
          return `☀️ Täglich um ${time}`;
        }
        
        // Weekly pattern
        if (hour.match(/^\d+$/) && min.match(/^\d+$/) && dom === "*" && mon === "*" && dow !== "*") {
          const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
          const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
          const days = dow.split(",").map(d => dayNames[parseInt(d)] || d).join(", ");
          return `📆 ${days} um ${time}`;
        }
      }
      return `⚙️ Cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
    } else if (schedule.kind === "every") {
      const ms = schedule.everyMs || 0;
      if (ms >= 86400000) return `Alle ${Math.floor(ms / 86400000)} Tag(e)`;
      if (ms >= 3600000) return `Alle ${Math.floor(ms / 3600000)} Stunde(n)`;
      if (ms >= 60000) return `Alle ${Math.floor(ms / 60000)} Minute(n)`;
      return `Alle ${ms}ms`;
    } else if (schedule.kind === "at") {
      // Unterstütze sowohl atMs (number) als auch at (ISO-String)
      const atValue = schedule.atMs || schedule.at;
      return `Einmalig: ${atValue ? new Date(atValue).toLocaleString("de-AT") : "Nicht gesetzt"}`;
    }
    return "Unbekannt";
  };

  // Cron-Presets
  const CRON_PRESETS = [
    { label: "Täglich 9:00", value: "0 9 * * *" },
    { label: "Montags 9:00", value: "0 9 * * 1" },
    { label: "Stündlich", value: "0 * * * *" },
    { label: "Alle 30 Min", value: "*/30 * * * *" },
    { label: "Werktags 8:00", value: "0 8 * * 1-5" },
  ];

  return (
    <div className="oc-cron">
      <div className="oc-section-header">
        <h2 className="oc-view-title">Cron Jobs {(cronLoading || loading) && <span className="oc-loading-sm">⏳</span>}</h2>
        <div style={{ display: "flex", gap: "4px", marginLeft: "auto", marginRight: "16px" }}>
          {(["active", "disabled", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: filter === f ? 600 : 400,
                background: filter === f ? "var(--accent)" : "var(--bg2)",
                color: filter === f ? "#fff" : "var(--tx)",
                transition: "all 0.15s"
              }}
            >
              {f === "active" ? "✓ Aktive" : f === "disabled" ? "○ Deaktivierte" : "Alle"}
              {f === "active" && ` (${cronJobs.filter(j => j.enabled).length})`}
              {f === "disabled" && ` (${cronJobs.filter(j => !j.enabled).length})`}
              {f === "all" && ` (${cronJobs.length})`}
            </button>
          ))}
        </div>
        <button className="oc-btn-primary" onClick={openAddForm}>+ Neuer Cron-Job</button>
      </div>

      {/* Add/Edit Form - Modal Overlay */}
      {showForm && (
        <div 
          className="oc-modal-overlay" 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px"
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
        >
        <div className="oc-add-panel oc-cron-form" style={{
          maxHeight: "90vh",
          overflowY: "auto",
          maxWidth: "700px",
          width: "100%",
          margin: 0
        }}>
          <h3 className="oc-form-title">{editingJob ? "✏️ Cron-Job bearbeiten" : "➕ Neuer Cron-Job"}</h3>
          
          {/* Name-Zeile */}
          <div className="oc-add-row">
            <input 
              className="oc-input" 
              placeholder="Name (optional)" 
              value={form.name} 
              onChange={(e) => setForm({ ...form, name: e.target.value })} 
              style={{ flex: 1 }}
            />
          </div>

          {/* === ZEITPLAN === */}
          <div style={{ borderTop: "1px solid var(--bg3)", margin: "12px 0 8px", paddingTop: "12px" }}>
            <span style={{ fontSize: "11px", color: "var(--txd)", textTransform: "uppercase", letterSpacing: "0.5px" }}>⏰ Zeitplan</span>
          </div>
          <div className="oc-add-row" style={{ gap: "8px", alignItems: "center" }}>
            <select 
              className="oc-input oc-select" 
              value={form.scheduleKind} 
              onChange={(e) => setForm({ ...form, scheduleKind: e.target.value as any })}
              style={{ width: "150px" }}
            >
              <option value="every">🔄 Intervall</option>
              <option value="daily">☀️ Täglich</option>
              <option value="weekly">📆 Wöchentlich</option>
              <option value="at">📅 Einmalig</option>
              <option value="cron">⚙️ Cron</option>
            </select>

            {/* Intervall-Einstellungen inline */}
            {form.scheduleKind === "every" && (
              <>
                <input 
                  type="number" 
                  className="oc-input" 
                  value={form.intervalValue} 
                  onChange={(e) => setForm({ ...form, intervalValue: Math.max(1, parseInt(e.target.value) || 1) })}
                  min={1}
                  style={{ width: "70px", textAlign: "center" }}
                />
                <select 
                  className="oc-input oc-select" 
                  value={form.intervalUnit} 
                  onChange={(e) => setForm({ ...form, intervalUnit: e.target.value as any })}
                  style={{ width: "110px" }}
                >
                  <option value="seconds">Sekunden</option>
                  <option value="minutes">Minuten</option>
                  <option value="hours">Stunden</option>
                  <option value="days">Tage</option>
                </select>
              </>
            )}

            {/* Täglich-Einstellungen inline */}
            {form.scheduleKind === "daily" && (
              <>
                <span style={{ color: "var(--txd)" }}>um</span>
                <input 
                  type="time" 
                  className="oc-input" 
                  value={form.dailyTime} 
                  onChange={(e) => setForm({ ...form, dailyTime: e.target.value })}
                  style={{ width: "110px" }}
                />
                <span style={{ color: "var(--txd)" }}>Uhr</span>
              </>
            )}

            {/* Wöchentlich-Zeit inline */}
            {form.scheduleKind === "weekly" && (
              <>
                <span style={{ color: "var(--txd)" }}>um</span>
                <input 
                  type="time" 
                  className="oc-input" 
                  value={form.weeklyTime} 
                  onChange={(e) => setForm({ ...form, weeklyTime: e.target.value })}
                  style={{ width: "110px" }}
                />
                <span style={{ color: "var(--txd)" }}>Uhr</span>
              </>
            )}

            {/* Einmalig-Datetime inline */}
            {form.scheduleKind === "at" && (
              <input 
                type="datetime-local" 
                className="oc-input" 
                value={form.atDateTime} 
                onChange={(e) => setForm({ ...form, atDateTime: e.target.value })}
                style={{ flex: 1 }}
              />
            )}

            {/* Cron-Expression inline */}
            {form.scheduleKind === "cron" && (
              <>
                <input 
                  className="oc-input" 
                  placeholder="z.B. 0 9 * * 1" 
                  value={form.cronExpr} 
                  onChange={(e) => setForm({ ...form, cronExpr: e.target.value })}
                  style={{ flex: 1 }}
                />
                <select 
                  className="oc-input oc-select" 
                  value="" 
                  onChange={(e) => setForm({ ...form, cronExpr: e.target.value })}
                  style={{ width: "140px" }}
                >
                  <option value="">Preset...</option>
                  {CRON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </>
            )}
          </div>

          {/* Wöchentlich: Tage-Auswahl in eigener Zeile */}
          {form.scheduleKind === "weekly" && (
            <div className="oc-add-row" style={{ gap: "6px", flexWrap: "wrap" }}>
              {["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"].map((day, idx) => (
                <label 
                  key={idx} 
                  style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    padding: "6px 12px",
                    background: form.weeklyDays.includes(idx) ? "var(--accent)" : "var(--bg2)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: form.weeklyDays.includes(idx) ? "#fff" : "var(--tx)",
                    fontWeight: form.weeklyDays.includes(idx) ? 600 : 400,
                    transition: "all 0.15s"
                  }}
                >
                  <input 
                    type="checkbox" 
                    checked={form.weeklyDays.includes(idx)}
                    onChange={(e) => {
                      const newDays = e.target.checked 
                        ? [...form.weeklyDays, idx]
                        : form.weeklyDays.filter(d => d !== idx);
                      setForm({ ...form, weeklyDays: newDays.length > 0 ? newDays : [1] });
                    }}
                    style={{ display: "none" }}
                  />
                  {day}
                </label>
              ))}
            </div>
          )}

          {/* === AUSFÜHRUNG === */}
          <div style={{ borderTop: "1px solid var(--bg3)", margin: "12px 0 8px", paddingTop: "12px" }}>
            <span style={{ fontSize: "11px", color: "var(--txd)", textTransform: "uppercase", letterSpacing: "0.5px" }}>⚡ Ausführung</span>
          </div>
          <div className="oc-add-row">
            <select 
              className="oc-input oc-select" 
              value={form.payloadKind} 
              onChange={(e) => setForm({ ...form, payloadKind: e.target.value as any })}
              style={{ width: 200 }}
            >
              <option value="systemEvent">💬 System Event (Main Session)</option>
              <option value="agentTurn">🤖 Agent Turn (Isoliert)</option>
            </select>
            <label className="oc-checkbox-label">
              <input 
                type="checkbox" 
                checked={form.enabled} 
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Aktiviert
            </label>
          </div>

          {/* Delivery-Optionen für Agent Turn */}
          {form.payloadKind === "agentTurn" && (
            <div className="oc-add-row oc-deliver-row">
              <label className="oc-checkbox-label">
                <input 
                  type="checkbox" 
                  checked={form.deliver} 
                  onChange={(e) => setForm({ ...form, deliver: e.target.checked })}
                />
                📤 Ergebnis senden an:
              </label>
              {form.deliver && (
                <select 
                  className="oc-input oc-select" 
                  value={form.deliverChannel} 
                  onChange={(e) => setForm({ ...form, deliverChannel: e.target.value })}
                  style={{ width: 150 }}
                >
                  <option value="telegram">✈️ Telegram</option>
                  <option value="msteams">🏢 Teams</option>
                  <option value="discord">🎮 Discord</option>
                  <option value="slack">💼 Slack</option>
                  <option value="whatsapp">📱 WhatsApp</option>
                  <option value="signal">🔒 Signal</option>
                  <option value="googlechat">💬 Google Chat</option>
                  <option value="imessage">🍎 iMessage</option>
                </select>
              )}
            </div>
          )}

          {/* === OPTIONEN === */}
          <div style={{ borderTop: "1px solid var(--bg3)", margin: "12px 0 8px", paddingTop: "12px" }}>
            <span style={{ fontSize: "11px", color: "var(--txd)", textTransform: "uppercase", letterSpacing: "0.5px" }}>⚙️ Optionen</span>
          </div>
          <div className="oc-add-row" style={{ padding: '12px', backgroundColor: 'rgba(99, 102, 241, 0.1)', borderRadius: '8px', flexDirection: 'column', alignItems: 'flex-start' }}>
            <label className="oc-checkbox-label">
              <input 
                type="checkbox" 
                checked={form.autoDelete} 
                onChange={(e) => setForm({ ...form, autoDelete: e.target.checked })}
              />
              ⏸️ Automatisch deaktivieren wenn:
            </label>
            {form.autoDelete && (
              <div style={{ marginTop: '8px', width: '100%' }}>
                <select 
                  className="oc-input oc-select" 
                  value={form.deleteCondition} 
                  onChange={(e) => setForm({ ...form, deleteCondition: e.target.value as "contains" | "regex" | "agent" | "maxRuns" })}
                  style={{ width: '100%', marginBottom: '8px' }}
                >
                  <option value="agent">🤖 Agent prüft Bedingung...</option>
                  <option value="contains">Ausgabe enthält Text...</option>
                  <option value="regex">Ausgabe matcht Regex...</option>
                  <option value="maxRuns">Nach X Ausführungen</option>
                </select>
                
                {form.deleteCondition === "agent" && (
                  <>
                    <input
                      className="oc-input"
                      type="text"
                      value={form.deletePattern}
                      onChange={(e) => setForm({ ...form, deletePattern: e.target.value })}
                      placeholder="z.B. 'Wenn mehr als 300 Tickets bearbeitet wurden' oder 'Wenn der Job fertig ist'"
                      style={{ width: '100%' }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--txd)', marginTop: '4px' }}>
                      💡 Beschreibe die Bedingung in natürlicher Sprache - der Agent wertet sie aus.
                    </div>
                  </>
                )}
                
                {form.deleteCondition === "contains" && (
                  <input
                    className="oc-input"
                    type="text"
                    value={form.deletePattern}
                    onChange={(e) => setForm({ ...form, deletePattern: e.target.value })}
                    placeholder="z.B. '100%' oder 'fertig' oder '358/358'"
                    style={{ width: '100%' }}
                  />
                )}
                
                {form.deleteCondition === "regex" && (
                  <>
                    <input
                      className="oc-input"
                      type="text"
                      value={form.deletePattern}
                      onChange={(e) => setForm({ ...form, deletePattern: e.target.value })}
                      placeholder="z.B. 'JETZ: [3-9]\\d{2}/358' oder '(100%|358/358)'"
                      style={{ width: '100%' }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--txd)', marginTop: '4px' }}>
                      💡 Regex-Beispiele: <code>[3-9]\d{"{2}"}</code> = 300-999 | <code>(fertig|100%)</code> = eines von beiden
                    </div>
                  </>
                )}
                
                {form.deleteCondition === "maxRuns" && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      className="oc-input"
                      type="number"
                      value={form.maxRuns}
                      onChange={(e) => setForm({ ...form, maxRuns: Number(e.target.value) })}
                      min={1}
                      max={1000}
                      style={{ width: '80px' }}
                    />
                    <span>Ausführungen</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Auto-Pause Option */}
          <div className="oc-add-row" style={{ padding: '12px', backgroundColor: 'rgba(234, 179, 8, 0.1)', borderRadius: '8px', flexDirection: 'column', alignItems: 'flex-start', marginTop: '8px' }}>
            <label className="oc-checkbox-label">
              <input 
                type="checkbox" 
                checked={form.autoPause} 
                onChange={(e) => setForm({ ...form, autoPause: e.target.checked })}
              />
              ⏰ Ausführung überspringen wenn:
            </label>
            {form.autoPause && (
              <div style={{ marginTop: '8px', width: '100%' }}>
                <input
                  className="oc-input"
                  type="text"
                  value={form.pausePattern}
                  onChange={(e) => setForm({ ...form, pausePattern: e.target.value })}
                  placeholder="z.B. 'Außerhalb 09:00-18:00 Uhr' oder 'Am Wochenende' oder 'Nachts'"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--txd)', marginTop: '4px' }}>
                  💡 Der Agent prüft diese Bedingung VOR jeder Ausführung. Bei Zutreffen wird übersprungen (temporär).
                </div>
              </div>
            )}
          </div>

          {/* Stall-Detection Option */}
          <div className="oc-add-row" style={{ padding: '12px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', flexDirection: 'column', alignItems: 'flex-start', marginTop: '8px' }}>
            <label className="oc-checkbox-label">
              <input 
                type="checkbox" 
                checked={form.detectStall} 
                onChange={(e) => setForm({ ...form, detectStall: e.target.checked })}
              />
              🔄 Stillstand erkennen (Self-Healing):
            </label>
            {form.detectStall && (
              <div style={{ marginTop: '8px', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--txd)', fontSize: '13px' }}>Bei</span>
                  <input
                    className="oc-input"
                    type="number"
                    value={form.stallThreshold}
                    onChange={(e) => setForm({ ...form, stallThreshold: Math.max(2, Number(e.target.value)) })}
                    min={2}
                    max={10}
                    style={{ width: '60px', textAlign: 'center' }}
                  />
                  <span style={{ color: 'var(--txd)', fontSize: '13px' }}>Ausführungen ohne Fortschritt:</span>
                </div>
                <select 
                  className="oc-input oc-select" 
                  value={form.stallAction} 
                  onChange={(e) => setForm({ ...form, stallAction: e.target.value as any })}
                  style={{ width: '100%', marginBottom: '8px' }}
                >
                  <option value="watchdog">🔧 Watchdog ausführen (node scripts/reindex-watchdog.js)</option>
                  <option value="restart">🔄 Prozess neu starten</option>
                  <option value="alert">🚨 Alarm an Juergen senden</option>
                  <option value="custom">✏️ Eigene Aktion...</option>
                </select>
                {form.stallAction === "custom" && (
                  <input
                    className="oc-input"
                    type="text"
                    value={form.stallCustomAction}
                    onChange={(e) => setForm({ ...form, stallCustomAction: e.target.value })}
                    placeholder="z.B. 'Führe cleanup.js aus' oder 'Starte Docker-Container neu'"
                    style={{ width: '100%' }}
                  />
                )}
                <div style={{ fontSize: '11px', color: 'var(--txd)', marginTop: '4px' }}>
                  💡 Agent vergleicht letzte Ergebnisse <strong>semantisch</strong> (nicht exakt) - erkennt fehlenden Fortschritt trotz unterschiedlicher Formulierung.
                </div>
              </div>
            )}
          </div>

          {/* === AUFGABE === */}
          <div style={{ borderTop: "1px solid var(--bg3)", margin: "12px 0 8px", paddingTop: "12px" }}>
            <span style={{ fontSize: "11px", color: "var(--txd)", textTransform: "uppercase", letterSpacing: "0.5px" }}>📝 Aufgabe</span>
          </div>
          <textarea 
            className="oc-input oc-textarea" 
            placeholder={form.payloadKind === "systemEvent" ? "Event Text (wird in Main Session injiziert)" : "Agent Prompt (wird in isolierter Session ausgeführt)"} 
            value={form.text} 
            onChange={(e) => setForm({ ...form, text: e.target.value })} 
            rows={3}
          />

          {/* Info-Hinweise für Auto-Pause, Stall-Detection und Auto-Cleanup */}
          {(form.autoPause || form.detectStall || form.autoDelete) && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {form.autoPause && form.pausePattern && (
                <div style={{ 
                  padding: "10px 12px", 
                  backgroundColor: "rgba(234, 179, 8, 0.15)", 
                  borderRadius: "6px", 
                  fontSize: "12px",
                  color: "var(--tx)",
                  border: "1px solid rgba(234, 179, 8, 0.3)"
                }}>
                  <strong>⏰ Auto-Pause aktiv:</strong> Überspringe wenn: "{form.pausePattern}"
                </div>
              )}
              {form.detectStall && (
                <div style={{ 
                  padding: "10px 12px", 
                  backgroundColor: "rgba(59, 130, 246, 0.15)", 
                  borderRadius: "6px", 
                  fontSize: "12px",
                  color: "var(--tx)",
                  border: "1px solid rgba(59, 130, 246, 0.3)"
                }}>
                  <strong>🔄 Stillstand-Erkennung aktiv:</strong> Bei {form.stallThreshold}x ohne Fortschritt → {
                    form.stallAction === "watchdog" ? "Watchdog ausführen" :
                    form.stallAction === "restart" ? "Prozess neu starten" :
                    form.stallAction === "alert" ? "Alarm senden" :
                    form.stallCustomAction || "Eigene Aktion"
                  }
                </div>
              )}
              {form.autoDelete && (
                <div style={{ 
                  padding: "10px 12px", 
                  backgroundColor: "rgba(239, 68, 68, 0.15)", 
                  borderRadius: "6px", 
                  fontSize: "12px",
                  color: "var(--tx)",
                  border: "1px solid rgba(239, 68, 68, 0.3)"
                }}>
                  <strong>🛑 Auto-Deaktivierung aktiv:</strong>{" "}
                  {form.deleteCondition === "agent"
                    ? `Agent prüft: "${form.deletePattern || "..."}"`
                    : form.deleteCondition === "contains" 
                    ? `Wenn Ausgabe "${form.deletePattern || "..."}" enthält`
                    : form.deleteCondition === "regex"
                    ? `Wenn Ausgabe /${form.deletePattern || "..."}/ matcht`
                    : `Nach ${form.maxRuns} Ausführungen`
                  }
                </div>
              )}
            </div>
          )}

          <div className="oc-add-row">
            <button className="oc-btn-primary" onClick={handleSubmit} disabled={!form.text.trim()}>
              {editingJob ? "💾 Speichern" : "Erstellen"}
            </button>
            <button className="oc-btn-ghost" onClick={closeForm}>Abbrechen</button>
          </div>
        </div>
        </div>
      )}

      {/* Run-History Panel - Modal */}
      {showRunsFor && (
        <div 
          className="oc-modal-overlay" 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px"
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowRunsFor(null);
          }}
        >
        <div className="oc-add-panel" style={{ maxHeight: "80vh", overflowY: "auto", maxWidth: "800px", width: "100%", margin: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 className="oc-form-title" style={{ margin: 0 }}>
              📋 Ausführungs-Log: {cronJobs.find(j => j.id === showRunsFor)?.name || showRunsFor.slice(0, 8)}
            </h3>
            <button className="oc-btn-ghost" onClick={() => setShowRunsFor(null)}>✕ Schließen</button>
          </div>
          
          {jobRuns.length === 0 ? (
            <div style={{ color: "var(--txd)", padding: "20px", textAlign: "center" }}>
              Keine Ausführungen gefunden
            </div>
          ) : (
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--bg3)", textAlign: "left" }}>
                    <th style={{ padding: "8px", color: "var(--txd)" }}>Zeitpunkt</th>
                    <th style={{ padding: "8px", color: "var(--txd)" }}>Status</th>
                    <th style={{ padding: "8px", color: "var(--txd)" }}>Ergebnis</th>
                  </tr>
                </thead>
                <tbody>
                  {jobRuns.slice().reverse().map((run, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--bg2)" }}>
                      <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                        {(run.ts || run.runAtMs) ? new Date(run.ts || run.runAtMs).toLocaleString("de-AT", { 
                          dateStyle: "short", 
                          timeStyle: "medium" 
                        }) : "—"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span style={{ 
                          padding: "2px 8px", 
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontWeight: 600,
                          background: run.status === "ok" 
                            ? "rgba(34, 197, 94, 0.2)" 
                            : "rgba(239, 68, 68, 0.2)",
                          color: run.status === "ok" ? "#22c55e" : "#ef4444"
                        }}>
                          {run.status === "ok" ? "✓ OK" : run.status || "?"}
                        </span>
                        {run.durationMs && (
                          <span style={{ marginLeft: "8px", fontSize: "10px", color: "var(--txd)" }}>
                            {(run.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px", maxWidth: "500px" }}>
                        <div style={{ 
                          whiteSpace: "pre-wrap", 
                          wordBreak: "break-word",
                          fontSize: "12px",
                          maxHeight: "80px",
                          overflow: "auto"
                        }}>
                          {run.summary || run.result || run.error || "—"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* Job Liste */}
      <div className="oc-cron-list">
        {cronJobs.length === 0 && !cronLoading && (
          <div className="oc-empty">Keine Cron-Jobs konfiguriert</div>
        )}
        {cronJobs
          .filter(job => filter === "all" ? true : filter === "active" ? job.enabled : !job.enabled)
          .sort((a, b) => {
            // Sort by next run time (soonest first)
            const aNext = a.state?.nextRunAtMs || Infinity;
            const bNext = b.state?.nextRunAtMs || Infinity;
            return aNext - bNext;
          })
          .map((job) => (
          <div key={job.id} className={`oc-cron-card ${!job.enabled ? "oc-cron-card--disabled" : ""}`}>
            <div className="oc-cron-card-main">
              <div className="oc-cron-card-info">
                <span className="oc-cron-card-name">{job.name || `Job ${job.id.slice(0, 8)}`}</span>
                <span className={`oc-cron-status ${job.enabled ? "oc-cron-status--on" : "oc-cron-status--off"}`}>
                  {job.enabled ? "✓ Aktiv" : "○ Pausiert"}
                </span>
              </div>
              <div className="oc-cron-card-schedule">
                <span className="oc-cron-schedule-icon">⏰</span>
                <span>{describeSchedule(job.schedule)}</span>
              </div>
              <div className="oc-cron-card-payload">
                <span className="oc-cron-payload-type">
                  {job.payload.kind === "systemEvent" ? "💬" : "🤖"} {job.sessionTarget}
                </span>
                <span className="oc-cron-payload-text">
                  {(job.payload.text || job.payload.message || "").slice(0, 60)}
                  {(job.payload.text || job.payload.message || "").length > 60 ? "..." : ""}
                </span>
              </div>
            </div>
            {/* Footer: Meta links, Actions rechts */}
            <div style={{ 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center",
              borderTop: "1px solid var(--bg2)",
              marginTop: "8px",
              paddingTop: "8px"
            }}>
              <div className="oc-cron-card-meta" style={{ 
                display: "flex", 
                gap: "12px", 
                fontSize: "11px", 
                color: "var(--txd)"
              }}>
                <span title="Letzte Ausführung">
                  🕐 {job.state?.lastRunAtMs 
                    ? new Date(job.state.lastRunAtMs).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })
                    : "Noch nie"}
                </span>
                {job.state?.nextRunAtMs && (
                  <span title="Nächste Ausführung">
                    ⏭️ {new Date(job.state.nextRunAtMs).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                )}
                {job.state?.lastStatus && (
                  <span title="Letzter Status" style={{
                    padding: "1px 6px",
                    borderRadius: "3px",
                    background: job.state.lastStatus === "ok" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
                    color: job.state.lastStatus === "ok" ? "#22c55e" : "#ef4444"
                  }}>
                    {job.state.lastStatus === "ok" ? "✓" : "✗"}
                  </span>
                )}
              </div>
              <div className="oc-cron-card-actions">
              <button className="oc-cron-btn" onClick={() => openEditForm(job)} title="Bearbeiten">
                ✏️
              </button>
              <button className="oc-cron-btn" onClick={() => handleToggle(job)} title={job.enabled ? "Pausieren" : "Aktivieren"}>
                {job.enabled ? "⏸️" : "▶️"}
              </button>
              <button className="oc-cron-btn" onClick={() => handleRunNow(job.id)} title="Jetzt ausführen">
                🚀
              </button>
              <button className="oc-cron-btn" onClick={() => handleShowRuns(job.id)} title="Ausführungs-Log">
                📋
              </button>
              <button className="oc-cron-btn oc-cron-btn--danger" onClick={() => handleDelete(job.id)} title="Löschen">
                🗑️
              </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className="oc-cron-info">
        <h4>ℹ️ Cron vs. Dashboard Jobs</h4>
        <p><strong>Cron Jobs</strong> laufen automatisch nach Zeitplan (wiederkehrend oder einmalig).</p>
        <p><strong>Dashboard Jobs</strong> sind einmalige Tasks die manuell gestartet werden.</p>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────
type View = "kanban" | "templates" | "memory" | "sessions" | "chat" | "settings" | "cron" | "rag";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("chat");

  // Echte Daten (leer initialisiert, Jobs von API laden)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [cfg, setCfg] = useState<any>({});
  const [cfgHash, setCfgHash] = useState<string>("");
  const [gatewayVersion, setGatewayVersion] = useState<string>("");
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
      // Versuche sessions.history (korrekte API) mit Fallback zu sessions.preview
      let messages: any[] = [];
      
      // Session hat sowohl "key" (z.B. "agent:main:main") als auch "sessionId" (UUID)
      // Die API erwartet wahrscheinlich den sessionKey
      console.log("[App] Loading history for session:", session.id);
      
      try {
        const historyRes = await gwRequest("sessions.history", { 
          sessionKey: session.id,
          limit: 50,
          includeTools: false
        });
        console.log("[App] sessions.history Response:", historyRes);
        messages = historyRes?.messages || historyRes?.items || historyRes || [];
        if (!Array.isArray(messages)) messages = [];
      } catch (histErr: any) {
        console.log("[App] sessions.history failed:", histErr?.message || histErr);
        // Fallback: Versuche mit sessions.preview
        try {
          const previewRes = await gwRequest("sessions.preview", { 
            keys: [session.id], 
            limit: 50,
            maxChars: 500 
          });
          console.log("[App] sessions.preview Response:", previewRes);
          const preview = previewRes?.previews?.[0];
          messages = preview?.items || [];
        } catch (prevErr: any) {
          console.log("[App] sessions.preview also failed:", prevErr?.message || prevErr);
        }
      }
      
      if (messages.length > 0) {
        const parsed = messages
          .filter((item: any) => item.role === "user" || item.role === "assistant")
          .map((item: any) => {
            // Handle verschiedene Content-Formate
            let text = "";
            const content = item.content;
            if (Array.isArray(content)) {
              // Filter nur text-Einträge, ignoriere toolCalls und thinking
              text = content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text || "")
                .join("");
            } else if (typeof content === "string") {
              text = content;
            } else {
              text = item.text || "";
            }
            
            return {
              role: item.role as "user" | "assistant",
              text: text.slice(0, 500) || "(kein Text)",
              ts: item.ts || item.timestamp,
            };
          })
          .filter((msg: any) => msg.text && msg.text !== "(kein Text)");
        
        console.log("[App] Parsed messages:", parsed.length);
        setSessionPreview(parsed);
      } else {
        console.log("[App] No messages to parse");
        setSessionPreview([]);
      }
    } catch (err) {
      console.error("[App] Session preview error:", err);
      setSessionPreview([]);
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
        if (res?.hash) setCfgHash(res.hash);
        console.log("[App] Config geladen:", Object.keys(configData), "hash:", res?.hash?.slice(0, 8));
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
        const rawSessions = res?.sessions || [];
        console.log("[App] sessions.list - Erste Session RAW:", rawSessions[0]);
        console.log("[App] sessions.list - Session Keys:", rawSessions[0] ? Object.keys(rawSessions[0]) : []);
        const mapped = mapSessionsResponse(res);
        setSessions(mapped);
        console.log("[App] Sessions geladen:", mapped.length);
      } catch (err: any) {
        console.error("[App] Sessions laden FEHLER:", err);
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

    // Gateway-Version aus connect-Event extrahieren
    if (latest.type === "gateway:status" && latest.status === "connected" && latest.version) {
      setGatewayVersion(latest.version);
      console.log("[App] Gateway version:", latest.version);
    }

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
    { key: "templates", label: "Vorlagen", icon: "📋" },
    { key: "cron", label: "Cron", icon: "🔄" },
    { key: "memory", label: "Memory", icon: "◉" },
    { key: "rag", label: "Knowledge", icon: "🧠" },
    { key: "settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="oc-app">
      <header className="oc-header">
        <div className="oc-header-l">
          <span className="oc-logo">🦞</span>
          <div className="oc-brand-group">
            <h1 className="oc-brand">OpenClaw Dashboard</h1>
            {gatewayVersion && <span className="oc-version">v{gatewayVersion}</span>}
          </div>
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
        {view === "templates" && <TemplatesView onJobCreated={() => { api.jobs.list().then((res) => setJobs(res.jobs || [])); setView("kanban"); }} gwRequest={gwRequest} />}
        {view === "cron" && <CronManager request={gwRequest} loading={dataLoading} />}
        {view === "memory" && <WorkspaceFilesEditor loading={dataLoading} />}
        {view === "sessions" && <SessionsView sessions={sessions} loading={dataLoading} onSelectSession={handleSelectSession} selectedSession={selectedSession} sessionPreview={sessionPreview} previewLoading={previewLoading} />}
        {view === "rag" && <RagView />}
        {view === "settings" && <SettingsView config={cfg} configHash={cfgHash} onConfigChange={(c, h) => { setCfg(c); if (h) setCfgHash(h); }} loading={dataLoading} gwRequest={gwRequest} />}
      </main>
    </div>
  );
}
