// ============================================================
// TemplatesView — Job-Vorlagen verwalten
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import api, { Template, TemplateData } from "../lib/api";

// ── Types ─────────────────────────────────────────────────
interface TemplatesViewProps {
  onJobCreated?: () => void;
  gwRequest?: (method: string, params?: any) => Promise<any>;
}

const PRIO_OPTIONS = [
  { value: "low", label: "Niedrig", color: "#64748b" },
  { value: "medium", label: "Normal", color: "#3b82f6" },
  { value: "high", label: "Hoch", color: "#f59e0b" },
  { value: "critical", label: "Kritisch", color: "#ef4444" },
];

const ICON_OPTIONS = ["📋", "☀️", "📈", "📰", "📧", "🔍", "💡", "🎯", "📊", "🗓️", "💬", "🛒", "✈️", "🏠", "💪"];

const INTERVAL_OPTIONS = [
  { value: 60000, label: "Jede Minute" },
  { value: 300000, label: "Alle 5 Minuten" },
  { value: 900000, label: "Alle 15 Minuten" },
  { value: 1800000, label: "Alle 30 Minuten" },
  { value: 3600000, label: "Jede Stunde" },
  { value: 7200000, label: "Alle 2 Stunden" },
  { value: 14400000, label: "Alle 4 Stunden" },
  { value: 43200000, label: "Alle 12 Stunden" },
  { value: 86400000, label: "Täglich" },
];

const CRON_PRESETS = [
  { value: "0 8 * * *", label: "Täglich 8:00" },
  { value: "0 9 * * 1-5", label: "Werktags 9:00" },
  { value: "0 7 * * 1", label: "Montags 7:00" },
  { value: "0 18 * * 5", label: "Freitags 18:00" },
  { value: "0 0 1 * *", label: "Monatlich (1.)" },
  { value: "*/15 * * * *", label: "Alle 15 Min" },
];

