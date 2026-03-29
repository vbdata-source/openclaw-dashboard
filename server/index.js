// ============================================================
// OpenClaw Dashboard — Backend Server
// ============================================================
// Aufgaben:
//   1. Static Files (React Build) ausliefern
//   2. Dashboard-Authentifizierung (Token-basiert)
//   3. WebSocket-Proxy zum OpenClaw Gateway
//   4. REST-API für Config, Memory, Sessions, Jobs
// ============================================================

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { jobStore, JobStatus } from "./jobStore.js";
import { templateStore } from "./templateStore.js";
import { createJobExecutor } from "./jobExecutor.js";
import { graphitiProxy } from "./graphitiProxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────
const config = {
  port: parseInt(process.env.DASHBOARD_PORT || "3200"),
  gatewayWs: process.env.OPENCLAW_GATEWAY_URL || "ws://localhost:18789",
  gatewayHttp: process.env.OPENCLAW_GATEWAY_HTTP || "http://localhost:18789",
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
  workspaceApiUrl: process.env.WORKSPACE_API_URL || "", // z.B. http://192.168.1.x:18790
  workspaceApiToken: process.env.WORKSPACE_API_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || "",
  dashboardSecret: process.env.DASHBOARD_SECRET || "",
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || "480"), // Minuten
  nodeEnv: process.env.NODE_ENV || "development",
};

// ── Env-Validierung (kritisch!) ───────────────────────────
const requiredEnvVars = ["dashboardSecret"];
const missingVars = requiredEnvVars.filter(k => !config[k] || config[k] === "change-me-in-production");

if (missingVars.length > 0 && config.nodeEnv === "production") {
  console.error("❌ KRITISCH: Fehlende Umgebungsvariablen:", missingVars.join(", "));
  console.error("   Bitte DASHBOARD_SECRET in .env setzen!");
  process.exit(1);
}

if (!config.dashboardSecret || config.dashboardSecret === "change-me-in-production") {
  console.warn("⚠️  DASHBOARD_SECRET nicht gesetzt! Bitte in .env konfigurieren.");
  // In Development: Fallback-Secret (nur für lokale Tests!)
  if (config.nodeEnv !== "production") {
    config.dashboardSecret = "dev-only-secret-" + crypto.randomBytes(16).toString("hex");
    console.warn("   → Dev-Fallback-Secret generiert (gilt nur für diese Session)");
  }
}

// ── Express Setup ─────────────────────────────────────────
const app = express();
const server = createServer(app);

// Trust Proxy (Traefik/Coolify Reverse Proxy)
app.set("trust proxy", 1);

// ── CSP Nonce Middleware ──────────────────────────────────
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

// Security Headers mit Nonce-basiertem CSP
app.use((req, res, next) => {
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `'nonce-${res.locals.nonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // Styles brauchen unsafe-inline für Vite
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false, // Für WebSocket-Kompatibilität
  })(req, res, next);
});

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 Minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Zu viele Anfragen. Bitte warte kurz." },
});
app.use("/api/", apiLimiter);

// Stricter limits for sensitive endpoints
const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30, // Nur 30 req/min für kritische Endpoints
  message: { error: "Zu viele Anfragen an diesen Endpoint." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 10,
  message: { error: "Zu viele Login-Versuche." },
});

// ── WebSocket Rate Limiting ───────────────────────────────
const wsAttempts = new Map(); // IP -> { count, firstAttempt }
const WS_RATE_LIMIT = 10; // Max Versuche
const WS_RATE_WINDOW = 30 * 1000; // 30 Sekunden

function checkWsRateLimit(ip) {
  const now = Date.now();
  const record = wsAttempts.get(ip);

  if (!record || now - record.firstAttempt > WS_RATE_WINDOW) {
    // Neues Fenster starten
    wsAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }

  if (record.count >= WS_RATE_LIMIT) {
    return false; // Limit erreicht
  }

  record.count++;
  return true;
}

// Cleanup alte Rate-Limit Einträge (alle 60s)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of wsAttempts.entries()) {
    if (now - record.firstAttempt > WS_RATE_WINDOW * 2) {
      wsAttempts.delete(ip);
    }
  }
}, 60000);

// ── Auth Middleware ────────────────────────────────────────
function generateToken(payload = {}) {
  return jwt.sign(payload, config.dashboardSecret, {
    expiresIn: `${config.sessionTimeout}m`,
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.dashboardSecret);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  // Token aus Cookie oder Authorization Header
  const token =
    req.cookies?.oc_session ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: "Nicht authentifiziert" });
  }
  next();
}

// ── Auth Routes ───────────────────────────────────────────
app.post("/api/auth/login", authLimiter, (req, res) => {
  const { secret } = req.body;

  if (!secret || secret !== config.dashboardSecret) {
    return res.status(401).json({ error: "Ungültiges Passwort" });
  }

  const token = generateToken({ role: "admin" });

  res.cookie("oc_session", token, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: config.sessionTimeout * 60 * 1000,
  });

  res.json({ ok: true, expiresIn: config.sessionTimeout * 60 });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("oc_session");
  res.json({ ok: true });
});

app.get("/api/auth/check", (req, res) => {
  const token =
    req.cookies?.oc_session ||
    req.headers.authorization?.replace("Bearer ", "");

  if (token && verifyToken(token)) {
    return res.json({ authenticated: true });
  }
  res.json({ authenticated: false });
});

// ── Health Check (unauthenticated) ────────────────────────
app.get("/api/health", async (req, res) => {
  let gatewayStatus = "unknown";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const gwRes = await fetch(`${config.gatewayHttp}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    gatewayStatus = gwRes.ok ? "connected" : "error";
  } catch {
    gatewayStatus = "disconnected";
  }

  res.json({
    status: "ok",
    gateway: gatewayStatus,
    version: "1.0.0",
    uptime: process.uptime(),
  });
});

