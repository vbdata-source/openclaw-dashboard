// ============================================================
// RAG View — Knowledge Graph Suche & Exploration
// ============================================================

import React, { useState, useCallback } from "react";
import api from "../lib/api";

interface Fact {
  uuid?: string;
  name?: string;
  fact?: string;
  fact_text?: string;
  source_node?: string;
  target_node?: string;
  created_at?: string;
  valid_at?: string;
  episode_name?: string;
}

interface Node {
  uuid?: string;
  name?: string;
  label?: string;
  labels?: string[];
  summary?: string;
  created_at?: string;
}

interface Episode {
  uuid?: string;
  name?: string;
  content?: string;
  source?: string;
  created_at?: string;
  entity_count?: number;
}

interface RagStatus {
  ok: boolean;
  error?: string;
  database?: string;
  entities?: number;
  episodes?: number;
}

type TabType = "search" | "nodes" | "episodes";

export function RagView() {
  const [activeTab, setActiveTab] = useState<TabType>("search");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Results
  const [facts, setFacts] = useState<Fact[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [status, setStatus] = useState<RagStatus | null>(null);

  // Status laden
  const loadStatus = useCallback(async () => {
    try {
      const data = await api.rag.status();
      setStatus(data);
    } catch (err: any) {
      setStatus({ ok: false, error: err.message });
    }
  }, []);

  // Semantische Suche (Facts)
  const searchFacts = useCallback(async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.rag.search(query, 20);
      setFacts(data.results || []);
    } catch (err: any) {
      setError(err.message);
      setFacts([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Node-Suche
  const searchNodes = useCallback(async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.rag.nodes(query, 20);
      setNodes(data.results || []);
    } catch (err: any) {
      setError(err.message);
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Episodes laden
  const loadEpisodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.rag.episodes(100);
      setEpisodes(data.episodes || []);
    } catch (err: any) {
      setError(err.message);
      setEpisodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tab wechseln
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setError(null);
    
    if (tab === "episodes" && episodes.length === 0) {
      loadEpisodes();
    }
  };

  // Suche ausführen
  const handleSearch = () => {
    if (activeTab === "search") {
      searchFacts();
    } else if (activeTab === "nodes") {
      searchNodes();
    }
  };

  // Enter-Taste
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  // Status beim ersten Render laden
  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return (
    <div className="rag-view">
      {/* Header mit Status */}
      <div className="rag-header">
        <h2>🧠 Knowledge Graph</h2>
        <div className="rag-status">
          {status === null ? (
            <span className="status-loading">Verbinde...</span>
          ) : status.ok ? (
            <span className="status-ok">
              ✅ Verbunden
              {status.entities && ` • ${status.entities} Entities`}
              {status.episodes && ` • ${status.episodes} Episodes`}
            </span>
          ) : (
            <span className="status-error">❌ {status.error || "Nicht verbunden"}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="rag-tabs">
        <button 
          className={`rag-tab ${activeTab === "search" ? "active" : ""}`}
          onClick={() => handleTabChange("search")}
        >
          🔍 Semantische Suche
        </button>
        <button 
          className={`rag-tab ${activeTab === "nodes" ? "active" : ""}`}
          onClick={() => handleTabChange("nodes")}
        >
          🏷️ Entities
        </button>
        <button 
          className={`rag-tab ${activeTab === "episodes" ? "active" : ""}`}
          onClick={() => handleTabChange("episodes")}
        >
          📄 Dokumente
        </button>
      </div>

      {/* Suchfeld (für search & nodes) */}
      {activeTab !== "episodes" && (
        <div className="rag-search-box">
          <input
            type="text"
            placeholder={activeTab === "search" 
              ? "Was möchtest du wissen? (z.B. 'Wer ist für Alarmsysteme verantwortlich?')"
              : "Entity suchen (z.B. 'JETZ', 'GAP030', 'Alarmserver')"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="rag-search-input"
          />
          <button 
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="rag-search-button"
          >
            {loading ? "⏳" : "🔍"}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rag-error">
          ⚠️ {error}
        </div>
      )}

      {/* Results */}
      <div className="rag-results">
        {/* Facts (Semantische Suche) */}
        {activeTab === "search" && (
          <div className="rag-facts">
            {loading ? (
              <div className="rag-loading">Suche läuft...</div>
            ) : facts.length === 0 ? (
              <div className="rag-empty">
                {query ? "Keine Ergebnisse gefunden." : "Gib eine Frage ein und drücke Enter."}
              </div>
            ) : (
              facts.map((fact, idx) => (
                <div key={fact.uuid || idx} className="rag-fact-card">
                  <div className="fact-text">
                    {fact.fact || fact.fact_text || fact.name || "—"}
                  </div>
                  {(fact.source_node || fact.target_node) && (
                    <div className="fact-relation">
                      <span className="fact-source">{fact.source_node}</span>
                      <span className="fact-arrow">→</span>
                      <span className="fact-target">{fact.target_node}</span>
                    </div>
                  )}
                  {fact.episode_name && (
                    <div className="fact-source-doc">
                      📄 {fact.episode_name}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Nodes (Entities) */}
        {activeTab === "nodes" && (
          <div className="rag-nodes">
            {loading ? (
              <div className="rag-loading">Suche läuft...</div>
            ) : nodes.length === 0 ? (
              <div className="rag-empty">
                {query ? "Keine Entities gefunden." : "Suche nach Entities (Personen, Systeme, Konzepte)."}
              </div>
            ) : (
              nodes.map((node, idx) => (
                <div key={node.uuid || idx} className="rag-node-card">
                  <div className="node-header">
                    <span className="node-name">{node.name || "Unbekannt"}</span>
                    {node.labels && node.labels.length > 0 && (
                      <span className="node-label">{node.labels.join(", ")}</span>
                    )}
                  </div>
                  {node.summary && (
                    <div className="node-summary">{node.summary}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Episodes (Dokumente) */}
        {activeTab === "episodes" && (
          <div className="rag-episodes">
            <div className="episodes-header">
              <span>{episodes.length} Dokumente importiert</span>
              <button onClick={loadEpisodes} disabled={loading}>
                {loading ? "⏳" : "🔄"} Aktualisieren
              </button>
            </div>
            {loading ? (
              <div className="rag-loading">Lade Dokumente...</div>
            ) : episodes.length === 0 ? (
              <div className="rag-empty">Keine Dokumente im Knowledge Graph.</div>
            ) : (
              episodes.map((ep, idx) => (
                <div key={ep.uuid || idx} className="rag-episode-card">
                  <div className="episode-name">
                    📄 {ep.name || `Episode ${idx + 1}`}
                  </div>
                  {ep.source && (
                    <div className="episode-source">Quelle: {ep.source}</div>
                  )}
                  {ep.content && (
                    <div className="episode-preview">
                      {ep.content.substring(0, 200)}...
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RagView;
