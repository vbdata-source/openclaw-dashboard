// ============================================================
// OpenClaw Dashboard — Template Store
// ============================================================
// Datei-basierte Persistenz für Job-Vorlagen
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.JOB_DATA_DIR || "/app/data";
const TEMPLATES_FILE = join(DATA_DIR, "templates.json");

// ── Ensure directories exist ──────────────────────────────
function ensureDirs() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── Load/Save helpers ─────────────────────────────────────
function loadTemplates() {
  ensureDirs();
  if (!existsSync(TEMPLATES_FILE)) {
    // Return default templates
    return getDefaultTemplates();
  }
  try {
    const data = readFileSync(TEMPLATES_FILE, "utf-8");
    const templates = JSON.parse(data);
    return templates.length > 0 ? templates : getDefaultTemplates();
  } catch (err) {
    console.error("[TemplateStore] Error loading templates:", err.message);
    return getDefaultTemplates();
  }
}

function saveTemplates(templates) {
  ensureDirs();
  try {
    writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), "utf-8");
  } catch (err) {
    console.error("[TemplateStore] Error saving templates:", err.message);
    throw err;
  }
}

// ── Default Templates ─────────────────────────────────────
function getDefaultTemplates() {
  const now = new Date().toISOString();
  return [
    {
      id: "weather",
      name: "Wetterabfrage",
      icon: "☀️",
      description: "Wie ist das aktuelle Wetter in Wien? Gib mir eine kurze Zusammenfassung.",
      priority: "medium",
      category: "Alltag",
      channel: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "stocks",
      name: "Börsen-Update",
      icon: "📈",
      description: "Wie stehen die wichtigsten Aktienindizes (DAX, S&P 500, NASDAQ)? Kurze Übersicht.",
      priority: "medium",
      category: "Finanzen",
      channel: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "news",
      name: "News-Zusammenfassung",
      icon: "📰",
      description: "Was sind die wichtigsten Nachrichten heute? Gib mir die Top 5 Headlines.",
      priority: "low",
      category: "News",
      channel: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

// ── Template Store Class ──────────────────────────────────
class TemplateStore {
  constructor() {
    this.templates = loadTemplates();
    this.listeners = new Set();
  }

  // ── Event System ────────────────────────────────────────
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(event, template) {
    for (const listener of this.listeners) {
      try {
        listener(event, template);
      } catch (err) {
        console.error("[TemplateStore] Listener error:", err.message);
      }
    }
  }

  // ── CRUD Operations ─────────────────────────────────────
  list(filter = {}) {
    let result = [...this.templates];
    
    if (filter.category) {
      result = result.filter(t => t.category === filter.category);
    }
    
    // Sort by name
    result.sort((a, b) => a.name.localeCompare(b.name));
    
    return result;
  }

  get(id) {
    return this.templates.find(t => t.id === id) || null;
  }

  create(data) {
    const now = new Date().toISOString();
    const template = {
      id: randomUUID(),
      name: data.name || "Neue Vorlage",
      icon: data.icon || "📋",
      description: data.description || "",
      priority: data.priority || "medium",
      category: data.category || "Allgemein",
      channel: data.channel || null,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.push(template);
    saveTemplates(this.templates);
    this._emit("template.created", template);
    
    return template;
  }

  update(id, updates) {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Template ${id} not found`);
    }

    const template = this.templates[index];
    const now = new Date().toISOString();

    // Apply updates
    const allowedFields = ["name", "icon", "description", "priority", "category", "channel"];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        template[field] = updates[field];
      }
    }
    template.updatedAt = now;

    this.templates[index] = template;
    saveTemplates(this.templates);
    this._emit("template.updated", template);
    
    return template;
  }

  delete(id) {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Template ${id} not found`);
    }

    const template = this.templates[index];
    this.templates.splice(index, 1);
    saveTemplates(this.templates);
    this._emit("template.deleted", { id });
    
    return template;
  }

  // ── Categories ──────────────────────────────────────────
  getCategories() {
    const categories = new Set(this.templates.map(t => t.category).filter(Boolean));
    return [...categories].sort();
  }

  // ── Stats ───────────────────────────────────────────────
  getStats() {
    return {
      total: this.templates.length,
      categories: this.getCategories(),
    };
  }
}

// ── Singleton Export ──────────────────────────────────────
export const templateStore = new TemplateStore();
export default templateStore;