// ── Internal API (no auth - for OpenClaw Agent) ───────────
app.post("/internal/jobs", express.json(), (req, res) => {
  try {
    const { title, description, priority = "medium", agent = "openclaw" } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: "title ist erforderlich" });
    }
    
    const job = jobStore.create({
      title,
      description: description || "",
      priority,
      status: "backlog",
      agent,
    });
    
    // WebSocket broadcast
    broadcastJobEvent("job.created", job);
    
    console.log(`[Internal API] Job created: ${job.id} - ${job.title}`);
    res.status(201).json(job);
  } catch (err) {
    console.error("[Internal API] Error creating job:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update job (für Status-Änderungen etc.)
app.put("/internal/jobs/:id", express.json(), (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const job = jobStore.update(id, updates);
    if (!job) {
      return res.status(404).json({ error: "Job nicht gefunden" });
    }
    
    broadcastJobEvent("job.updated", job);
    console.log(`[Internal API] Job updated: ${id} - status: ${job.status}`);
    res.json(job);
  } catch (err) {
    console.error("[Internal API] Error updating job:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete job
app.delete("/internal/jobs/:id", (req, res) => {
  try {
    const { id } = req.params;
    const job = jobStore.get(id);
    
    if (!job) {
      return res.status(404).json({ error: "Job nicht gefunden" });
    }
    
    jobStore.delete(id);
    broadcastJobEvent("job.deleted", job);
    console.log(`[Internal API] Job deleted: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[Internal API] Error deleting job:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Gateway Proxy Helpers ─────────────────────────────────
async function gatewayFetch(path, options = {}) {
  const url = `${config.gatewayHttp}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(config.gatewayToken && {
      Authorization: `Bearer ${config.gatewayToken}`,
    }),
    ...options.headers,
  };

  // AbortController für Timeout (Node-fetch ignoriert timeout option)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(`Gateway ${response.status}: ${text}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      return response.json();
    }
    return response.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── API Routes (all require auth) ─────────────────────────
const api = express.Router();
api.use(requireAuth);

// ── Gateway Status ────────────────────────────────────────
api.get("/gateway/status", async (req, res) => {
  try {
    const health = await gatewayFetch("/health");
    res.json(health);
  } catch (err) {
    res.status(502).json({ error: "Gateway nicht erreichbar", detail: err.message });
  }
});

// ── Sessions ──────────────────────────────────────────────
api.get("/sessions", async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/sessions");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Sessions konnten nicht geladen werden", detail: err.message });
  }
});

api.get("/sessions/:id", async (req, res) => {
  try {
    const data = await gatewayFetch(`/__openclaw__/sessions/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Session nicht gefunden", detail: err.message });
  }
});

// ── Config ────────────────────────────────────────────────
api.get("/config", async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/config");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Config konnte nicht geladen werden", detail: err.message });
  }
});

api.put("/config", sensitiveLimiter, async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/config", {
      method: "PUT",
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Config konnte nicht gespeichert werden", detail: err.message });
  }
});

// ── Gateway Control ───────────────────────────────────────
// Restart via config re-apply (triggers SIGUSR1 internally)
api.post("/gateway/restart", sensitiveLimiter, async (req, res) => {
  const { reason } = req.body;
  console.log(`[Gateway] Restart requested: ${reason || "no reason"}`);
  
  try {
    // Method 1: Try direct restart endpoint
    try {
      const restartRes = await fetch(`${config.gatewayHttp}/__openclaw__/restart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.gatewayToken && { Authorization: `Bearer ${config.gatewayToken}` }),
        },
        body: JSON.stringify({ reason, delayMs: 2000 }),
      });
      
      if (restartRes.ok) {
        const data = await restartRes.json();
        console.log("[Gateway] Direct restart successful:", data);
        return res.json({ ok: true, method: "direct", ...data });
      }
    } catch (e) {
      console.log("[Gateway] Direct restart not available, trying config reload...");
    }
    
    // Method 2: Config reload (re-apply triggers restart)
    const configRes = await gatewayFetch("/__openclaw__/config");
    if (configRes && typeof configRes === "object") {
      // Re-save config to trigger reload
      const saveRes = await gatewayFetch("/__openclaw__/config", {
        method: "PUT",
        body: JSON.stringify(configRes),
      });
      
      if (saveRes) {
        console.log("[Gateway] Config re-applied for restart");
        return res.json({ 
          ok: true, 
          method: "config-reload",
          message: "Config neu geladen - Gateway sollte neustarten" 
        });
      }
    }
    
    // Fallback: Manual instructions
    console.log("[Gateway] Restart methods failed, returning instructions");
    res.json({ 
      ok: false,
      error: "Automatischer Restart nicht möglich",
      message: "Das Dashboard konnte den Gateway nicht direkt neustarten.",
      instructions: [
        "Option 1: In Coolify → OpenClaw Service → Restart",
        "Option 2: SSH zum Server → docker restart <openclaw-container>",
        "Option 3: openclaw gateway restart (auf dem Host)"
      ],
      hint: "Config-Änderungen werden beim nächsten Gateway-Start übernommen."
    });
  } catch (err) {
    console.error("[Gateway] Restart error:", err);
    res.status(500).json({ 
      ok: false, 
      error: err.message,
      instructions: [
        "Option 1: In Coolify → OpenClaw Service → Restart",
        "Option 2: SSH zum Server → docker restart <openclaw-container>"
      ]
    });
  }
});

// ── Auth Profiles ─────────────────────────────────────────
// Auth profiles are stored separately from main config
// In Docker: /openclaw-agents/main/agent/auth-profiles.json
// Locally: /home/node/.openclaw/agents/main/agent/auth-profiles.json
const AUTH_PROFILES_PATH = process.env.OPENCLAW_AUTH_PROFILES || 
  (existsSync("/openclaw-agents/main/agent/auth-profiles.json") 
    ? "/openclaw-agents/main/agent/auth-profiles.json"
    : join(process.env.OPENCLAW_DIR || "/home/node/.openclaw", "agents/main/agent/auth-profiles.json"));

console.log(`[Auth] Profiles path: ${AUTH_PROFILES_PATH} (exists: ${existsSync(AUTH_PROFILES_PATH)})`);