// ── Template Card ─────────────────────────────────────────
function TemplateCard({ 
  template, 
  onRun, 
  onSchedule,
  onEdit, 
  onDelete,
  running,
}: { 
  template: Template;
  onRun: () => void;
  onSchedule: () => void;
  onEdit: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const prio = PRIO_OPTIONS.find(p => p.value === template.priority) || PRIO_OPTIONS[1];
  
  return (
    <div className="oc-template-card">
      <div className="oc-template-header">
        <span className="oc-template-icon">{template.icon || "📋"}</span>
        <span className="oc-template-name">{template.name}</span>
        <span className="oc-template-prio" style={{ color: prio.color }}>{prio.label}</span>
      </div>
      <p className="oc-template-desc">{template.description || "Keine Beschreibung"}</p>
      <div className="oc-template-meta">
        {template.category && <span className="oc-template-cat">{template.category}</span>}
        {template.channel && <span className="oc-template-chan">📱 {template.channel}</span>}
      </div>
      <div className="oc-template-actions">
        <button 
          className="oc-btn oc-btn--run" 
          onClick={onRun}
          disabled={running}
          title="Einmal ausführen"
        >
          {running ? "⏳" : "▶️"} Jetzt
        </button>
        <button 
          className="oc-btn oc-btn--cron" 
          onClick={onSchedule}
          title="Als Cron-Job planen"
        >
          🔄 Cron
        </button>
        <button className="oc-btn oc-btn--edit" onClick={onEdit}>✏️</button>
        <button className="oc-btn oc-btn--del" onClick={onDelete}>🗑️</button>
      </div>
    </div>
  );
}

// ── Schedule Dialog (für Cron-Jobs) ───────────────────────
function ScheduleDialog({
  template,
  onSchedule,
  onCancel,
}: {
  template: Template;
  onSchedule: (config: ScheduleConfig) => void;
  onCancel: () => void;
}) {
  const [scheduleKind, setScheduleKind] = useState<"cron" | "every" | "at">("cron");
  const [cronExpr, setCronExpr] = useState("0 8 * * *");
  const [everyMs, setEveryMs] = useState(3600000);
  const [atDateTime, setAtDateTime] = useState("");
  const [timezone, setTimezone] = useState("Europe/Vienna");
  const [deliver, setDeliver] = useState(true);
  const [deliverChannel, setDeliverChannel] = useState("telegram");
  const [customCron, setCustomCron] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSchedule({
      scheduleKind,
      cronExpr,
      everyMs,
      atDateTime,
      timezone,
      deliver,
      deliverChannel,
    });
  };

  return (
    <div className="oc-modal-overlay" onClick={onCancel}>
      <div className="oc-modal oc-schedule-dialog" onClick={e => e.stopPropagation()}>
        <h2>🔄 Cron-Job planen</h2>
        <p className="oc-schedule-template-info">
          <span className="oc-schedule-icon">{template.icon}</span>
          <strong>{template.name}</strong>
        </p>
        
        <form onSubmit={handleSubmit}>
          {/* Schedule Type */}
          <div className="oc-form-row">
            <label>Zeitplan-Typ</label>
            <div className="oc-schedule-type-buttons">
              <button 
                type="button" 
                className={`oc-type-btn ${scheduleKind === "cron" ? "active" : ""}`}
                onClick={() => setScheduleKind("cron")}
              >
                📅 Cron
              </button>
              <button 
                type="button"
                className={`oc-type-btn ${scheduleKind === "every" ? "active" : ""}`}
                onClick={() => setScheduleKind("every")}
              >
                🔁 Intervall
              </button>
              <button 
                type="button"
                className={`oc-type-btn ${scheduleKind === "at" ? "active" : ""}`}
                onClick={() => setScheduleKind("at")}
              >
                ⏰ Einmalig
              </button>
            </div>
          </div>

          {/* Cron Expression */}
          {scheduleKind === "cron" && (
            <div className="oc-form-row">
              <label>Cron-Ausdruck</label>
              {!customCron ? (
                <div className="oc-cron-presets">
                  <select value={cronExpr} onChange={e => setCronExpr(e.target.value)}>
                    {CRON_PRESETS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <button type="button" className="oc-btn-link" onClick={() => setCustomCron(true)}>
                    Eigenen Ausdruck...
                  </button>
                </div>
              ) : (
                <div className="oc-cron-custom">
                  <input
                    type="text"
                    value={cronExpr}
                    onChange={e => setCronExpr(e.target.value)}
                    placeholder="* * * * *"
                  />
                  <span className="oc-cron-hint">Min Std Tag Mon Wtag</span>
                  <button type="button" className="oc-btn-link" onClick={() => setCustomCron(false)}>
                    Vorlagen...
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Interval */}
          {scheduleKind === "every" && (
            <div className="oc-form-row">
              <label>Intervall</label>
              <select value={everyMs} onChange={e => setEveryMs(Number(e.target.value))}>
                {INTERVAL_OPTIONS.map(i => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* One-time */}
          {scheduleKind === "at" && (
            <div className="oc-form-row">
              <label>Zeitpunkt</label>
              <input
                type="datetime-local"
                value={atDateTime}
                onChange={e => setAtDateTime(e.target.value)}
                required
              />
            </div>
          )}

          {/* Timezone (nur für Cron) */}
          {scheduleKind === "cron" && (
            <div className="oc-form-row">
              <label>Zeitzone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)}>
                <option value="Europe/Vienna">Europe/Vienna</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="Europe/Zurich">Europe/Zurich</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          )}

          {/* Delivery Options */}
          <div className="oc-form-row">
            <label className="oc-checkbox-label">
              <input
                type="checkbox"
                checked={deliver}
                onChange={e => setDeliver(e.target.checked)}
              />
              Ergebnis zustellen
            </label>
            {deliver && (
              <select 
                value={deliverChannel} 
                onChange={e => setDeliverChannel(e.target.value)}
                style={{ marginTop: 8 }}
              >
                <option value="telegram">📱 Telegram</option>
                <option value="msteams">💼 MS Teams</option>
              </select>
            )}
          </div>

          <div className="oc-form-actions">
            <button type="button" className="oc-btn" onClick={onCancel}>Abbrechen</button>
            <button type="submit" className="oc-btn oc-btn--primary">
              🔄 Cron-Job erstellen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ScheduleConfig {
  scheduleKind: "cron" | "every" | "at";
  cronExpr: string;
  everyMs: number;
  atDateTime: string;
  timezone: string;
  deliver: boolean;
  deliverChannel: string;
}

// ── Template Editor Modal ─────────────────────────────────
function TemplateEditor({
  template,
  onSave,
  onCancel,
  categories,
}: {
  template: Partial<Template> | null;
  onSave: (data: TemplateData) => void;
  onCancel: () => void;
  categories: string[];
}) {
  const [form, setForm] = useState<TemplateData>({
    name: template?.name || "",
    icon: template?.icon || "📋",
    description: template?.description || "",
    priority: template?.priority || "medium",
    category: template?.category || "",
    channel: template?.channel || "",
  });
  const [newCategory, setNewCategory] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({
      ...form,
      category: newCategory || form.category || "Allgemein",
    });
  };

  return (
    <div className="oc-modal-overlay" onClick={onCancel}>
      <div className="oc-modal oc-template-editor" onClick={e => e.stopPropagation()}>
        <h2>{template?.id ? "Vorlage bearbeiten" : "Neue Vorlage"}</h2>
        <form onSubmit={handleSubmit}>
          <div className="oc-form-row">
            <label>Icon</label>
            <div className="oc-icon-picker">
              {ICON_OPTIONS.map(icon => (
                <button
                  key={icon}
                  type="button"
                  className={`oc-icon-btn ${form.icon === icon ? "active" : ""}`}
                  onClick={() => setForm({ ...form, icon })}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
          
          <div className="oc-form-row">
            <label>Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="z.B. Wetterabfrage Wien"
              maxLength={100}
              required
            />
          </div>
          
          <div className="oc-form-row">
            <label>Beschreibung / Prompt</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Der Text, der als Job-Beschreibung verwendet wird..."
              rows={4}
            />
          </div>
          
          <div className="oc-form-row">
            <label>Priorität</label>
            <select 
              value={form.priority} 
              onChange={e => setForm({ ...form, priority: e.target.value as any })}
            >
              {PRIO_OPTIONS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          
          <div className="oc-form-row">
            <label>Kategorie</label>
            <div className="oc-category-input">
              <select 
                value={newCategory ? "__new__" : form.category || ""} 
                onChange={e => {
                  if (e.target.value === "__new__") {
                    setNewCategory("Neue Kategorie");
                  } else {
                    setNewCategory("");
                    setForm({ ...form, category: e.target.value });
                  }
                }}
              >
                <option value="">-- Wählen --</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                <option value="__new__">+ Neue Kategorie...</option>
              </select>
              {newCategory && (
                <input
                  type="text"
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="Kategoriename"
                />
              )}
            </div>
          </div>
          
          <div className="oc-form-row">
            <label>Channel (optional)</label>
            <input
              type="text"
              value={form.channel || ""}
              onChange={e => setForm({ ...form, channel: e.target.value || undefined })}
              placeholder="z.B. telegram"
            />
          </div>
          
          <div className="oc-form-actions">
            <button type="button" className="oc-btn" onClick={onCancel}>Abbrechen</button>
            <button type="submit" className="oc-btn oc-btn--primary">
              {template?.id ? "Speichern" : "Erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────
export function TemplatesView({ onJobCreated, gwRequest }: TemplatesViewProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [scheduling, setScheduling] = useState<Template | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // ── Load Templates ──────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.templates.list(filterCategory ? { category: filterCategory } : undefined);
      setTemplates(res.templates);
      setCategories(res.stats.categories);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [filterCategory]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // ── Actions ─────────────────────────────────────────────
  const handleRun = async (template: Template) => {
    try {
      setRunningId(template.id);
      await api.templates.run(template.id);
      onJobCreated?.();
      setTimeout(() => setRunningId(null), 1000);
    } catch (err: any) {
      alert("Fehler: " + (err.message || "Job konnte nicht erstellt werden"));
      setRunningId(null);
    }
  };

  const handleSchedule = async (template: Template, config: ScheduleConfig) => {
    if (!gwRequest) {
      alert("WebSocket nicht verbunden");
      return;
    }

    try {
      // Build schedule object
      let schedule: any;
      if (config.scheduleKind === "cron") {
        schedule = { kind: "cron", expr: config.cronExpr, tz: config.timezone };
      } else if (config.scheduleKind === "every") {
        schedule = { kind: "every", everyMs: config.everyMs };
      } else {
        schedule = { kind: "at", atMs: new Date(config.atDateTime).getTime() };
      }

      // Build payload - always agentTurn for templates
      const payload: any = {
        kind: "agentTurn",
        message: template.description || template.name,
      };
      
      if (config.deliver) {
        payload.deliver = true;
        payload.channel = config.deliverChannel;
      }

      const jobData = {
        name: `${template.icon} ${template.name}`,
        schedule,
        payload,
        sessionTarget: "isolated",
        enabled: true,
      };

      await gwRequest("cron.add", { job: jobData });
      setScheduling(null);
      alert(`✅ Cron-Job "${template.name}" erstellt!`);
    } catch (err: any) {
      console.error("Cron create error:", err);
      alert("Fehler: " + (err.message || "Cron-Job konnte nicht erstellt werden"));
    }
  };

  const handleSave = async (data: TemplateData) => {
    try {
      if (editing?.id) {
        await api.templates.update(editing.id, data);
      } else {
        await api.templates.create(data);
      }
      setShowEditor(false);
      setEditing(null);
      loadTemplates();
    } catch (err: any) {
      alert("Fehler: " + (err.message || "Speichern fehlgeschlagen"));
    }
  };

  const handleDelete = async (template: Template) => {
    if (!confirm(`Vorlage "${template.name}" wirklich löschen?`)) return;
    try {
      await api.templates.delete(template.id);
      loadTemplates();
    } catch (err: any) {
      alert("Fehler: " + (err.message || "Löschen fehlgeschlagen"));
    }
  };

  const handleEdit = (template: Template) => {
    setEditing(template);
    setShowEditor(true);
  };

  const handleNew = () => {
    setEditing(null);
    setShowEditor(true);
  };

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="oc-templates-view">
      <div className="oc-templates-header">
        <h2>📋 Vorlagen</h2>
        <div className="oc-templates-toolbar">
          <select 
            value={filterCategory} 
            onChange={e => setFilterCategory(e.target.value)}
            className="oc-cat-filter"
          >
            <option value="">Alle Kategorien</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button className="oc-btn oc-btn--primary" onClick={handleNew}>
            ➕ Neue Vorlage
          </button>
        </div>
      </div>

      <div className="oc-templates-hint">
        <strong>▶️ Jetzt</strong> = Einmaliger Job &nbsp;|&nbsp; 
        <strong>🔄 Cron</strong> = Wiederkehrender Cron-Job
      </div>

      {error && <div className="oc-error">{error}</div>}

      {loading ? (
        <div className="oc-loading">Lade Vorlagen...</div>
      ) : templates.length === 0 ? (
        <div className="oc-empty">
          <p>Keine Vorlagen vorhanden.</p>
          <button className="oc-btn oc-btn--primary" onClick={handleNew}>
            Erste Vorlage erstellen
          </button>
        </div>
      ) : (
        <div className="oc-templates-grid">
          {templates.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              onRun={() => handleRun(template)}
              onSchedule={() => setScheduling(template)}
              onEdit={() => handleEdit(template)}
              onDelete={() => handleDelete(template)}
              running={runningId === template.id}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <TemplateEditor
          template={editing}
          categories={categories}
          onSave={handleSave}
          onCancel={() => {
            setShowEditor(false);
            setEditing(null);
          }}
        />
      )}

      {scheduling && (
        <ScheduleDialog
          template={scheduling}
          onSchedule={(config) => handleSchedule(scheduling, config)}
          onCancel={() => setScheduling(null)}
        />
      )}
    </div>
  );
}

export default TemplatesView;
