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
import { createJobExecutor } from "./jobExecutor.js";

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
  const gatewayWs = new WebSocket(config.gatewayWs);
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
        maxProtocol: 3,
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
        console.log("[WS] ✅ Gateway-Handshake erfolgreich (hello-ok)");

        // Status an Dashboard-Client senden
        clientWs.send(
          JSON.stringify({
            type: "gateway:status",
            status: "connected",
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