api.get("/auth-profiles", async (req, res) => {
  try {
    if (existsSync(AUTH_PROFILES_PATH)) {
      const content = readFileSync(AUTH_PROFILES_PATH, "utf-8");
      const data = JSON.parse(content);
      res.json({ ok: true, profiles: data.profiles || {}, path: AUTH_PROFILES_PATH });
    } else {
      res.json({ ok: true, profiles: {}, path: AUTH_PROFILES_PATH, exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: "Auth-Profile konnten nicht geladen werden", detail: err.message });
  }
});

api.put("/auth-profiles", sensitiveLimiter, async (req, res) => {
  try {
    const { profiles } = req.body;
    if (!profiles || typeof profiles !== "object") {
      return res.status(400).json({ error: "profiles object required" });
    }
    
    // Read existing file to preserve other fields (version, lastGood, usageStats)
    let existing = { version: 1, profiles: {}, lastGood: {}, usageStats: {} };
    if (existsSync(AUTH_PROFILES_PATH)) {
      try {
        existing = JSON.parse(readFileSync(AUTH_PROFILES_PATH, "utf-8"));
      } catch {}
    }
    
    // Merge profiles (update existing, add new)
    const updated = {
      ...existing,
      profiles: { ...existing.profiles, ...profiles },
    };
    
    // Ensure directory exists
    const dir = dirname(AUTH_PROFILES_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    writeFileSync(AUTH_PROFILES_PATH, JSON.stringify(updated, null, 2), "utf-8");
    res.json({ ok: true, profiles: updated.profiles });
  } catch (err) {
    res.status(500).json({ error: "Auth-Profile konnten nicht gespeichert werden", detail: err.message });
  }
});

// ── Memory / Workspace Files ──────────────────────────────
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || "/openclaw-workspace/workspace";
const ALLOWED_FILES = ["MEMORY.md", "IDENTITY.md", "SOUL.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "AGENTS.md"];

// Prüfen ob lokales Workspace verfügbar ist
const useLocalWorkspace = existsSync(WORKSPACE_DIR);
console.log(`[Workspace] Mode: ${useLocalWorkspace ? "LOCAL (" + WORKSPACE_DIR + ")" : "API (" + config.workspaceApiUrl + ")"}`);

// Helper für Workspace API Requests (Fallback)
async function workspaceFetch(path, options = {}) {
  if (!config.workspaceApiUrl) {
    throw new Error("WORKSPACE_API_URL nicht konfiguriert und lokaler Workspace nicht verfügbar");
  }
  
  const url = `${config.workspaceApiUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(config.workspaceApiToken && {
      Authorization: `Bearer ${config.workspaceApiToken}`,
    }),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`Workspace API ${response.status}: ${text}`);
  }
  
  return response.json();
}

api.get("/memory", async (req, res) => {
  try {
    if (useLocalWorkspace) {
      const files = ALLOWED_FILES.map(name => {
        const filePath = join(WORKSPACE_DIR, name);
        const exists = existsSync(filePath);
        let size = 0;
        if (exists) {
          try { size = readFileSync(filePath, "utf-8").length; } catch {}
        }
        return { name, exists, size };
      });
      return res.json({ files });
    }
    const data = await workspaceFetch("/files");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Memory konnte nicht geladen werden", detail: err.message });
  }
});

api.get("/memory/files/:filename", async (req, res) => {
  try {
    const filename = basename(decodeURIComponent(req.params.filename));
    if (!ALLOWED_FILES.includes(filename)) {
      return res.status(400).json({ error: "Datei nicht erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const filePath = join(WORKSPACE_DIR, filename);
      if (!existsSync(filePath)) {
        return res.json({ filename, content: "" });
      }
      const content = readFileSync(filePath, "utf-8");
      return res.json({ filename, content });
    }
    
    const data = await workspaceFetch(`/files/${filename}`);
    res.json({ filename, content: data.content || "" });
  } catch (err) {
    res.status(502).json({ error: "Datei nicht lesbar", detail: err.message });
  }
});

api.put("/memory/files/:filename", sensitiveLimiter, async (req, res) => {
  try {
    const filename = basename(decodeURIComponent(req.params.filename));
    if (!ALLOWED_FILES.includes(filename)) {
      return res.status(400).json({ error: "Datei nicht erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const filePath = join(WORKSPACE_DIR, filename);
      writeFileSync(filePath, req.body.content || "", "utf-8");
      return res.json({ ok: true });
    }
    
    await workspaceFetch(`/files/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content: req.body.content }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: "Datei nicht schreibbar", detail: err.message });
  }
});

// ── Memory Folder (memory/*.md) ───────────────────────────
api.get("/memory/folder", async (req, res) => {
  try {
    if (useLocalWorkspace) {
      const memoryDir = join(WORKSPACE_DIR, "memory");
      if (!existsSync(memoryDir)) {
        return res.json({ files: [] });
      }
      const files = readdirSync(memoryDir)
        .filter(f => f.endsWith(".md"))
        .sort()
        .reverse()
        .map(name => {
          const filePath = join(memoryDir, name);
          let size = 0;
          try { size = readFileSync(filePath, "utf-8").length; } catch {}
          return { name, size };
        });
      return res.json({ files });
    }
    const data = await workspaceFetch("/memory");
    res.json(data);
  } catch (err) {
    res.json({ files: [] });
  }
});

