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
  episodes?: string[];
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
  source_description?: string;
  created_at?: string;
  entity_count?: number;
  group_id?: string;
}

interface RagStatus {
  ok: boolean;
  error?: string;
  database?: string;
  entities?: number;
  episodes?: number;
}

type TabType = "ask" | "search" | "nodes" | "episodes";

export function RagView() {
  const [activeTab, setActiveTab] = useState<TabType>("ask");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  // Results
  const [facts, setFacts] = useState<Fact[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [status, setStatus] = useState<RagStatus | null>(null);
  
  // AI Answer
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerSources, setAnswerSources] = useState<string[]>([]);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiAnswerLoading, setAiAnswerLoading] = useState(false);
  
  // Document Links
  interface DocLink { name: string; fileId: string | null; driveUrl: string | null; downloadUrl: string | null; }
  const [documentLinks, setDocumentLinks] = useState<DocLink[]>([]);
  
  // Detail Modal
  const [selectedItem, setSelectedItem] = useState<Fact | Node | Episode | null>(null);
  const [modalType, setModalType] = useState<"fact" | "node" | "episode" | null>(null);
  
  // Search Mode
  const [exactSearch, setExactSearch] = useState(false);

  // Status laden
  const loadStatus = useCallback(async () => {
    try {
      const data = await api.rag.status();
      setStatus(data);
    } catch (err: any) {
      setStatus({ ok: false, error: err.message });
    }
  }, []);

  // AI-Antwort generieren (via Job mit Polling)
  const generateAiAnswer = useCallback(async () => {
    if (!query.trim() || facts.length === 0) return;
    
    setAiAnswerLoading(true);
    setAiAnswer("⏳ Job wird erstellt...");
    
    try {
      // Kontext aus Facts zusammenstellen
      const context = facts.map(f => 
        `- ${f.fact || f.fact_text || f.name || ""}`
      ).filter(f => f !== "- ").join("\n");
      
      const sources = answerSources.join(", ");
      
      // Job erstellen für AI-Antwort
      const jobData = {
        title: `RAG: ${query.substring(0, 50)}${query.length > 50 ? "..." : ""}`,
        description: `Beantworte folgende Frage basierend auf dem Knowledge Graph:\n\n**Frage:** ${query}\n\n**Relevante Fakten aus dem Knowledge Graph:**\n${context}\n\n**Quellen:** ${sources}\n\n---\nBitte formuliere eine klare, zusammenhängende Antwort auf die Frage, basierend auf den obigen Fakten. Fasse die wichtigsten Punkte zusammen.`,
        priority: "high" as const,
        status: "queued" as const,
      };
      
      const job = await api.jobs.create(jobData);
      setAiAnswer(`⏳ Job erstellt, warte auf AI-Antwort...\n(Job-ID: ${job.id})`);
      
      // Polling für Job-Ergebnis (max 60 Sekunden)
      const maxAttempts = 30;
      let attempts = 0;
      
      const pollInterval = setInterval(async () => {
        attempts++;
        
        try {
          const updatedJob = await api.jobs.get(job.id);
          
          if (updatedJob.status === "done" && updatedJob.result) {
            clearInterval(pollInterval);
            setAiAnswer(updatedJob.result);
            setAiAnswerLoading(false);
          } else if (updatedJob.status === "failed") {
            clearInterval(pollInterval);
            setAiAnswer(`❌ Job fehlgeschlagen: ${updatedJob.error || "Unbekannter Fehler"}`);
            setAiAnswerLoading(false);
          } else if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setAiAnswer(`⏱️ Timeout - Job läuft noch.\nPrüfe die Antwort im Jobs-Tab (ID: ${job.id})`);
            setAiAnswerLoading(false);
          } else {
            // Status-Update
            const statusEmoji = updatedJob.status === "running" ? "🔄" : "⏳";
            setAiAnswer(`${statusEmoji} ${updatedJob.status === "running" ? "AI arbeitet..." : "In Warteschlange..."}\n(${attempts * 2}s / 60s)`);
          }
        } catch (e) {
          // Polling-Fehler ignorieren, weitermachen
        }
      }, 2000); // Alle 2 Sekunden prüfen
      
    } catch (err: any) {
      setAiAnswer(`❌ Fehler beim Erstellen des Jobs: ${err.message}`);
      setAiAnswerLoading(false);
    }
  }, [query, facts, answerSources]);

  // Frage beantworten (RAG)
  const askQuestion = useCallback(async () => {
    if (!query.trim()) return;
    
    setAnswerLoading(true);
    setAnswer(null);
    setAnswerSources([]);
    setDocumentLinks([]);
    setError(null);
    
    try {
      // Erst Facts suchen (mehr holen für Filterung)
      const data = await api.rag.search(query, exactSearch ? 50 : 10);
      const results = data.results;
      let factsArray: Fact[] = Array.isArray(results) ? results : (results?.facts || []);
      
      // Bei exakter Suche: Nur Facts die den Suchbegriff enthalten
      if (exactSearch && factsArray.length > 0) {
        const searchTerms = query.toUpperCase().split(/\s+/).filter(t => t.length > 2);
        factsArray = factsArray.filter(f => {
          const factText = (f.fact || f.fact_text || f.name || "").toUpperCase();
          // Alle Suchbegriffe müssen im Fact vorkommen
          return searchTerms.every(term => factText.includes(term));
        });
      }
      
      if (factsArray.length === 0) {
        setAnswer(exactSearch 
          ? `Keine exakten Treffer für "${query}" gefunden. Versuche die semantische Suche.`
          : "Ich konnte keine relevanten Informationen zu dieser Frage finden.");
        setHasSearched(true);
        return;
      }
      
      // Facts als Kontext zusammenstellen
      const context = factsArray.map(f => 
        f.fact || f.fact_text || f.name || ""
      ).filter(Boolean).join("\n\n");
      
      // Quellen sammeln - aus episode_name oder aus dem Fact-Text extrahieren
      const extractedSources: string[] = [];
      
      factsArray.forEach(f => {
        // Priorität 1: episode_name wenn vorhanden
        if (f.episode_name) {
          extractedSources.push(f.episode_name);
        }
        // Priorität 2: GAP/JETZ Dokumentnummern aus dem Fact-Text extrahieren
        const factText = f.fact || f.fact_text || f.name || "";
        
        // Einfaches Regex: GAP + Zahl oder JETZ- + Zahl
        const gapMatches = factText.match(/GAP\d+/gi);
        const jetzMatches = factText.match(/JETZ-\d+/gi);
        
        if (gapMatches) {
          gapMatches.forEach(m => extractedSources.push(m.toUpperCase()));
        }
        if (jetzMatches) {
          jetzMatches.forEach(m => extractedSources.push(m.toUpperCase()));
        }
      });
      
      // Unique sources
      const sources = [...new Set(extractedSources)];
      setAnswerSources(sources);
      
      // Dokument-Links laden
      if (sources.length > 0) {
        try {
          const docsData = await api.rag.documents(sources);
          setDocumentLinks(docsData.documents || []);
        } catch (e) {
          console.log("Could not load document links:", e);
        }
      }
      
      // Antwort generieren (vereinfacht - zeigt den Kontext)
      const formattedAnswer = `**Basierend auf ${factsArray.length} gefundenen Fakten:**\n\n${context}`;
      setAnswer(formattedAnswer);
      setFacts(factsArray);
      setHasSearched(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAnswerLoading(false);
    }
  }, [query]);

  // Semantische Suche (Facts)
  const searchFacts = useCallback(async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.rag.search(query, 20);
      const results = data.results;
      const factsArray = Array.isArray(results) ? results : (results?.facts || []);
      setFacts(factsArray);
      setHasSearched(true);
    } catch (err: any) {
      setError(err.message);
      setFacts([]);
      setHasSearched(true);
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
      const results = data.results;
      const nodesArray = Array.isArray(results) ? results : (results?.nodes || []);
      setNodes(nodesArray);
      setHasSearched(true);
    } catch (err: any) {
      setError(err.message);
      setNodes([]);
      setHasSearched(true);
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
      const eps = data.episodes;
      const epsArray = Array.isArray(eps) ? eps : (eps?.episodes || []);
      setEpisodes(epsArray);
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
    setAnswer(null);
    
    if (tab === "episodes" && episodes.length === 0) {
      loadEpisodes();
    }
  };

  // Suche ausführen
  const handleSearch = () => {
    if (activeTab === "ask") {
      askQuestion();
    } else if (activeTab === "search") {
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

  // Modal öffnen
  const openModal = (item: Fact | Node | Episode, type: "fact" | "node" | "episode") => {
    setSelectedItem(item);
    setModalType(type);
  };

  // Modal schließen
  const closeModal = () => {
    setSelectedItem(null);
    setModalType(null);
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
            </span>
          ) : (
            <span className="status-error">❌ {status.error || "Nicht verbunden"}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="rag-tabs">
        <button 
          className={`rag-tab ${activeTab === "ask" ? "active" : ""}`}
          onClick={() => handleTabChange("ask")}
        >
          💬 Frage stellen
        </button>
        <button 
          className={`rag-tab ${activeTab === "search" ? "active" : ""}`}
          onClick={() => handleTabChange("search")}
        >
          🔍 Facts suchen
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
          📄 Dokumente ({episodes.length || "..."})
        </button>
      </div>

      {/* Suchfeld (für ask, search & nodes) */}
      {activeTab !== "episodes" && (
        <div className="rag-search-container">
          <div className="rag-search-box">
            <input
              type="text"
              placeholder={
                activeTab === "ask" 
                  ? (exactSearch ? "Exakt suchen... (z.B. 'GAP040')" : "Stelle eine Frage... (z.B. 'Was ist ein Zapfsäulenverwechsler?')")
                  : activeTab === "search"
                  ? "Nach Fakten suchen... (z.B. 'Fuel Pricing')"
                  : "Entity suchen... (z.B. 'POS', 'Kartengerät')"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="rag-search-input"
            />
            <button 
              onClick={handleSearch}
              disabled={loading || answerLoading || !query.trim()}
              className="rag-search-button"
            >
            {loading || answerLoading ? "⏳" : activeTab === "ask" ? "💬" : "🔍"}
            </button>
          </div>
          {activeTab === "ask" && (
            <div className="rag-search-options">
              <label className="rag-toggle">
                <input 
                  type="checkbox" 
                  checked={exactSearch} 
                  onChange={(e) => setExactSearch(e.target.checked)}
                />
                <span className="toggle-label">
                  {exactSearch ? "🎯 Exakte Suche" : "🔮 Semantische Suche"}
                </span>
              </label>
              <span className="search-hint">
                {exactSearch 
                  ? "Zeigt nur Treffer die den Suchbegriff exakt enthalten" 
                  : "Findet auch verwandte Informationen"}
              </span>
            </div>
          )}
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
        
        {/* ASK Tab - Frage beantworten */}
        {activeTab === "ask" && (
          <div className="rag-ask">
            {answerLoading ? (
              <div className="rag-loading">🤔 Suche nach relevanten Informationen...</div>
            ) : answer ? (
              <div className="rag-answer-container">
                <div className="rag-answer">
                  <div className="answer-header">💡 Antwort</div>
                  <div className="answer-text">{answer}</div>
                </div>
                {answerSources.length > 0 && (
                  <div className="rag-sources">
                    <div className="sources-header">📚 Quelldokumente ({answerSources.length})</div>
                    <div className="sources-list">
                      {documentLinks.length > 0 ? (
                        documentLinks.map((doc, idx) => (
                          <div key={idx} className="source-doc">
                            <span className="source-name">📄 {doc.name}</span>
                            {doc.driveUrl ? (
                              <div className="source-actions">
                                <a href={doc.driveUrl} target="_blank" rel="noopener noreferrer" className="source-link">
                                  👁️ Ansehen
                                </a>
                                <a href={doc.downloadUrl || doc.driveUrl} target="_blank" rel="noopener noreferrer" className="source-link download">
                                  ⬇️ Download
                                </a>
                              </div>
                            ) : (
                              <span className="source-no-link">(kein Link verfügbar)</span>
                            )}
                          </div>
                        ))
                      ) : (
                        answerSources.map((src, idx) => (
                          <span key={idx} className="source-tag">📄 {src}</span>
                        ))
                      )}
                    </div>
                  </div>
                )}
                {/* AI Answer Button & Result */}
                {facts.length > 0 && (
                  <div className="rag-ai-answer">
                    <div className="ai-answer-header">
                      <span>🤖 AI-Zusammenfassung</span>
                      <button 
                        onClick={generateAiAnswer}
                        disabled={aiAnswerLoading}
                        className="ai-answer-btn"
                      >
                        {aiAnswerLoading ? "⏳ Wird erstellt..." : "✨ Antwort generieren"}
                      </button>
                    </div>
                    {aiAnswer && (
                      <div className="ai-answer-result">
                        {aiAnswer}
                      </div>
                    )}
                    {!aiAnswer && !aiAnswerLoading && (
                      <div className="ai-answer-hint">
                        Klicke auf "Antwort generieren" um eine zusammenhängende AI-Antwort basierend auf den gefundenen Fakten zu erhalten.
                      </div>
                    )}
                  </div>
                )}
                
                {facts.length > 0 && (
                  <div className="rag-related-facts">
                    <div className="related-header">🔗 Gefundene Fakten ({facts.length})</div>
                    {facts.slice(0, 5).map((fact, idx) => (
                      <div 
                        key={fact.uuid || idx} 
                        className="rag-fact-card clickable"
                        onClick={() => openModal(fact, "fact")}
                      >
                        <div className="fact-text">
                          {fact.fact || fact.fact_text || fact.name || "—"}
                        </div>
                        {fact.episode_name && (
                          <div className="fact-source-doc">📄 {fact.episode_name}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rag-empty">
                {hasSearched 
                  ? "📭 Keine relevanten Informationen gefunden." 
                  : "💬 Stelle eine Frage zu deinen Dokumenten und erhalte eine Antwort basierend auf dem Knowledge Graph."}
              </div>
            )}
          </div>
        )}

        {/* Facts (Semantische Suche) */}
        {activeTab === "search" && (
          <div className="rag-facts">
            {loading ? (
              <div className="rag-loading">Suche läuft...</div>
            ) : facts.length === 0 ? (
              <div className="rag-empty">
                {hasSearched 
                  ? "📭 Keine Fakten gefunden." 
                  : "🔍 Suche nach Fakten und Beziehungen im Knowledge Graph."}
              </div>
            ) : (
              <>
                <div className="results-count">{facts.length} Fakten gefunden</div>
                {facts.map((fact, idx) => (
                  <div 
                    key={fact.uuid || idx} 
                    className="rag-fact-card clickable"
                    onClick={() => openModal(fact, "fact")}
                  >
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
                      <div className="fact-source-doc">📄 {fact.episode_name}</div>
                    )}
                    <div className="card-hint">Klicken für Details →</div>
                  </div>
                ))}
              </>
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
                {hasSearched 
                  ? "📭 Keine Entities gefunden." 
                  : "🏷️ Suche nach Entities (Personen, Systeme, Konzepte, Orte...)."}
              </div>
            ) : (
              <>
                <div className="results-count">{nodes.length} Entities gefunden</div>
                {nodes.map((node, idx) => (
                  <div 
                    key={node.uuid || idx} 
                    className="rag-node-card clickable"
                    onClick={() => openModal(node, "node")}
                  >
                    <div className="node-header">
                      <span className="node-name">{node.name || "Unbekannt"}</span>
                      {node.labels && node.labels.length > 0 && (
                        <span className="node-label">{node.labels[0]}</span>
                      )}
                    </div>
                    {node.summary && (
                      <div className="node-summary">{node.summary}</div>
                    )}
                    <div className="card-hint">Klicken für Details →</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Episodes (Dokumente) */}
        {activeTab === "episodes" && (
          <div className="rag-episodes">
            <div className="episodes-header">
              <span>📚 {episodes.length} Dokumente im Knowledge Graph</span>
              <button onClick={loadEpisodes} disabled={loading} className="refresh-btn">
                {loading ? "⏳" : "🔄"} Aktualisieren
              </button>
            </div>
            {loading ? (
              <div className="rag-loading">Lade Dokumente...</div>
            ) : episodes.length === 0 ? (
              <div className="rag-empty">
                📭 Keine Dokumente im Knowledge Graph.
                <br /><br />
                <small>Importiere PDFs um den Knowledge Graph zu füllen.</small>
              </div>
            ) : (
              <div className="episodes-grid">
                {episodes.map((ep, idx) => (
                  <div 
                    key={ep.uuid || idx} 
                    className="rag-episode-card clickable"
                    onClick={() => openModal(ep, "episode")}
                  >
                    <div className="episode-icon">📄</div>
                    <div className="episode-info">
                      <div className="episode-name">{ep.name || `Dokument ${idx + 1}`}</div>
                      {ep.source_description && (
                        <div className="episode-source">{ep.source_description}</div>
                      )}
                      {ep.group_id && (
                        <div className="episode-group">📁 {ep.group_id}</div>
                      )}
                    </div>
                    <div className="card-hint">→</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedItem && modalType && (
        <div className="rag-modal-overlay" onClick={closeModal}>
          <div className="rag-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>✕</button>
            
            {modalType === "fact" && (
              <div className="modal-content">
                <h3>🔗 Fakt Details</h3>
                <div className="modal-field">
                  <label>Fakt:</label>
                  <div className="modal-value">
                    {(selectedItem as Fact).fact || (selectedItem as Fact).fact_text || (selectedItem as Fact).name}
                  </div>
                </div>
                {(selectedItem as Fact).source_node && (
                  <div className="modal-field">
                    <label>Beziehung:</label>
                    <div className="modal-value relation">
                      <span className="rel-source">{(selectedItem as Fact).source_node}</span>
                      <span className="rel-arrow">→</span>
                      <span className="rel-target">{(selectedItem as Fact).target_node}</span>
                    </div>
                  </div>
                )}
                {(selectedItem as Fact).episode_name && (
                  <div className="modal-field">
                    <label>Quelle:</label>
                    <div className="modal-value">📄 {(selectedItem as Fact).episode_name}</div>
                  </div>
                )}
                {(selectedItem as Fact).created_at && (
                  <div className="modal-field">
                    <label>Erstellt:</label>
                    <div className="modal-value">{new Date((selectedItem as Fact).created_at!).toLocaleString("de-DE")}</div>
                  </div>
                )}
                {(selectedItem as Fact).uuid && (
                  <div className="modal-field">
                    <label>ID:</label>
                    <div className="modal-value mono">{(selectedItem as Fact).uuid}</div>
                  </div>
                )}
              </div>
            )}
            
            {modalType === "node" && (
              <div className="modal-content">
                <h3>🏷️ Entity Details</h3>
                <div className="modal-field">
                  <label>Name:</label>
                  <div className="modal-value large">{(selectedItem as Node).name}</div>
                </div>
                {(selectedItem as Node).labels && (selectedItem as Node).labels!.length > 0 && (
                  <div className="modal-field">
                    <label>Typ:</label>
                    <div className="modal-value">
                      {(selectedItem as Node).labels!.map((l, i) => (
                        <span key={i} className="type-tag">{l}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(selectedItem as Node).summary && (
                  <div className="modal-field">
                    <label>Zusammenfassung:</label>
                    <div className="modal-value">{(selectedItem as Node).summary}</div>
                  </div>
                )}
                {(selectedItem as Node).uuid && (
                  <div className="modal-field">
                    <label>ID:</label>
                    <div className="modal-value mono">{(selectedItem as Node).uuid}</div>
                  </div>
                )}
              </div>
            )}
            
            {modalType === "episode" && (
              <div className="modal-content">
                <h3>📄 Dokument Details</h3>
                <div className="modal-field">
                  <label>Name:</label>
                  <div className="modal-value large">{(selectedItem as Episode).name}</div>
                </div>
                {(selectedItem as Episode).source_description && (
                  <div className="modal-field">
                    <label>Beschreibung:</label>
                    <div className="modal-value">{(selectedItem as Episode).source_description}</div>
                  </div>
                )}
                {(selectedItem as Episode).group_id && (
                  <div className="modal-field">
                    <label>Gruppe:</label>
                    <div className="modal-value">📁 {(selectedItem as Episode).group_id}</div>
                  </div>
                )}
                {(selectedItem as Episode).content && (
                  <div className="modal-field">
                    <label>Inhalt (Vorschau):</label>
                    <div className="modal-value content-preview">
                      {(selectedItem as Episode).content!.substring(0, 500)}
                      {(selectedItem as Episode).content!.length > 500 && "..."}
                    </div>
                  </div>
                )}
                {(selectedItem as Episode).created_at && (
                  <div className="modal-field">
                    <label>Importiert:</label>
                    <div className="modal-value">{new Date((selectedItem as Episode).created_at!).toLocaleString("de-DE")}</div>
                  </div>
                )}
                {(selectedItem as Episode).uuid && (
                  <div className="modal-field">
                    <label>ID:</label>
                    <div className="modal-value mono">{(selectedItem as Episode).uuid}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default RagView;
