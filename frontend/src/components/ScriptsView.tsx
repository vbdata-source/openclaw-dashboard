// ============================================================
// ScriptsView — Auto-Scripts & Config Explorer
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import api, { ExplorerFile, ScriptUsage } from "../lib/api";

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

type TabType = "scripts" | "config" | "data";

export function ScriptsView({ loading: initialLoading, highlightScript, onScriptChange }: ScriptsViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>("scripts");
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [explorerFiles, setExplorerFiles] = useState<ExplorerFile[]>([]);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<string>("config");
  const [editContent, setEditContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ size: number; modified: string } | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [usageData, setUsageData] = useState<ScriptUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

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

  // Explorer-Verzeichnis laden
  const loadExplorerDir = useCallback(async (dir: string, subPath: string[] = []) => {
    setLoading(true);
    setError(null);
    try {
      const subdir = subPath.length > 0 ? subPath.join("/") : undefined;
      const res = await api.explorer.list(dir, subdir);
      setExplorerFiles(res.files || []);
      setSelectedDir(dir);
      setCurrentPath(subPath);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden");
      setExplorerFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (activeTab === "scripts") {
      loadScripts();
    } else {
      const dir = activeTab === "config" ? "config" : "data";
      loadExplorerDir(dir);
    }
  }, [activeTab, loadScripts, loadExplorerDir]);

  // Highlight-Script automatisch öffnen
  useEffect(() => {
    if (highlightScript && scripts.length > 0) {
      const found = scripts.find(s => s.name === highlightScript);
      if (found) {
        setActiveTab("scripts");
        openScript(highlightScript);
      }
    }
  }, [highlightScript, scripts]);

  // Script öffnen
  const openScript = async (filename: string) => {
    if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    
    setSelectedFile(filename);
    setDirty(false);
    setError(null);
    
    try {
      const res = await api.scripts.get(filename);
      setEditContent(res.content);
      setOriginalContent(res.content);
      setFileInfo(null);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden");
      setEditContent("");
      setOriginalContent("");
    }
  };

  // Explorer-Datei öffnen
  const openExplorerFile = async (file: ExplorerFile) => {
    if (file.isDirectory) {
      // Navigate into directory
      loadExplorerDir(selectedDir, [...currentPath, file.name]);
      return;
    }
    
    if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    
    const filePath = [...currentPath, file.name].join("/");
    setSelectedFile(filePath);
    setDirty(false);
    setError(null);
    
    try {
      const res = await api.explorer.getFile(selectedDir, filePath);
      setEditContent(res.content);
      setOriginalContent(res.content);
      setFileInfo({ size: res.size, modified: res.modified });
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden");
      setEditContent("");
      setOriginalContent("");
    }
  };

  // Zurück navigieren
  const navigateUp = () => {
    if (currentPath.length > 0) {
      const newPath = currentPath.slice(0, -1);
      loadExplorerDir(selectedDir, newPath);
      setSelectedFile(null);
    }
  };

  // Script speichern
  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    setError(null);
    
    try {
      if (activeTab === "scripts") {
        await api.scripts.update(selectedFile, editContent);
      } else {
        await api.explorer.updateFile(selectedDir, selectedFile, editContent);
      }
      setOriginalContent(editContent);
      setDirty(false);
      onScriptChange?.();
      // Reload file info
      if (activeTab !== "scripts") {
        const res = await api.explorer.getFile(selectedDir, selectedFile);
        setFileInfo({ size: res.size, modified: res.modified });
      }
    } catch (err: any) {
      setError(err.message || "Fehler beim Speichern");
      alert("❌ Fehler: " + err.message);
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

  // Script Usage laden
  const loadUsage = async (scriptName: string) => {
    setUsageLoading(true);
    setShowUsage(true);
    setUsageData(null);
    try {
      const data = await api.scripts.usage(scriptName);
      setUsageData(data);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden der Verwendung");
    } finally {
      setUsageLoading(false);
    }
  };

  // Filter
  const filteredScripts = scripts.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredFiles = explorerFiles.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  // Script-Kategorien
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

  // File icon helper
  const getFileIcon = (file: ExplorerFile): string => {
    if (file.isDirectory) return "📁";
    switch (file.extension) {
      case "json": return "📋";
      case "yaml": case "yml": return "⚙️";
      case "js": return "📜";
      case "md": return "📝";
      case "csv": return "📊";
      default: return "📄";
    }
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format JSON for display
  const formatContent = (content: string, extension: string | null): string => {
    if (extension === "json" && content.trim()) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  };

  const selectedScriptInfo = activeTab === "scripts" && selectedFile 
    ? scripts.find(s => s.name === selectedFile) 
    : null;
  const selectedCategory = selectedScriptInfo ? categorizeScript(selectedFile!) : null;

  // Determine file extension for current file
  const currentExtension = selectedFile ? selectedFile.split(".").pop() : null;

  return (
    <div className="oc-scripts">
      <div className="oc-section-header">
        <h2 className="oc-view-title">
          Workspace Explorer {loading && <span className="oc-loading-sm">⏳</span>}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", marginRight: "12px" }}>
            {([
              { key: "scripts", label: "📜 Scripts", count: scripts.length },
              { key: "config", label: "⚙️ Config", count: null },
              { key: "data", label: "💾 Data", count: null },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => {
                  if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
                  setActiveTab(tab.key);
                  setSelectedFile(null);
                  setDirty(false);
                  setSearch("");
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  background: activeTab === tab.key ? "var(--accent)" : "var(--bg2)",
                  color: activeTab === tab.key ? "#fff" : "var(--tx)",
                  transition: "all 0.15s"
                }}
              >
                {tab.label}
                {tab.count !== null && <span style={{ marginLeft: "4px", opacity: 0.7 }}>({tab.count})</span>}
              </button>
            ))}
          </div>
          <button className="oc-btn-ghost" onClick={() => {
            if (activeTab === "scripts") loadScripts();
            else loadExplorerDir(selectedDir, currentPath);
          }} title="Neu laden">
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
        {/* File List */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          overflow: "hidden"
        }}>
          {/* Breadcrumb for explorer */}
          {activeTab !== "scripts" && currentPath.length > 0 && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "8px",
              backgroundColor: "var(--bg2)",
              borderRadius: "6px",
              fontSize: "12px"
            }}>
              <button
                onClick={navigateUp}
                style={{
                  padding: "4px 8px",
                  backgroundColor: "var(--bg3)",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: "var(--tx)"
                }}
              >
                ⬆️ Zurück
              </button>
              <span style={{ color: "var(--txd)" }}>
                {selectedDir}/{currentPath.join("/")}
              </span>
            </div>
          )}

          {/* Suchfeld */}
          <input
            type="text"
            className="oc-input"
            placeholder="🔍 Suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* File List */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "4px"
          }}>
            {activeTab === "scripts" ? (
              // Scripts List
              <>
                {filteredScripts.length === 0 && !loading && (
                  <div style={{ color: "var(--txd)", padding: "20px", textAlign: "center" }}>
                    {search ? "Keine Scripts gefunden" : "Keine Scripts vorhanden"}
                  </div>
                )}
                {filteredScripts.map(script => {
                  const cat = categorizeScript(script.name);
                  const isSelected = selectedFile === script.name;
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
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
                          {formatSize(script.size)}
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
              </>
            ) : (
              // Explorer List
              <>
                {filteredFiles.length === 0 && !loading && (
                  <div style={{ color: "var(--txd)", padding: "20px", textAlign: "center" }}>
                    {search ? "Keine Dateien gefunden" : "Verzeichnis leer"}
                  </div>
                )}
                {filteredFiles.map(file => {
                  const filePath = [...currentPath, file.name].join("/");
                  const isSelected = selectedFile === filePath;
                  return (
                    <div
                      key={file.name}
                      onClick={() => openExplorerFile(file)}
                      style={{
                        padding: "10px 12px",
                        backgroundColor: isSelected ? "var(--accent)" : "var(--bg2)",
                        borderRadius: "8px",
                        cursor: "pointer",
                        transition: "all 0.15s"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span>{getFileIcon(file)}</span>
                        <span style={{
                          fontSize: "13px",
                          fontWeight: isSelected ? 600 : 400,
                          color: isSelected ? "#fff" : "var(--tx)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}>
                          {file.name}
                        </span>
                        {!file.isDirectory && (
                          <span style={{
                            fontSize: "11px",
                            color: isSelected ? "rgba(255,255,255,0.7)" : "var(--txd)"
                          }}>
                            {formatSize(file.size)}
                          </span>
                        )}
                      </div>
                      {file.modified && !file.isDirectory && (
                        <div style={{
                          fontSize: "10px",
                          color: isSelected ? "rgba(255,255,255,0.6)" : "var(--txd)",
                          marginTop: "2px"
                        }}>
                          {new Date(file.modified).toLocaleString("de-AT")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
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
          {selectedFile ? (
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
                  {activeTab === "scripts" && selectedCategory && (
                    <span style={{
                      padding: "4px 8px",
                      backgroundColor: selectedCategory.color + "22",
                      color: selectedCategory.color,
                      borderRadius: "6px",
                      fontSize: "12px"
                    }}>
                      {selectedCategory.icon} {selectedCategory.category}
                    </span>
                  )}
                  {activeTab !== "scripts" && (
                    <span style={{
                      padding: "4px 8px",
                      backgroundColor: "var(--bg3)",
                      borderRadius: "6px",
                      fontSize: "12px"
                    }}>
                      {selectedDir}/{selectedFile}
                    </span>
                  )}
                  <span style={{ fontWeight: 500 }}>
                    {activeTab === "scripts" ? selectedFile : selectedFile.split("/").pop()}
                  </span>
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
                  {activeTab === "scripts" && selectedFile && (
                    <button
                      className="oc-btn-ghost"
                      onClick={() => {
                        const question = `Wo wird das Script "${selectedFile}" verwendet? Bitte prüfe: Cron-Jobs, andere Scripts die es importieren, und ob du es manuell aufrufst. Ist es noch in Verwendung oder kann es gelöscht werden?`;
                        navigator.clipboard.writeText(question);
                        alert(`📋 Frage kopiert!\n\nFüge sie im Chat ein um AJBot zu fragen:\n\n"${question.slice(0, 80)}..."`);
                      }}
                      title="Frage in Zwischenablage kopieren und im Chat einfügen"
                      style={{
                        backgroundColor: "rgba(59, 130, 246, 0.1)",
                        borderColor: "rgba(59, 130, 246, 0.3)"
                      }}
                    >
                      🤖 Agent fragen
                    </button>
                  )}
                  {currentExtension === "json" && (
                    <button
                      className="oc-btn-ghost"
                      onClick={() => {
                        try {
                          const formatted = JSON.stringify(JSON.parse(editContent), null, 2);
                          setEditContent(formatted);
                          setDirty(formatted !== originalContent);
                        } catch {
                          alert("❌ Ungültiges JSON");
                        }
                      }}
                      title="JSON formatieren"
                    >
                      🎨 Format
                    </button>
                  )}
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
                    onClick={saveFile}
                    disabled={saving || !dirty}
                  >
                    {saving ? "⏳ Speichern..." : "💾 Speichern"}
                  </button>
                </div>
              </div>

              {/* Script Info */}
              {selectedScriptInfo?.description && (
                <div style={{
                  padding: "8px 16px",
                  backgroundColor: "rgba(139, 92, 246, 0.1)",
                  borderBottom: "1px solid var(--bg3)",
                  fontSize: "12px",
                  color: "var(--tx)"
                }}>
                  📝 {selectedScriptInfo.description}
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
                <span>
                  {formatSize(editContent.length)}
                  {fileInfo?.modified && ` • Geändert: ${new Date(fileInfo.modified).toLocaleString("de-AT")}`}
                </span>
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
              <span style={{ fontSize: "48px", marginBottom: "16px" }}>
                {activeTab === "scripts" ? "📜" : activeTab === "config" ? "⚙️" : "💾"}
              </span>
              <p>
                {activeTab === "scripts" 
                  ? "Wähle ein Script zum Bearbeiten" 
                  : "Wähle eine Datei zum Bearbeiten"}
              </p>
              <p style={{ fontSize: "12px", marginTop: "8px", maxWidth: "300px", textAlign: "center" }}>
                {activeTab === "scripts" 
                  ? "Scripts werden von AJBot automatisch erstellt und können hier angepasst werden."
                  : activeTab === "config"
                    ? "Konfigurationsdateien für Scripts und Integrationen."
                    : "Datendateien wie Sync-Status, Caches und temporäre Daten."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Usage Modal */}
      {showUsage && (
        <div 
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
            if (e.target === e.currentTarget) setShowUsage(false);
          }}
        >
          <div style={{
            backgroundColor: "#1e1e2e",
            borderRadius: "12px",
            maxWidth: "600px",
            width: "100%",
            maxHeight: "80vh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            border: "1px solid #3b3b4f",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
          }}>
            {/* Header */}
            <div style={{
              padding: "16px 20px",
              backgroundColor: "#2a2a3e",
              borderBottom: "1px solid #3b3b4f",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px" }}>
                  🔍 Verwendung von {usageData?.script || selectedFile}
                </h3>
                {usageData && (
                  <span style={{ 
                    fontSize: "12px", 
                    color: usageData.totalUsages > 0 ? "#22c55e" : "#f59e0b",
                    marginTop: "4px",
                    display: "block"
                  }}>
                    {usageData.totalUsages > 0 
                      ? `✓ ${usageData.totalUsages} Verwendung(en) gefunden`
                      : "⚠️ Keine Verwendung gefunden - möglicherweise ungenutzt"}
                  </span>
                )}
              </div>
              <button 
                onClick={() => setShowUsage(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "var(--tx)"
                }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div style={{ 
              padding: "16px 20px", 
              overflowY: "auto",
              flex: 1
            }}>
              {usageLoading && (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--txd)" }}>
                  ⏳ Suche nach Verwendungen...
                </div>
              )}

              {usageData && !usageLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {/* Cron Jobs */}
                  <div>
                    <h4 style={{ 
                      margin: "0 0 8px 0", 
                      fontSize: "13px", 
                      color: "var(--txd)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px"
                    }}>
                      🔄 Cron Jobs 
                      <span style={{ 
                        padding: "2px 6px", 
                        backgroundColor: usageData.cronJobs.length > 0 ? "rgba(34,197,94,0.2)" : "var(--bg2)",
                        borderRadius: "4px",
                        fontSize: "11px"
                      }}>
                        {usageData.cronJobs.length}
                      </span>
                    </h4>
                    {usageData.cronJobs.length === 0 ? (
                      <div style={{ fontSize: "12px", padding: "10px", backgroundColor: "#2a2a3e", borderRadius: "6px" }}>
                        {usageData.cronError ? (
                          <div>
                            <div style={{ color: "#ef4444", marginBottom: "6px" }}>
                              ⚠️ Gateway nicht erreichbar
                            </div>
                            <div style={{ fontSize: "11px", color: "#888" }}>
                              {usageData.cronError}
                            </div>
                            <div style={{ fontSize: "11px", color: "#666", marginTop: "6px" }}>
                              Tipp: OPENCLAW_GATEWAY_HTTP in Coolify konfigurieren
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "#888" }}>Nicht in Cron Jobs verwendet</span>
                        )}
                      </div>
                    ) : (
                      usageData.cronJobs.map((job, i) => (
                        <div key={i} style={{
                          padding: "10px 12px",
                          backgroundColor: "var(--bg2)",
                          borderRadius: "6px",
                          marginTop: i > 0 ? "6px" : 0
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 500, fontSize: "13px" }}>{job.name}</span>
                            <span style={{
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              backgroundColor: job.enabled ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
                              color: job.enabled ? "#22c55e" : "#ef4444"
                            }}>
                              {job.enabled ? "Aktiv" : "Pausiert"}
                            </span>
                          </div>
                          <code style={{ fontSize: "11px", color: "var(--txd)", display: "block", marginTop: "4px" }}>
                            ...{job.match}...
                          </code>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Other Scripts */}
                  <div>
                    <h4 style={{ 
                      margin: "0 0 8px 0", 
                      fontSize: "13px", 
                      color: "var(--txd)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px"
                    }}>
                      📜 Andere Scripts 
                      <span style={{ 
                        padding: "2px 6px", 
                        backgroundColor: usageData.scripts.length > 0 ? "rgba(34,197,94,0.2)" : "var(--bg2)",
                        borderRadius: "4px",
                        fontSize: "11px"
                      }}>
                        {usageData.scripts.length}
                      </span>
                    </h4>
                    {usageData.scripts.length === 0 ? (
                      <div style={{ fontSize: "12px", color: "var(--txd)", padding: "8px", backgroundColor: "var(--bg2)", borderRadius: "6px" }}>
                        Nicht von anderen Scripts importiert
                      </div>
                    ) : (
                      usageData.scripts.map((script, i) => (
                        <div key={i} style={{
                          padding: "8px 12px",
                          backgroundColor: "var(--bg2)",
                          borderRadius: "6px",
                          marginTop: i > 0 ? "4px" : 0,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <span style={{ fontSize: "13px" }}>📄 {script.name}</span>
                          <span style={{ fontSize: "11px", color: "var(--txd)" }}>{script.type}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Memory/Docs */}
                  <div>
                    <h4 style={{ 
                      margin: "0 0 8px 0", 
                      fontSize: "13px", 
                      color: "var(--txd)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px"
                    }}>
                      📝 Dokumentation 
                      <span style={{ 
                        padding: "2px 6px", 
                        backgroundColor: usageData.memory.length > 0 ? "rgba(34,197,94,0.2)" : "var(--bg2)",
                        borderRadius: "4px",
                        fontSize: "11px"
                      }}>
                        {usageData.memory.length}
                      </span>
                    </h4>
                    {usageData.memory.length === 0 ? (
                      <div style={{ fontSize: "12px", color: "var(--txd)", padding: "8px", backgroundColor: "var(--bg2)", borderRadius: "6px" }}>
                        Nicht in Dokumentation erwähnt
                      </div>
                    ) : (
                      usageData.memory.map((doc, i) => (
                        <div key={i} style={{
                          padding: "10px 12px",
                          backgroundColor: "var(--bg2)",
                          borderRadius: "6px",
                          marginTop: i > 0 ? "6px" : 0
                        }}>
                          <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: doc.match ? "8px" : 0 }}>
                            📄 {doc.name}
                          </div>
                          {doc.match && (
                            <div style={{ 
                              fontSize: "12px", 
                              color: "var(--tx)", 
                              backgroundColor: "var(--bg1)",
                              padding: "8px 10px",
                              borderRadius: "4px",
                              borderLeft: "3px solid #8b5cf6",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              lineHeight: 1.5
                            }}>
                              ...{doc.match}...
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Config */}
                  {usageData.config.length > 0 && (
                    <div>
                      <h4 style={{ 
                        margin: "0 0 8px 0", 
                        fontSize: "13px", 
                        color: "var(--txd)",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px"
                      }}>
                        ⚙️ Config-Dateien 
                        <span style={{ 
                          padding: "2px 6px", 
                          backgroundColor: "rgba(34,197,94,0.2)",
                          borderRadius: "4px",
                          fontSize: "11px"
                        }}>
                          {usageData.config.length}
                        </span>
                      </h4>
                      {usageData.config.map((cfg, i) => (
                        <div key={i} style={{
                          padding: "8px 12px",
                          backgroundColor: "var(--bg2)",
                          borderRadius: "6px",
                          marginTop: i > 0 ? "4px" : 0
                        }}>
                          <span style={{ fontSize: "13px" }}>⚙️ {cfg.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Summary */}
                  {usageData.totalUsages === 0 && (
                    <div style={{
                      padding: "12px",
                      backgroundColor: "rgba(245, 158, 11, 0.15)",
                      borderRadius: "8px",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                      fontSize: "13px"
                    }}>
                      <strong>⚠️ Möglicherweise ungenutzt:</strong>
                      <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "var(--tx)" }}>
                        Dieses Script wird weder in Cron-Jobs noch von anderen Scripts verwendet. 
                        Es könnte ein Hilfsskript für manuelle Ausführung sein oder nicht mehr benötigt werden.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ScriptsView;
