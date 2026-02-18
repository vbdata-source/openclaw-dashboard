// ============================================================
// Graphiti Proxy — RAG Backend für Dashboard
// ============================================================
// Kommuniziert mit Graphiti-MCP Server für:
//   - Semantische Suche (Facts)
//   - Entity-Suche (Nodes)
//   - Episode-Übersicht (importierte Dokumente)
// ============================================================

/**
 * Graphiti-MCP Proxy Klasse
 * Kommuniziert mit dem MCP-Server über HTTP/JSON-RPC
 */
export class GraphitiProxy {
  constructor(baseUrl = "http://jet-graphiti-mcp:8000") {
    this.baseUrl = baseUrl;
    this.mcpEndpoint = `${baseUrl}/mcp`;
  }

  /**
   * Führt einen MCP Tool-Call aus
   */
  async callTool(toolName, args = {}) {
    try {
      const response = await fetch(this.mcpEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || "MCP Error");
      }

      // MCP Response hat content Array mit text
      if (data.result?.content?.[0]?.text) {
        try {
          return JSON.parse(data.result.content[0].text);
        } catch {
          return data.result.content[0].text;
        }
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
   * Semantische Suche nach Facts (Beziehungen)
   * @param {string} query - Suchanfrage
   * @param {number} limit - Max Ergebnisse (default: 10)
   */
  async searchFacts(query, limit = 10) {
    return this.callTool("search_memory_facts", {
      query,
      max_facts: limit,
    });
  }

  /**
   * Suche nach Nodes (Entities)
   * @param {string} query - Suchanfrage
   * @param {number} limit - Max Ergebnisse (default: 10)
   */
  async searchNodes(query, limit = 10) {
    return this.callTool("search_nodes", {
      query,
      limit,
    });
  }

  /**
   * Alle Episodes (importierte Dokumente/Chunks) abrufen
   * @param {number} lastN - Letzte N Episodes (default: 50)
   */
  async getEpisodes(lastN = 50) {
    return this.callTool("get_episodes", {
      last_n: lastN,
    });
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
   * Health-Check (einfacher Ping)
   */
  async ping() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        timeout: 5000,
      });
      return response.ok;
    } catch {
      // Fallback: Status-Tool probieren
      try {
        await this.getStatus();
        return true;
      } catch {
        return false;
      }
    }
  }
}

// Singleton-Instanz
export const graphitiProxy = new GraphitiProxy(
  process.env.GRAPHITI_MCP_URL || "http://jet-graphiti-mcp:8000"
);
