// ============================================================
// TemplatesView — Job-Vorlagen verwalten
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import api, { Template, TemplateData } from "../lib/api";

// ── Types ─────────────────────────────────────────────────
interface TemplatesViewProps {
  onJobCreated?: () => void;
}

const PRIO_OPTIONS = [
  { value: "low", label: "Niedrig", color: "#64748b" },
  { value: "medium", label: "Normal", color: "#3b82f6" },
  { value: "high", label: "Hoch", color: "#f59e0b" },
  { value: "critical", label: "Kritisch", color: "#ef4444" },
];

const ICON_OPTIONS = ["📋", "☀️", "📈", "📰", "📧", "🔍", "💡", "🎯", "📊", "🗓️", "💬", "🛒", "✈️", "🏠", "💪"];

// ── Template Card ─────────────────────────────────────────
function TemplateCard({ 
  template, 
  onRun, 
  onEdit, 
  onDelete,
  running,
}: { 
  template: Template;
  onRun: () => void;
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
        >
          {running ? "⏳" : "▶️"} Ausführen
        </button>
        <button className="oc-btn oc-btn--edit" onClick={onEdit}>✏️</button>
        <button className="oc-btn oc-btn--del" onClick={onDelete}>🗑️</button>
      </div>
    </div>
  );
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
export function TemplatesView({ onJobCreated }: TemplatesViewProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [showEditor, setShowEditor] = useState(false);
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
      // Brief feedback
      setTimeout(() => setRunningId(null), 1000);
    } catch (err: any) {
      alert("Fehler: " + (err.message || "Job konnte nicht erstellt werden"));
      setRunningId(null);
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
    </div>
  );
}

export default TemplatesView;