api.get("/memory/folder/:filename", async (req, res) => {
  try {
    const filename = basename(decodeURIComponent(req.params.filename));
    if (!filename.endsWith(".md")) {
      return res.status(400).json({ error: "Nur .md Dateien erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const filePath = join(WORKSPACE_DIR, "memory", filename);
      if (!existsSync(filePath)) {
        return res.json({ filename, content: "" });
      }
      const content = readFileSync(filePath, "utf-8");
      return res.json({ filename, content });
    }
    
    const data = await workspaceFetch(`/memory/${filename}`);
    res.json({ filename, content: data.content || "" });
  } catch (err) {
    res.status(502).json({ error: "Datei nicht lesbar", detail: err.message });
  }
});

api.put("/memory/folder/:filename", sensitiveLimiter, async (req, res) => {
  try {
    const filename = basename(decodeURIComponent(req.params.filename));
    if (!filename.endsWith(".md")) {
      return res.status(400).json({ error: "Nur .md Dateien erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const memoryDir = join(WORKSPACE_DIR, "memory");
      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }
      const filePath = join(memoryDir, filename);
      writeFileSync(filePath, req.body.content || "", "utf-8");
      return res.json({ ok: true });
    }
    
    await workspaceFetch(`/memory/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content: req.body.content }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: "Datei nicht schreibbar", detail: err.message });
  }
});

// ── Auto-Scripts (scripts/*.js) ───────────────────────────
api.get("/scripts", async (req, res) => {
  try {
    if (useLocalWorkspace) {
      const scriptsDir = join(WORKSPACE_DIR, "scripts");
      if (!existsSync(scriptsDir)) {
        return res.json({ scripts: [] });
      }
      const scripts = readdirSync(scriptsDir)
        .filter(f => f.endsWith(".js"))
        .sort()
        .map(name => {
          const filePath = join(scriptsDir, name);
          let size = 0;
          let description = "";
          try { 
            const content = readFileSync(filePath, "utf-8");
            size = content.length;
            // Extract description from JSDoc header
            const docMatch = content.match(/\/\*\*[\s\S]*?\*\//);
            if (docMatch) {
              description = docMatch[0]
                .replace(/\/\*\*|\*\//g, "")
                .replace(/^\s*\*\s?/gm, "")
                .trim()
                .split("\n")[0]; // First line only
            }
          } catch {}
          return { name, size, description };
        });
      return res.json({ scripts });
    }
    res.json({ scripts: [], error: "Remote workspace not supported for scripts" });
  } catch (err) {
    res.status(502).json({ error: "Scripts nicht ladbar", detail: err.message });
  }
});

api.get("/scripts/:filename", async (req, res) => {
  try {
    const filename = basename(decodeURIComponent(req.params.filename));
    if (!filename.endsWith(".js")) {
      return res.status(400).json({ error: "Nur .js Dateien erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const filePath = join(WORKSPACE_DIR, "scripts", filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: "Script nicht gefunden" });
      }
      const content = readFileSync(filePath, "utf-8");
      return res.json({ filename, content });
    }
    
    res.status(502).json({ error: "Remote workspace not supported for scripts" });
  } catch (err) {
    res.status(502).json({ error: "Script nicht lesbar", detail: err.message });
  }
});

api.put("/scripts/:filename", sensitiveLimiter, async (req, res) => {
  try {
    const filename = basename(decodeURIComponent(req.params.filename));
    if (!filename.endsWith(".js")) {
      return res.status(400).json({ error: "Nur .js Dateien erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const scriptsDir = join(WORKSPACE_DIR, "scripts");
      if (!existsSync(scriptsDir)) {
        mkdirSync(scriptsDir, { recursive: true });
      }
      const filePath = join(scriptsDir, filename);
      writeFileSync(filePath, req.body.content || "", "utf-8");
      return res.json({ ok: true });
    }
    
    res.status(502).json({ error: "Remote workspace not supported for scripts" });
  } catch (err) {
    res.status(502).json({ error: "Script nicht schreibbar", detail: err.message });
  }
});

// ── Script Usage Search ───────────────────────────────────
api.get("/scripts/:filename/usage", async (req, res) => {
  try {
    const scriptName = basename(decodeURIComponent(req.params.filename));
    if (!scriptName.endsWith(".js")) {
      return res.status(400).json({ error: "Nur .js Dateien" });
    }
    
    const results = {
      cronJobs: [],
      scripts: [],
      memory: [],
      config: []
    };
    
    // 1. Search in Cron Jobs (via Gateway)
    try {
      const cronRes = await gatewayFetch("/__openclaw__/cron");
      const jobs = cronRes?.jobs || [];
      for (const job of jobs) {
        const text = job.payload?.text || job.payload?.message || "";
        if (text.includes(`scripts/${scriptName}`) || text.includes(scriptName.replace(".js", ""))) {
          results.cronJobs.push({
            id: job.id,
            name: job.name || job.id.slice(0, 8),
            enabled: job.enabled,
            schedule: job.schedule,
            match: text.match(new RegExp(`.{0,30}${scriptName.replace(".", "\\.")}.{0,30}`))?.[0] || scriptName
          });
        }
      }
    } catch (err) {
      console.error("[Usage] Cron search failed:", err.message);
    }
    
    // 2. Search in other scripts
    if (useLocalWorkspace) {
      const scriptsDir = join(WORKSPACE_DIR, "scripts");
      if (existsSync(scriptsDir)) {
        const files = readdirSync(scriptsDir).filter(f => f.endsWith(".js") && f !== scriptName);
        for (const file of files) {
          try {
            const content = readFileSync(join(scriptsDir, file), "utf-8");
            const scriptBase = scriptName.replace(".js", "");
            // Check for require or import
            if (content.includes(`require('./${scriptBase}')`) || 
                content.includes(`require("./${scriptBase}")`) ||
                content.includes(`require('./${scriptName}')`) ||
                content.includes(`require("./${scriptName}")`) ||
                content.includes(`from './${scriptBase}'`) ||
                content.includes(`from "./${scriptBase}"`) ||
                content.includes(`scripts/${scriptName}`)) {
              results.scripts.push({
                name: file,
                type: "require/import"
              });
            }
          } catch {}
        }
      }
      
      // 3. Search in memory files
      const memoryDir = join(WORKSPACE_DIR, "memory");
      if (existsSync(memoryDir)) {
        const searchDirs = [memoryDir, join(memoryDir, "skills")];
        for (const dir of searchDirs) {
          if (!existsSync(dir)) continue;
          const files = readdirSync(dir).filter(f => f.endsWith(".md"));
          for (const file of files) {
            try {
              const content = readFileSync(join(dir, file), "utf-8");
              if (content.includes(scriptName) || content.includes(scriptName.replace(".js", ""))) {
                const relPath = dir === memoryDir ? file : `skills/${file}`;
                results.memory.push({
                  name: relPath,
                  match: content.match(new RegExp(`.{0,40}${scriptName.replace(".", "\\.")}.{0,40}`))?.[0] || scriptName
                });
              }
            } catch {}
          }
        }
      }
      
      // Also search main workspace files
      const mainFiles = ["TOOLS.md", "AGENTS.md", "MEMORY.md"];
      for (const file of mainFiles) {
        try {
          const content = readFileSync(join(WORKSPACE_DIR, file), "utf-8");
          if (content.includes(scriptName) || content.includes(scriptName.replace(".js", ""))) {
            results.memory.push({
              name: file,
              match: content.match(new RegExp(`.{0,40}${scriptName.replace(".", "\\.")}.{0,40}`))?.[0] || scriptName
            });
          }
        } catch {}
      }
      
      // 4. Search in config files
      const configDir = join(WORKSPACE_DIR, "config");
      if (existsSync(configDir)) {
        const files = readdirSync(configDir).filter(f => f.endsWith(".json") || f.endsWith(".yaml"));
        for (const file of files) {
          try {
            const content = readFileSync(join(configDir, file), "utf-8");
            if (content.includes(scriptName)) {
              results.config.push({ name: file });
            }
          } catch {}
        }
      }
    }
    
    // Calculate total
    const totalUsages = results.cronJobs.length + results.scripts.length + 
                        results.memory.length + results.config.length;
    
    res.json({
      script: scriptName,
      totalUsages,
      ...results
    });
  } catch (err) {
    res.status(500).json({ error: "Suche fehlgeschlagen", detail: err.message });
  }
});

// ── Workspace Explorer (config/, data/, etc.) ────────────
const ALLOWED_EXPLORER_DIRS = ["config", "data", "scripts"];
const ALLOWED_EXTENSIONS = [".json", ".yaml", ".yml", ".js", ".md", ".txt", ".csv"];

// List directory contents
api.get("/explorer/:dir", async (req, res) => {
  try {
    const dir = basename(req.params.dir);
    if (!ALLOWED_EXPLORER_DIRS.includes(dir)) {
      return res.status(400).json({ error: "Verzeichnis nicht erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const targetDir = join(WORKSPACE_DIR, dir);
      if (!existsSync(targetDir)) {
        return res.json({ files: [], path: dir });
      }
      
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const files = entries.map(entry => {
        const fullPath = join(targetDir, entry.name);
        let size = 0;
        let modified = null;
        
        try {
          const stats = require("fs").statSync(fullPath);
          size = stats.size;
          modified = stats.mtime.toISOString();
        } catch {}
        
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size,
          modified,
          extension: entry.isDirectory() ? null : entry.name.split(".").pop()
        };
      }).sort((a, b) => {
        // Directories first, then by name
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      
      return res.json({ files, path: dir });
    }
    
    res.json({ files: [], path: dir, error: "Remote workspace not supported" });
  } catch (err) {
    res.status(502).json({ error: "Verzeichnis nicht lesbar", detail: err.message });
  }
});

// List subdirectory contents
api.get("/explorer/:dir/:subdir", async (req, res) => {
  try {
    const dir = basename(req.params.dir);
    const subdir = basename(req.params.subdir);
    if (!ALLOWED_EXPLORER_DIRS.includes(dir)) {
      return res.status(400).json({ error: "Verzeichnis nicht erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const targetDir = join(WORKSPACE_DIR, dir, subdir);
      if (!existsSync(targetDir)) {
        return res.json({ files: [], path: `${dir}/${subdir}` });
      }
      
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const files = entries.map(entry => {
        const fullPath = join(targetDir, entry.name);
        let size = 0;
        let modified = null;
        
        try {
          const stats = require("fs").statSync(fullPath);
          size = stats.size;
          modified = stats.mtime.toISOString();
        } catch {}
        
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size,
          modified,
          extension: entry.isDirectory() ? null : entry.name.split(".").pop()
        };
      }).sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      
      return res.json({ files, path: `${dir}/${subdir}` });
    }
    
    res.json({ files: [], path: `${dir}/${subdir}`, error: "Remote workspace not supported" });
  } catch (err) {
    res.status(502).json({ error: "Verzeichnis nicht lesbar", detail: err.message });
  }
});

// Read file from explorer
api.get("/explorer/:dir/file/*", async (req, res) => {
  try {
    const dir = basename(req.params.dir);
    const filePath = req.params[0]; // Everything after /file/
    
    if (!ALLOWED_EXPLORER_DIRS.includes(dir)) {
      return res.status(400).json({ error: "Verzeichnis nicht erlaubt" });
    }
    
    const ext = "." + filePath.split(".").pop();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: "Dateityp nicht erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const fullPath = join(WORKSPACE_DIR, dir, filePath);
      
      // Security: Ensure path doesn't escape workspace
      if (!fullPath.startsWith(join(WORKSPACE_DIR, dir))) {
        return res.status(400).json({ error: "Ungültiger Pfad" });
      }
      
      if (!existsSync(fullPath)) {
        return res.status(404).json({ error: "Datei nicht gefunden" });
      }
      
      const content = readFileSync(fullPath, "utf-8");
      const stats = require("fs").statSync(fullPath);
      
      return res.json({ 
        path: `${dir}/${filePath}`,
        content,
        size: stats.size,
        modified: stats.mtime.toISOString()
      });
    }
    
    res.status(502).json({ error: "Remote workspace not supported" });
  } catch (err) {
    res.status(502).json({ error: "Datei nicht lesbar", detail: err.message });
  }
});

// Write file from explorer
api.put("/explorer/:dir/file/*", sensitiveLimiter, async (req, res) => {
  try {
    const dir = basename(req.params.dir);
    const filePath = req.params[0];
    
    if (!ALLOWED_EXPLORER_DIRS.includes(dir)) {
      return res.status(400).json({ error: "Verzeichnis nicht erlaubt" });
    }
    
    const ext = "." + filePath.split(".").pop();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: "Dateityp nicht erlaubt" });
    }
    
    if (useLocalWorkspace) {
      const fullPath = join(WORKSPACE_DIR, dir, filePath);
      
      // Security: Ensure path doesn't escape workspace
      if (!fullPath.startsWith(join(WORKSPACE_DIR, dir))) {
        return res.status(400).json({ error: "Ungültiger Pfad" });
      }
      
      // Ensure parent directory exists
      const parentDir = dirname(fullPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      
      writeFileSync(fullPath, req.body.content || "", "utf-8");
      return res.json({ ok: true, path: `${dir}/${filePath}` });
    }
    
    res.status(502).json({ error: "Remote workspace not supported" });
  } catch (err) {
    res.status(502).json({ error: "Datei nicht schreibbar", detail: err.message });
  }
});

// ── Agent / Jobs ──────────────────────────────────────────
api.get("/agents", async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/agents");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Agents nicht ladbar", detail: err.message });
  }
});

api.get("/cron", async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/cron");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Cron-Jobs nicht ladbar", detail: err.message });
  }
});

api.post("/cron", sensitiveLimiter, async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/cron", {
      method: "POST",
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Cron-Job konnte nicht erstellt werden", detail: err.message });
  }
});

api.delete("/cron/:id", sensitiveLimiter, async (req, res) => {
  try {
    const data = await gatewayFetch(`/__openclaw__/cron/${req.params.id}`, {
      method: "DELETE",
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Cron-Job konnte nicht gelöscht werden", detail: err.message });
  }
});

// ── Cron Test Run (manuell ausführen) ─────────────────────
api.post("/cron/:id/test", sensitiveLimiter, async (req, res) => {
  try {
    const { channel, message } = req.body;
    
    if (!channel || !message) {
      return res.status(400).json({ error: "channel und message erforderlich" });
    }
    
    // Wake-Event senden der den Agent auffordert eine Nachricht zu senden
    const wakeText = `[CRON-TEST] Bitte sende folgende Nachricht an ${channel}: "${message}"`;
    
    const data = await gatewayFetch("/__openclaw__/wake", {
      method: "POST",
      body: JSON.stringify({
        text: wakeText,
        mode: "now",
      }),
    });
    
    res.json({ ok: true, data });
  } catch (err) {
    res.status(502).json({ 
      error: "Test konnte nicht ausgelöst werden", 
      detail: err.message 
    });
  }
});

// ── System Events ─────────────────────────────────────────
api.get("/events", async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/system/events");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Events nicht ladbar", detail: err.message });
  }
});

// ── Approvals ─────────────────────────────────────────────
api.get("/approvals", async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/approvals");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Approvals nicht ladbar", detail: err.message });
  }
});

api.post("/approvals/:id", sensitiveLimiter, async (req, res) => {
  try {
    const data = await gatewayFetch(`/__openclaw__/approvals/${req.params.id}`, {
      method: "POST",
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Approval-Aktion fehlgeschlagen", detail: err.message });
  }
});

// ── Jobs (Dashboard Job Queue) ────────────────────────────
// List all jobs
api.get("/jobs", (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    
    const jobs = jobStore.list(filter);
    const stats = jobStore.getStats();
    res.json({ jobs, stats });
  } catch (err) {
    res.status(500).json({ error: "Jobs nicht ladbar", detail: err.message });
  }
});

// Get single job
api.get("/jobs/:id", (req, res) => {
  try {
    const job = jobStore.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job nicht gefunden" });
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: "Job nicht ladbar", detail: err.message });
  }
});

// Create job
api.post("/jobs", sensitiveLimiter, (req, res) => {
  try {
    const { title, description, priority, status, scheduledAt, agent, channel } = req.body;
    
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: "Titel ist erforderlich" });
    }
    if (title.length > 200) {
      return res.status(400).json({ error: "Titel zu lang (max 200 Zeichen)" });
    }
    
    const job = jobStore.create({
      title: title.trim(),
      description: description?.trim() || "",
      priority: priority || "medium",
      status: status || "backlog",
      scheduledAt: scheduledAt || null,
      agent: agent || "main",
      channel: channel || null,
    });
    
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: "Job konnte nicht erstellt werden", detail: err.message });
  }
});

// Update job
api.put("/jobs/:id", sensitiveLimiter, (req, res) => {
  try {
    const job = jobStore.update(req.params.id, req.body);
    res.json(job);
  } catch (err) {
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: "Job nicht gefunden" });
    }
    res.status(500).json({ error: "Job konnte nicht aktualisiert werden", detail: err.message });
  }
});

// Delete job
api.delete("/jobs/:id", sensitiveLimiter, (req, res) => {
  try {
    jobStore.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: "Job nicht gefunden" });
    }
    res.status(500).json({ error: "Job konnte nicht gelöscht werden", detail: err.message });
  }
});

// Get job result
api.get("/jobs/:id/result", (req, res) => {
  try {
    const result = jobStore.getResult(req.params.id);
    if (result === null) {
      return res.status(404).json({ error: "Ergebnis nicht gefunden" });
    }
    res.type("text/plain").send(result);
  } catch (err) {
    res.status(500).json({ error: "Ergebnis nicht ladbar", detail: err.message });
  }
});

// Add clarification to pending job and requeue
api.post("/jobs/:id/clarify", sensitiveLimiter, (req, res) => {
  try {
    const { context } = req.body;
    if (!context || !context.trim()) {
      return res.status(400).json({ error: "Kontext ist erforderlich" });
    }

    const job = jobStore.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job nicht gefunden" });
    }

    if (job.status !== JobStatus.PENDING) {
      return res.status(400).json({ error: "Job ist nicht in Rückfrage-Status" });
    }

    const updatedJob = jobStore.addClarification(req.params.id, context.trim());
    res.json(updatedJob);
  } catch (err) {
    console.error("[API] Clarify error:", err);
    res.status(500).json({ error: "Kontext konnte nicht hinzugefügt werden", detail: err.message });
  }
});

// Move job to different status (convenience endpoint)
api.post("/jobs/:id/move", sensitiveLimiter, (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !Object.values(JobStatus).includes(status)) {
      return res.status(400).json({ error: "Ungültiger Status" });
    }
    
    const job = jobStore.update(req.params.id, { status });
    res.json(job);
  } catch (err) {
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: "Job nicht gefunden" });
    }
    res.status(500).json({ error: "Job konnte nicht verschoben werden", detail: err.message });
  }
});

// Get queue status
api.get("/jobs/queue/status", (req, res) => {
  try {
    const stats = jobStore.getStats();
    const nextJob = jobStore.getNextInQueue();
    res.json({ 
      ...stats, 
      nextJobId: nextJob?.id || null,
      nextJobTitle: nextJob?.title || null,
    });
  } catch (err) {
    res.status(500).json({ error: "Queue-Status nicht ladbar", detail: err.message });
  }
});

// ── Templates (Job Vorlagen) ──────────────────────────────
// List all templates
api.get("/templates", (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    
    const templates = templateStore.list(filter);
    const stats = templateStore.getStats();
    res.json({ templates, stats });
  } catch (err) {
    res.status(500).json({ error: "Templates nicht ladbar", detail: err.message });
  }
});

// Get single template
api.get("/templates/:id", (req, res) => {
  try {
    const template = templateStore.get(req.params.id);
    if (!template) {
      return res.status(404).json({ error: "Template nicht gefunden" });
    }
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: "Template nicht ladbar", detail: err.message });
  }
});

// Create template
api.post("/templates", sensitiveLimiter, (req, res) => {
  try {
    const { name, icon, description, priority, category, channel } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "Name ist erforderlich" });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: "Name zu lang (max 100 Zeichen)" });
    }
    
    const template = templateStore.create({
      name: name.trim(),
      icon: icon || "📋",
      description: description?.trim() || "",
      priority: priority || "medium",
      category: category || "Allgemein",
      channel: channel || null,
    });
    
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: "Template konnte nicht erstellt werden", detail: err.message });
  }
});

// Update template
api.put("/templates/:id", sensitiveLimiter, (req, res) => {
  try {
    const template = templateStore.update(req.params.id, req.body);
    res.json(template);
  } catch (err) {
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: "Template nicht gefunden" });
    }
    res.status(500).json({ error: "Template konnte nicht aktualisiert werden", detail: err.message });
  }
});

// Delete template
api.delete("/templates/:id", sensitiveLimiter, (req, res) => {
  try {
    templateStore.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: "Template nicht gefunden" });
    }
    res.status(500).json({ error: "Template konnte nicht gelöscht werden", detail: err.message });
  }
});

// Get categories
api.get("/templates/categories", (req, res) => {
  try {
    const categories = templateStore.getCategories();
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: "Kategorien nicht ladbar", detail: err.message });
  }
});

// Create job from template
api.post("/templates/:id/run", sensitiveLimiter, (req, res) => {
  try {
    const template = templateStore.get(req.params.id);
    if (!template) {
      return res.status(404).json({ error: "Template nicht gefunden" });
    }
    
    // Create job from template
    const job = jobStore.create({
      title: template.name,
      description: template.description,
      priority: template.priority,
      channel: template.channel,
      status: "queued", // Directly queue the job
    });
    
    res.status(201).json({ job, template });
  } catch (err) {
    res.status(500).json({ error: "Job konnte nicht erstellt werden", detail: err.message });
  }
});

// ── RAG / Graphiti API ────────────────────────────────────
api.get("/rag/status", async (req, res) => {
  try {
    const status = await graphitiProxy.getStatus();
    res.json(status);
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

api.get("/rag/search", async (req, res) => {
  const { q, query, limit = "10" } = req.query;
  const searchQuery = q || query;

  if (!searchQuery) {
    return res.status(400).json({ error: "Query parameter 'q' required" });
  }

  try {
    const results = await graphitiProxy.searchFacts(searchQuery, parseInt(limit));
    res.json({ query: searchQuery, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get("/rag/nodes", async (req, res) => {
  const { q, query, limit = "10" } = req.query;
  const searchQuery = q || query;

  if (!searchQuery) {
    return res.status(400).json({ error: "Query parameter 'q' required" });
  }

  try {
    const results = await graphitiProxy.searchNodes(searchQuery, parseInt(limit));
    res.json({ query: searchQuery, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get("/rag/episodes", async (req, res) => {
  const { limit = "50" } = req.query;

  try {
    const episodes = await graphitiProxy.getEpisodes(parseInt(limit));
    res.json({ episodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/rag/memory", async (req, res) => {
  const { name, content } = req.body;

  if (!name || !content) {
    return res.status(400).json({ error: "Fields 'name' and 'content' required" });
  }

  try {
    const result = await graphitiProxy.addMemory(name, content);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rag/documents?names=doc1,doc2 - Get Google Drive links for documents
api.get("/rag/documents", async (req, res) => {
  const { names } = req.query;
  
  if (!names) {
    return res.status(400).json({ error: "Query parameter 'names' required" });
  }

  try {
    // Load imported files mapping
    const importedFilesPath = process.env.IMPORTED_FILES_PATH || 
      "/openclaw-workspace/workspace/config/google/imported-files.json";
    
    let importedFiles = {};
    try {
      const data = readFileSync(importedFilesPath, "utf8");
      importedFiles = JSON.parse(data);
    } catch (e) {
      // File doesn't exist or isn't readable
      console.log("[RAG] Could not read imported-files.json:", e.message);
    }

    // Build reverse lookup: fileName -> fileId
    const fileNameToId = {};
    for (const [fileId, info] of Object.entries(importedFiles)) {
      if (info.fileName) {
        // Store with and without extension for flexible matching
        fileNameToId[info.fileName] = fileId;
        fileNameToId[info.fileName.replace(/\.pdf$/i, "")] = fileId;
      }
    }

    // Parse requested names
    const requestedNames = names.split(",").map(n => n.trim()).filter(Boolean);
    
    // Find matching documents
    const documents = requestedNames.map(name => {
      // Clean up name: remove trailing punctuation, quotes
      const cleanName = name.replace(/['".,;:!?]+$/g, "").trim();
      
      // Try exact match first
      let fileId = fileNameToId[cleanName] || fileNameToId[cleanName + ".pdf"];
      let matchedFileName = cleanName;
      
      // Fuzzy match if no exact match
      if (!fileId) {
        const lowerName = cleanName.toLowerCase();
        
        // Extract GAP/JETZ number for targeted matching
        const docNumMatch = cleanName.match(/(GAP\d+|JETZ-\d+)/i);
        const docNum = docNumMatch ? docNumMatch[1].toUpperCase() : null;
        
        for (const [fileName, id] of Object.entries(fileNameToId)) {
          const lowerFileName = fileName.toLowerCase();
          
          // Match by document number (most reliable)
          if (docNum && lowerFileName.toUpperCase().includes(docNum)) {
            fileId = id;
            matchedFileName = fileName;
            break;
          }
          
          // Fallback: partial name match
          if (!docNum && (lowerFileName.includes(lowerName) || lowerName.includes(lowerFileName.replace(/\.pdf$/i, "")))) {
            fileId = id;
            matchedFileName = fileName;
            break;
          }
        }
      }

      if (fileId) {
        return {
          name: matchedFileName.replace(/\.pdf$/i, ""),
          fileId,
          driveUrl: `https://drive.google.com/file/d/${fileId}/view`,
          downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
        };
      }
      return { name, fileId: null, driveUrl: null, downloadUrl: null };
    });

    res.json({ documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/api", api);

// ── WebSocket Proxy ───────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

// Metrics (simple counters)
let wsConnectionsActive = 0;
let wsMessagesTotal = 0;
let wsErrorsTotal = 0;

// ── Job Events Broadcast ──────────────────────────────────
// Alle verbundenen Dashboard-Clients
const dashboardClients = new Set();

// Broadcast Job-Events an alle Clients
function broadcastJobEvent(event, job) {
  const message = JSON.stringify({
    type: "event",
    event: event,
    payload: job,
    timestamp: new Date().toISOString(),
  });
  
  for (const ws of dashboardClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch (err) {
        console.error("[WS] Broadcast error:", err.message);
      }
    }
  }
}

// Subscribe to JobStore events
jobStore.subscribe((event, job) => {
  console.log(`[JobStore] Event: ${event}`, job?.id || "");
  broadcastJobEvent(event, job);
});

server.on("upgrade", (request, socket, head) => {
  // Nur /ws Pfad akzeptieren
  if (!request.url?.startsWith("/ws")) {
    socket.destroy();
    return;
  }

  // IP für Rate-Limiting
  const ip = request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
             request.socket.remoteAddress ||
             "unknown";

  // WebSocket Rate-Limiting prüfen
  if (!checkWsRateLimit(ip)) {
    console.warn(`[WS] Rate limit exceeded for IP: ${ip}`);
    wsErrorsTotal++;
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    socket.destroy();
    return;
  }

  // Auth prüfen (nur Cookie - kein Token in URL aus Sicherheitsgründen)
  const token = parseCookies(request.headers.cookie || "").oc_session;

  if (!token || !verifyToken(token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (clientWs, request) => {
  wsConnectionsActive++;
  dashboardClients.add(clientWs);
  console.log(`[WS] Dashboard-Client verbunden (active: ${wsConnectionsActive})`);

  // Verbindung zum OpenClaw Gateway aufbauen (kein Token in URL — kommt im connect-Frame)
  // Origin-Header setzen für Gateway CORS-Check
  const gatewayWs = new WebSocket(config.gatewayWs, {
    headers: { Origin: "https://dashboard.vbdata-cloud.at" },
  });
  let gatewayConnected = false;
  let handshakePhase = true; // true bis hello-ok empfangen
  let connectTimeout = null;
  let pingInterval = null;

  gatewayWs.on("open", () => {
    console.log("[WS] Gateway WS offen, warte auf Challenge...");

    // Heartbeat / Ping-Pong starten (30s Intervall)
    pingInterval = setInterval(() => {
      if (gatewayWs.readyState === WebSocket.OPEN) {
        gatewayWs.ping();
      }
    }, 30000);

    // Fallback: Falls kein Challenge kommt, sende connect nach 2s
    connectTimeout = setTimeout(() => {
      if (handshakePhase && gatewayWs.readyState === WebSocket.OPEN) {
        console.log("[WS] Kein Challenge erhalten, sende connect direkt...");
        sendConnectFrame();
      }
    }, 2000);
  });

  // Pong-Handler für Heartbeat
  gatewayWs.on("pong", () => {
    // Optional: Latenz-Logging
    // console.log("[WS] Pong received from gateway");
  });

  function sendConnectFrame() {
    const connectFrame = {
      type: "req",
      method: "connect",
      id: `dashboard-${Date.now()}`,
      params: {
        minProtocol: 3,
        maxProtocol: 5,
        client: {
          id: "openclaw-control-ui",
          version: "1.0.0",
          platform: "linux",
          mode: "webchat",
        },
        role: "operator",
        scopes: [
          "operator.read",
          "operator.write",
          "operator.admin",
        ],
        auth: {},
      },
    };

    // Token-Auth
    if (config.gatewayToken) {
      connectFrame.params.auth.token = config.gatewayToken;
    }

    console.log("[WS] Sende connect-Frame (role: operator)");
    gatewayWs.send(JSON.stringify(connectFrame));
  }

  // Gateway → Client (mit Handshake-Logik)
  gatewayWs.on("message", (data) => {
    wsMessagesTotal++;
    const raw = data.toString();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      // Kein JSON — weiterleiten falls verbunden
      if (gatewayConnected && clientWs.readyState === WebSocket.OPEN) {
        // Back-Pressure Check
        if (clientWs.bufferedAmount > 2_000_000) {
          console.warn("[WS] Back-pressure: dropping message to client");
          return;
        }
        clientWs.send(raw);
      }
      return;
    }

    // ── Handshake-Phase ──────────────────────────────────
    if (handshakePhase) {
      // 1) Challenge vom Gateway → connect-Frame senden
      if (msg.type === "event" && msg.event === "connect.challenge") {
        console.log("[WS] Challenge erhalten, sende connect-Frame...");
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
        sendConnectFrame();
        return;
      }

      // 2) hello-ok → Handshake erfolgreich!
      if (msg.type === "res" && msg.ok === true) {
        handshakePhase = false;
        gatewayConnected = true;
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
        
        // Version aus hello-ok payload extrahieren
        const serverVersion = msg.payload?.server?.version || null;
        console.log("[WS] ✅ Gateway-Handshake erfolgreich (hello-ok), version:", serverVersion);

        // Status an Dashboard-Client senden (inkl. Version)
        clientWs.send(
          JSON.stringify({
            type: "gateway:status",
            status: "connected",
            version: serverVersion,
            timestamp: new Date().toISOString(),
          })
        );

        // Health-Request senden um Gateway-Status zu bekommen
        gatewayWs.send(
          JSON.stringify({
            type: "req",
            method: "health",
            id: `health-${Date.now()}`,
          })
        );
        return;
      }

      // 3) Fehler-Response → Handshake fehlgeschlagen
      if (msg.type === "res" && msg.ok === false) {
        console.error("[WS] ❌ Gateway-Handshake fehlgeschlagen:", JSON.stringify(msg.error || msg));
        wsErrorsTotal++;
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
        clientWs.send(
          JSON.stringify({
            type: "gateway:status",
            status: "error",
            error: msg.error?.message || "Handshake fehlgeschlagen",
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      // Unbekannte Handshake-Nachricht loggen
      console.log("[WS] Handshake-Phase, unerwartete Nachricht:", msg.type, msg.method || msg.event || "");
      return;
    }

    // ── Verbundene Phase — Events an Client weiterleiten ──
    if (clientWs.readyState === WebSocket.OPEN) {
      // Back-Pressure Check
      if (clientWs.bufferedAmount > 2_000_000) {
        console.warn("[WS] Back-pressure: dropping message to client");
        return;
      }
      clientWs.send(raw);
    }
  });

  // Client → Gateway (nur wenn verbunden)
  clientWs.on("message", (data) => {
    wsMessagesTotal++;
    if (gatewayConnected && gatewayWs.readyState === WebSocket.OPEN) {
      // Back-Pressure Check
      if (gatewayWs.bufferedAmount > 2_000_000) {
        console.warn("[WS] Back-pressure: dropping message to gateway");
        return;
      }
      gatewayWs.send(data.toString());
    }
  });

  // Cleanup helper
  function cleanup() {
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  }

  // Cleanup
  gatewayWs.on("close", (code, reason) => {
    gatewayConnected = false;
    handshakePhase = true;
    cleanup();
    console.log(`[WS] Gateway-Verbindung getrennt (code=${code}, reason=${reason || "n/a"})`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "gateway:status",
          status: "disconnected",
          timestamp: new Date().toISOString(),
        })
      );
    }
  });

  gatewayWs.on("error", (err) => {
    wsErrorsTotal++;
    console.error("[WS] Gateway-Fehler:", err.message);
  });

  clientWs.on("close", () => {
    wsConnectionsActive--;
    dashboardClients.delete(clientWs);
    console.log(`[WS] Dashboard-Client getrennt (active: ${wsConnectionsActive})`);
    cleanup();
    if (gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.close();
    }
  });

  clientWs.on("error", (err) => {
    wsErrorsTotal++;
    console.error("[WS] Client-Fehler:", err.message);
  });
});

// ── Simple Metrics Endpoint ───────────────────────────────
app.get("/metrics", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send(`# HELP ws_connections_active Active WebSocket connections
# TYPE ws_connections_active gauge
ws_connections_active ${wsConnectionsActive}

# HELP ws_messages_total Total WebSocket messages processed
# TYPE ws_messages_total counter
ws_messages_total ${wsMessagesTotal}

# HELP ws_errors_total Total WebSocket errors
# TYPE ws_errors_total counter
ws_errors_total ${wsErrorsTotal}

# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds gauge
process_uptime_seconds ${Math.floor(process.uptime())}
`);
});

// ── Static Files (React Build) ────────────────────────────
const publicDir = join(__dirname, "public");
app.use(express.static(publicDir, { maxAge: "1h" }));

// SPA Fallback — alle nicht-API Routes bekommen index.html
app.get("*", (req, res) => {
  const indexPath = join(publicDir, "index.html");
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: "Frontend nicht gebaut. Bitte 'pnpm build' im frontend/ Ordner ausführen." });
  }
});

// ── Helpers ───────────────────────────────────────────────
function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...val] = c.trim().split("=");
      return [key, val.join("=")];
    })
  );
}

