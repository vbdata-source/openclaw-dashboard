// ============================================================
// OpenClaw Dashboard — Job Executor
// ============================================================
// Überwacht die Job-Queue und führt Jobs über das Gateway aus
// ============================================================

import WebSocket from "ws";
import { jobStore, JobStatus } from "./jobStore.js";

class JobExecutor {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.connected = false;
    this.pendingRequests = new Map(); // id → { resolve, reject, timeout }
    this.currentJob = null;
    this.checkInterval = null;
    this.reconnectTimeout = null;
    this.requestIdCounter = 0;
  }

  // ── Start Executor ──────────────────────────────────────
  start() {
    console.log("[JobExecutor] Starting...");
    this.connect();
    
    // Queue alle 5 Sekunden prüfen
    this.checkInterval = setInterval(() => {
      this.checkQueue();
    }, 5000);

    // Auf queue.ready Events hören
    jobStore.subscribe((event) => {
      if (event === "queue.ready") {
        this.checkQueue();
      }
    });
  }

  stop() {
    console.log("[JobExecutor] Stopping...");
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Gateway Connection ──────────────────────────────────
  connect() {
    if (this.ws) {
      this.ws.close();
    }

    console.log("[JobExecutor] Connecting to Gateway:", this.config.gatewayWs);
    this.ws = new WebSocket(this.config.gatewayWs);

    this.ws.on("open", () => {
      console.log("[JobExecutor] WebSocket open, sending connect frame...");
      this.sendConnectFrame();
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("close", (code, reason) => {
      console.log(`[JobExecutor] WebSocket closed (${code}): ${reason || "no reason"}`);
      this.connected = false;
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[JobExecutor] WebSocket error:", err.message);
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;
    console.log("[JobExecutor] Reconnecting in 10s...");
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 10000);
  }

  sendConnectFrame() {
    const frame = {
      type: "req",
      method: "connect",
      id: `executor-connect-${Date.now()}`,
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-control-ui",
          version: "1.0.0",
          platform: "linux",
          mode: "webchat",
        },
        role: "operator",
        scopes: ["operator.read", "operator.write", "operator.admin"],
        auth: {},
      },
    };

    if (this.config.gatewayToken) {
      frame.params.auth.token = this.config.gatewayToken;
    }

    this.send(frame);
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Connect Response
    if (msg.type === "res" && msg.ok === true && !this.connected) {
      console.log("[JobExecutor] ✅ Connected to Gateway");
      this.connected = true;
      this.checkQueue(); // Sofort Queue prüfen
      return;
    }

    if (msg.type === "res" && msg.ok === false && !this.connected) {
      console.error("[JobExecutor] ❌ Connect failed:", msg.error);
      return;
    }

    // Response für pending Request
    if (msg.type === "res" && msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject, timeout } = this.pendingRequests.get(msg.id);
      clearTimeout(timeout);
      this.pendingRequests.delete(msg.id);

      if (msg.ok) {
        resolve(msg.payload || msg);
      } else {
        reject(new Error(msg.error?.message || "Request failed"));
      }
      return;
    }

    // Event für laufenden Job (Agent Stream)
    if (msg.type === "event" && msg.event === "agent" && this.currentJob) {
      this.handleAgentEvent(msg.payload);
    }
  }

  // ── Request Helper ──────────────────────────────────────
  request(method, params = {}, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = `exec-${++this.requestIdCounter}-${Date.now()}`;
      
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.send({
        type: "req",
        method,
        id,
        params,
      });
    });
  }

  // ── Queue Processing ────────────────────────────────────
  async checkQueue() {
    if (!this.connected) return;
    if (this.currentJob) return; // Bereits ein Job in Arbeit

    const nextJob = jobStore.getNextInQueue();
    if (!nextJob) return;

    console.log(`[JobExecutor] Starting job: ${nextJob.id} - "${nextJob.title}"`);
    await this.executeJob(nextJob);
  }

  async executeJob(job) {
    this.currentJob = job.id;

    try {
      // Job auf "running" setzen
      jobStore.update(job.id, { 
        status: JobStatus.RUNNING,
        historyMessage: "Job gestartet",
      });

      // Task an Gateway senden
      const result = await this.runAgentTask(job);

      // Job erfolgreich abgeschlossen
      jobStore.update(job.id, {
        status: JobStatus.DONE,
        result: this.summarizeResult(result),
        historyMessage: "Job erfolgreich abgeschlossen",
      });

      // Vollständiges Ergebnis speichern
      if (result) {
        jobStore.saveResult(job.id, typeof result === "string" ? result : JSON.stringify(result, null, 2));
      }

      console.log(`[JobExecutor] ✅ Job completed: ${job.id}`);
    } catch (err) {
      console.error(`[JobExecutor] ❌ Job failed: ${job.id}`, err.message);
      
      jobStore.update(job.id, {
        status: JobStatus.FAILED,
        error: err.message,
        historyMessage: `Fehler: ${err.message}`,
      });
    } finally {
      this.currentJob = null;
      // Nächsten Job prüfen
      setTimeout(() => this.checkQueue(), 1000);
    }
  }

  async runAgentTask(job) {
    // Task-Nachricht zusammenbauen
    const taskMessage = this.buildTaskMessage(job);

    console.log(`[JobExecutor] Sending task to agent: ${taskMessage.slice(0, 100)}...`);

    // Chat.send an Gateway - führt Agent-Turn aus
    const response = await this.request("chat.send", {
      sessionKey: `agent:main:dashboard:job:${job.id}`,
      message: taskMessage,
      waitForReply: true,
      timeoutSeconds: 300, // 5 Minuten max
    }, 330000);

    return response?.reply || response?.message || response;
  }

  buildTaskMessage(job) {
    let message = job.description || job.title;
    
    // Kontext hinzufügen
    if (job.title && job.description && job.title !== job.description) {
      message = `**Task: ${job.title}**\n\n${job.description}`;
    }

    // Priorität-Hinweis bei kritischen Jobs
    if (job.priority === "critical") {
      message = `⚠️ KRITISCH - Hohe Priorität!\n\n${message}`;
    }

    return message;
  }

  summarizeResult(result) {
    if (!result) return "Abgeschlossen (kein Ergebnis)";
    
    const text = typeof result === "string" ? result : JSON.stringify(result);
    
    // Erste 200 Zeichen als Zusammenfassung
    if (text.length > 200) {
      return text.slice(0, 197) + "...";
    }
    return text;
  }

  handleAgentEvent(payload) {
    // Optional: Live-Updates während Job-Ausführung
    // Könnte für Progress-Anzeige genutzt werden
    if (payload?.stream === "assistant" && payload?.data?.text) {
      // Agent schreibt gerade...
    }
  }
}

// ── Factory ───────────────────────────────────────────────
let executorInstance = null;

export function createJobExecutor(config) {
  if (executorInstance) {
    executorInstance.stop();
  }
  executorInstance = new JobExecutor(config);
  return executorInstance;
}

export function getJobExecutor() {
  return executorInstance;
}

export default JobExecutor;
