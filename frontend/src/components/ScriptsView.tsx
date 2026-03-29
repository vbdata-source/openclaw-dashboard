// ============================================================
// ScriptsView — Auto-Scripts Editor
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import api from "../lib/api";

interface ScriptInfo {
  name: string;
  size: number;
  description?: string;
}

interface ScriptsViewProps {
  loading?: boolean;
  highlightScript?: string | null;
  onScriptChange?: () => void;
}

export function ScriptsView({ loading: initialLoading, highlightScript, onScriptChange }: ScriptsViewProps) {
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [selectedScript, setSelectedScript] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Scripts laden
  const loadScripts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.scripts.list();
      setScripts(res.scripts || []);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden der Scripts");
      setScripts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScripts();
  }, [loadScripts]);

  // Highlight-Script automatisch öffnen
  useEffect(() => {
    if (highlightScript && scripts.length > 0) {
      const found = scripts.find(s => s.name === highlightScript);
      if (found) {
        openScript(highlightScript);
      }
    }
  }, [highlightScript, scripts]);

  // Script öffnen
  const openScript = async (filename: string) => {
    if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    
    setSelectedScript(filename);
    setDirty(false);
    setError(null);
    
    try {
      const res = await api.scripts.get(filename);
      setEditContent(res.content);
      setOriginalContent(res.content);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden");
      setEditContent("");
      setOriginalContent("");
    }
  };

  // Script speichern
  const saveScript = async () => {
    if (!selectedScript) return;
    setSaving(true);
    setError(null);
    
    try {
      await api.scripts.update(selectedScript, editContent);
      setOriginalContent(editContent);
      setDirty(false);
      onScriptChange?.();
      alert("✅ Gespeichert!");
    } catch (err: any) {
      setError(err.message || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  };

  // Änderungen verwerfen
  const revertChanges = () => {
    if (!dirty || confirm("Änderungen wirklich verwerfen?")) {
      setEditContent(originalContent);
      setDirty(false);
    }
  };

  // Filter Scripts
  const filteredScripts = scripts.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || "").toLowerCase().includes(search.toLowerCase())
  );

  // Script-Kategorien (aus Präfix ableiten)
  const categorizeScript = (name: string): { category: string; icon: string; color: string } => {
    if (name.startsWith("synapse-")) return { category: "Synapse", icon: "🧠", color: "#8b5cf6" };
    if (name.startsWith("gap-") || name.startsWith("jetz-")) return { category: "JET", icon: "📊", color: "#f59e0b" };
    if (name.startsWith("m365-")) return { category: "M365", icon: "📧", color: "#0078d4" };
    if (name.startsWith("ki-")) return { category: "KI-Gedächtnis", icon: "🔗", color: "#22c55e" };
    if (name.includes("graphiti") || name.startsWith("kh-")) return { category: "Knowledge", icon: "🔍", color: "#06b6d4" };
    if (name.includes("pdf") || name.includes("docx")) return { category: "Dokumente", icon: "📄", color: "#ef4444" };
    if (name.includes("mail") || name.includes("teams")) return { category: "Kommunikation", icon: "💬", color: "#3b82f6" };
    return { category: "Utility", icon: "🔧", color: "#64748b" };
  };

  const selectedInfo = selectedScript ? scripts.find(s => s.name === selectedScript) : null;
  const selectedCategory = selectedScript ? categorizeScript(selectedScript) : null;

  return (
    <div className="oc-scripts">
      <div className="oc-section-header">
        <h2 className="oc-view-title">
          Auto-Scripts {loading && <span className="oc-loading-sm">⏳</span>}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "13px", color: "var(--txd)" }}>
            {scripts.length} Scripts
          </span>
          <button className="oc-btn-ghost" onClick={loadScripts} title="Neu laden">
            🔄
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "12px",
          backgroundColor: "rgba(239, 68, 68, 0.15)",
          borderRadius: "8px",
          color: "#ef4444",
          marginBottom: "16px",
          fontSize: "13px"
        }}>
          ❌ {error}
        </div>
      )}

      <div className="oc-scripts-layout" style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr",
        gap: "16px",
        height: "calc(100vh - 180px)"
      }}>
        {/* Script-Liste */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          overflow: "hidden"
        }}>
          {/* Suchfeld */}
          <input
            type="text"
            className="oc-input"
            placeholder="🔍 Script suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: "8px" }}
          />

          {/* Script-Liste */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "4px"
          }}>
            {filteredScripts.length === 0 && !loading && (
              <div style={{ color: "var(--txd)", padding: "20px", textAlign: "center" }}>
                {search ? "Keine Scripts gefunden" : "Keine Scripts vorhanden"}
              </div>
            )}
            {filteredScripts.map(script => {
              const cat = categorizeScript(script.name);
              const isSelected = selectedScript === script.name;
              const isHighlighted = highlightScript === script.name;
              return (
                <div
                  key={script.name}
                  onClick={() => openScript(script.name)}
                  style={{
                    padding: "10px 12px",
                    backgroundColor: isSelected 
                      ? "var(--accent)" 
                      : isHighlighted 
                        ? "rgba(139, 92, 246, 0.2)" 
                        : "var(--bg2)",
                    borderRadius: "8px",
                    cursor: "pointer",
                    borderLeft: `3px solid ${cat.color}`,
                    transition: "all 0.15s"
                  }}
                >
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}>
                    <span>{cat.icon}</span>
                    <span style={{
                      fontSize: "13px",
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? "#fff" : "var(--tx)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}>
                      {script.name}
                    </span>
                    <span style={{
                      fontSize: "11px",
                      color: isSelected ? "rgba(255,255,255,0.7)" : "var(--txd)"
                    }}>
                      {(script.size / 1024).toFixed(1)}k
                    </span>
                  </div>
                  {script.description && (
                    <div style={{
                      fontSize: "11px",
                      color: isSelected ? "rgba(255,255,255,0.7)" : "var(--txd)",
                      marginTop: "4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}>
                      {script.description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg1)",
          borderRadius: "12px",
          overflow: "hidden"
        }}>
          {selectedScript ? (
            <>
              {/* Editor Header */}
              <div style={{
                padding: "12px 16px",
                backgroundColor: "var(--bg2)",
                borderBottom: "1px solid var(--bg3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{
                    padding: "4px 8px",
                    backgroundColor: selectedCategory?.color + "22",
                    color: selectedCategory?.color,
                    borderRadius: "6px",
                    fontSize: "12px"
                  }}>
                    {selectedCategory?.icon} {selectedCategory?.category}
                  </span>
                  <span style={{ fontWeight: 500 }}>{selectedScript}</span>
                  {dirty && (
                    <span style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: "#f59e0b"
                    }} title="Ungespeicherte Änderungen" />
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  {dirty && (
                    <button
                      className="oc-btn-ghost"
                      onClick={revertChanges}
                      title="Änderungen verwerfen"
                    >
                      ↩️ Verwerfen
                    </button>
                  )}
                  <button
                    className="oc-btn-primary"
                    onClick={saveScript}
                    disabled={saving || !dirty}
                  >
                    {saving ? "⏳ Speichern..." : "💾 Speichern"}
                  </button>
                </div>
              </div>

              {/* Script Info */}
              {selectedInfo?.description && (
                <div style={{
                  padding: "8px 16px",
                  backgroundColor: "rgba(139, 92, 246, 0.1)",
                  borderBottom: "1px solid var(--bg3)",
                  fontSize: "12px",
                  color: "var(--tx)"
                }}>
                  📝 {selectedInfo.description}
                </div>
              )}

              {/* Code Editor */}
              <textarea
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  setDirty(e.target.value !== originalContent);
                }}
                style={{
                  flex: 1,
                  padding: "16px",
                  backgroundColor: "var(--bg1)",
                  border: "none",
                  resize: "none",
                  fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
                  fontSize: "13px",
                  lineHeight: 1.6,
                  color: "var(--tx)",
                  outline: "none"
                }}
                spellCheck={false}
              />

              {/* Editor Footer */}
              <div style={{
                padding: "8px 16px",
                backgroundColor: "var(--bg2)",
                borderTop: "1px solid var(--bg3)",
                fontSize: "11px",
                color: "var(--txd)",
                display: "flex",
                justifyContent: "space-between"
              }}>
                <span>{editContent.split("\n").length} Zeilen</span>
                <span>{(editContent.length / 1024).toFixed(1)} KB</span>
              </div>
            </>
          ) : (
            <div style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--txd)"
            }}>
              <span style={{ fontSize: "48px", marginBottom: "16px" }}>📜</span>
              <p>Wähle ein Script zum Bearbeiten</p>
              <p style={{ fontSize: "12px", marginTop: "8px" }}>
                Scripts werden von AJBot automatisch erstellt und können hier angepasst werden.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScriptsView;