// ── Start ─────────────────────────────────────────────────
// Job Executor initialisieren
const jobExecutor = createJobExecutor({
  gatewayWs: config.gatewayWs,
  gatewayToken: config.gatewayToken,
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  🦞 OpenClaw Dashboard v1.2.0                   ║
║                                                  ║
║  Dashboard:  http://0.0.0.0:${String(config.port).padEnd(5)}              ║
║  Gateway:    ${config.gatewayWs.padEnd(35)} ║
║  Auth:       ${!config.dashboardSecret || config.dashboardSecret.startsWith("dev-only") ? "⚠️  DEV MODE (unsicher!)".padEnd(35) : "✅ Konfiguriert".padEnd(35)} ║
║  Env:        ${config.nodeEnv.padEnd(35)} ║
║  Metrics:    /metrics                            ║
║  Executor:   ✅ Aktiv                            ║
╚══════════════════════════════════════════════════╝
  `);

  // Job Executor starten
  jobExecutor.start();
});

// Graceful Shutdown
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`\n[${signal}] Fahre herunter...`);
    // Job Executor stoppen
    jobExecutor.stop();
    // Alle Client-Verbindungen schließen (inkl. Gateway-Verbindungen)
    wss.clients.forEach((ws) => {
      ws.close(1001, "Server shutdown");
    });
    server.close(() => {
      console.log("Server beendet.");
      process.exit(0);
    });
  });
}
