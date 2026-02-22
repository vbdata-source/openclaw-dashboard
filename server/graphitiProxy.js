// ============================================================
// Graphiti Proxy — RAG Backend für Dashboard
// ============================================================
// Kommuniziert mit Graphiti-MCP Server (Streamable HTTP Transport)
// Requires: Session initialization before tool calls
// ============================================================

/**
 * Graphiti-MCP Proxy Klasse
 * Kommuniziert mit dem MCP-Server über HTTP/JSON-RPC mit Session-Management
 */
export class GraphitiProxy {
  constructor(baseUrl = "http://graphiti-mcp:8000") {
    this.baseUrl = baseUrl;
    this.mcpEndpoint = `${baseUrl}/mcp`;
    this.sessionId = null;
    this.initPromise = null;
    this.openaiApiKey = process.env.OPENAI_API_KEY || null;
  }

  /**
   * Initialisiert eine MCP Session (einmalig)
   */
  async initialize() {
    // Bereits initialisiert?
    if (this.sessionId) return this.sessionId;
    
    // Bereits in Initialisierung?
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const response = await fetch(this.mcpEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: {
                name: "openclaw-dashboard",
                version: "1.0.0",
              },
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Initialize failed: HTTP ${response.status}`);
        }

        // Session-ID aus Header lesen
        this.sessionId = response.headers.get("mcp-session-id");
        
        if (!this.sessionId) {
          throw new Error("No session ID received from MCP server");
        }

        console.log(`[GraphitiProxy] Session initialized: ${this.sessionId}`);
        return this.sessionId;
      } catch (error) {
        this.initPromise = null; // Reset für Retry
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * Parst SSE Event-Stream Response
   */
  parseSSEResponse(text) {
    // Format: "event: message\ndata: {...}\n\n"
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          return JSON.parse(line.substring(6));
        } catch {
          // Ignore parse errors
        }
      }
    }
    // Fallback: Try parsing entire text as JSON
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Führt einen MCP Tool-Call aus
   */
  async callTool(toolName, args = {}) {
    // Session sicherstellen
    await this.initialize();

    try {
      const response = await fetch(this.mcpEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "mcp-session-id": this.sessionId,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      });

      if (!response.ok) {
        // Session expired? Reset und Retry
        if (response.status === 400 || response.status === 401) {
          console.log("[GraphitiProxy] Session expired, reinitializing...");
          this.sessionId = null;
          this.initPromise = null;
          await this.initialize();
          return this.callTool(toolName, args); // Retry once
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      const data = this.parseSSEResponse(text);

      if (!data) {
        throw new Error("Failed to parse MCP response");
      }

      if (data.error) {
        throw new Error(data.error.message || "MCP Error");
      }

      // Extract result from MCP response
      if (data.result?.content?.[0]?.text) {
        try {
          return JSON.parse(data.result.content[0].text);
        } catch {
          return data.result.content[0].text;
        }
      }
      
      if (data.result?.structuredContent) {
        return data.result.structuredContent;
      }

      return data.result;
    } catch (error) {
      console.error(`[GraphitiProxy] Tool ${toolName} failed:`, error.message);
      throw error;
    }
  }

  /**
   * Status des Graphiti-Servers abrufen
   */
  async getStatus() {
    try {
      const result = await this.callTool("get_status");
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * LLM-basierte intelligente Projekt-Erkennung
   * Analysiert den Kontext der Frage um das relevante Projekt zu bestimmen
   */
  async classifyQueryWithLLM(query) {
    // Fallback wenn kein API Key
    if (!this.openaiApiKey) {
      console.log("[GraphitiProxy] No OpenAI key, using keyword fallback");
      return this.detectProjectFromKeywords(query);
    }

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Du bist ein Klassifizierer für Suchanfragen. Analysiere die Frage und entscheide welches Projekt relevant ist.

Projekte:
- vectron: Vectron POS Kassensystem, Lua Scripts (vbdata-*, .vsc Dateien), OrderAndPay, Remoteservice, VectronPOS API
- jet: JET Tankstellen-Projekt, GAP-Konzepte (GAP001-GAP999), JETZ-Tickets, Zapfsäulen, Fuel Pricing, POSLog, Kartengeräte

Antworte NUR mit einem Wort: vectron, jet, oder both`
            },
            {
              role: "user",
              content: query
            }
          ],
          max_tokens: 10,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        console.log(`[GraphitiProxy] OpenAI error: ${response.status}, using fallback`);
        return this.detectProjectFromKeywords(query);
      }

      const data = await response.json();
      const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase();
      
      console.log(`[GraphitiProxy] LLM classified "${query.substring(0,40)}..." as: ${answer}`);

      if (answer === "vectron") return ["vectron"];
      if (answer === "jet") return ["jet_projekt"];
      return ["jet_projekt", "vectron"];
      
    } catch (error) {
      console.error("[GraphitiProxy] LLM classification error:", error.message);
      return this.detectProjectFromKeywords(query);
    }
  }

  /**
   * Keyword-basierter Fallback (wenn LLM nicht verfügbar)
   */
  detectProjectFromKeywords(query) {
    const q = query.toLowerCase();
    
    if (q.includes('vectron') || q.includes('vbdata-') || q.includes('.vsc') || 
        q.includes('orderandpay') || q.includes('remoteservice')) {
      return ["vectron"];
    }
    
    if (q.includes('jet') || q.includes('gap0') || q.includes('jetz-') || 
        q.includes('zapfsäule') || q.includes('tankstelle') || q.includes('poslog')) {
      return ["jet_projekt"];
    }
    
    return ["jet_projekt", "vectron"];
  }

  /**
   * Semantische Suche nach Facts (Beziehungen)
   * @param {string} query - Suchanfrage
   * @param {number} limit - Max Ergebnisse (default: 10)
   * @param {string[]} groupIds - Projekt-Filter (default: LLM auto-detect)
   */
  async searchFacts(query, limit = 10, groupIds = null) {
    const args = {
      query,
      max_facts: limit,
    };
    // LLM-based project detection if not specified
    if (groupIds && groupIds.length > 0) {
      args.group_ids = groupIds;
    } else {
      args.group_ids = await this.classifyQueryWithLLM(query);
    }
    console.log(`[GraphitiProxy] searchFacts: query="${query.substring(0,50)}", groups=${args.group_ids}`);
    return this.callTool("search_memory_facts", args);
  }

  /**
   * Suche nach Nodes (Entities)
   * @param {string} query - Suchanfrage
   * @param {number} limit - Max Ergebnisse (default: 10)
   * @param {string[]} groupIds - Projekt-Filter (default: LLM auto-detect)
   */
  async searchNodes(query, limit = 10, groupIds = null) {
    const args = {
      query,
      limit,
    };
    // LLM-based project detection if not specified
    if (groupIds && groupIds.length > 0) {
      args.group_ids = groupIds;
    } else {
      args.group_ids = await this.classifyQueryWithLLM(query);
    }
    console.log(`[GraphitiProxy] searchNodes: query="${query.substring(0,50)}", groups=${args.group_ids}`);
    return this.callTool("search_nodes", args);
  }

  /**
   * Alle Episodes (importierte Dokumente/Chunks) abrufen
   * @param {number} lastN - Letzte N Episodes (default: 50)
   * @param {string[]} groupIds - Projekt-Filter (default: alle)
   */
  async getEpisodes(lastN = 50, groupIds = null) {
    const args = {
      last_n: lastN,
    };
    if (groupIds && groupIds.length > 0) {
      args.group_ids = groupIds;
    } else {
      args.group_ids = ["jet_projekt", "vectron"];
    }
    return this.callTool("get_episodes", args);
  }

  /**
   * Neuen Memory-Eintrag hinzufügen
   * @param {string} name - Name/Titel
   * @param {string} content - Inhalt
   */
  async addMemory(name, content) {
    return this.callTool("add_memory", {
      name,
      episode_body: content,
    });
  }

  /**
   * Health-Check (einfacher Ping - ohne Session)
   */
  async ping() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton-Instanz
export const graphitiProxy = new GraphitiProxy(
  process.env.GRAPHITI_MCP_URL || "http://graphiti-mcp:8000"
);
