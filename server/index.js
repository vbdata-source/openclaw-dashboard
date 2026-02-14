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
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────
const config = {
  port: parseInt(process.env.DASHBOARD_PORT || "3200"),
  gatewayWs: process.env.OPENCLAW_GATEWAY_URL || "ws://localhost:18789",
  gatewayHttp: process.env.OPENCLAW_GATEWAY_HTTP || "http://localhost:18789",
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
  dashboardSecret: process.env.DASHBOARD_SECRET || "change-me-in-production",
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || "480"), // Minuten
  nodeEnv: process.env.NODE_ENV || "development",
};

if (config.dashboardSecret === "change-me-in-production") {
  console.warn("⚠️  DASHBOARD_SECRET nicht gesetzt! Bitte in .env konfigurieren.");
}

// ── Express Setup ─────────────────────────────────────────
const app = express();
const server = createServer(app);

// Trust Proxy (Traefik/Coolify Reverse Proxy)
app.set("trust proxy", 1);

// Security Headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:", "blob:"],
      },
    },
  })
);

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 10,
  message: { error: "Zu viele Login-Versuche." },
});

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

  const response = await fetch(url, { ...options, headers, timeout: 10000 });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`Gateway ${response.status}: ${text}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    return response.json();
  }
  return response.text();
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

api.put("/config", async (req, res) => {
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

// ── Memory / Workspace Files ──────────────────────────────
api.get("/memory", async (req, res) => {
  try {
    const data = await gatewayFetch("/__openclaw__/memory");
    res.json(data);
  } catch (err) {
    // Fallback: Versuche Workspace-Dateien direkt zu lesen
    res.status(502).json({ error: "Memory konnte nicht geladen werden", detail: err.message });
  }
});

api.get("/memory/files/:filename", async (req, res) => {
  try {
    const allowed = ["IDENTITY.md", "SOUL.md", "USER.md"];
    const filename = req.params.filename;
    if (!allowed.includes(filename)) {
      return res.status(400).json({ error: "Datei nicht erlaubt" });
    }
    const data = await gatewayFetch(`/__openclaw__/workspace/${filename}`);
    res.json({ filename, content: data });
  } catch (err) {
    res.status(502).json({ error: "Datei nicht lesbar", detail: err.message });
  }
});

api.put("/memory/files/:filename", async (req, res) => {
  try {
    const allowed = ["IDENTITY.md", "SOUL.md", "USER.md"];
    const filename = req.params.filename;
    if (!allowed.includes(filename)) {
      return res.status(400).json({ error: "Datei nicht erlaubt" });
    }
    const data = await gatewayFetch(`/__openclaw__/workspace/${filename}`, {
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

api.post("/cron", async (req, res) => {
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

api.delete("/cron/:id", async (req, res) => {
  try {
    const data = await gatewayFetch(`/__openclaw__/cron/${req.params.id}`, {
      method: "DELETE",
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Cron-Job konnte nicht gelöscht werden", detail: err.message });
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

api.post("/approvals/:id", async (req, res) => {
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

app.use("/api", api);

// ── WebSocket Proxy ───────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  // Nur /ws Pfad akzeptieren
  if (!request.url?.startsWith("/ws")) {
    socket.destroy();
    return;
  }

  // Auth prüfen (Token als Query-Param oder Cookie)
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token =
    url.searchParams.get("token") ||
    parseCookies(request.headers.cookie || "").oc_session;

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
  console.log("[WS] Dashboard-Client verbunden");

  // Verbindung zum OpenClaw Gateway aufbauen (kein Token in URL — kommt im connect-Frame)
  const gatewayWs = new WebSocket(config.gatewayWs);
  let gatewayConnected = false;
  let handshakePhase = true; // true bis hello-ok empfangen
  let connectTimeout = null;

  gatewayWs.on("open", () => {
    console.log("[WS] Gateway WS offen, warte auf Challenge...");

    // Fallback: Falls kein Challenge kommt, sende connect nach 2s
    connectTimeout = setTimeout(() => {
      if (handshakePhase && gatewayWs.readyState === WebSocket.OPEN) {
        console.log("[WS] Kein Challenge erhalten, sende connect direkt...");
        sendConnectFrame();
      }
    }, 2000);
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
    const raw = data.toString();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      // Kein JSON — weiterleiten falls verbunden
      if (gatewayConnected && clientWs.readyState === WebSocket.OPEN) {
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
      clientWs.send(raw);
    }
  });

  // Client → Gateway (nur wenn verbunden)
  clientWs.on("message", (data) => {
    if (gatewayConnected && gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.send(data.toString());
    }
  });

  // Cleanup
  gatewayWs.on("close", (code, reason) => {
    gatewayConnected = false;
    handshakePhase = true;
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
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
    console.error("[WS] Gateway-Fehler:", err.message);
  });

  clientWs.on("close", () => {
    console.log("[WS] Dashboard-Client getrennt");
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
    if (gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error("[WS] Client-Fehler:", err.message);
  });
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
server.listen(config.port, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  🦞 OpenClaw Dashboard v1.0.0                   ║
║                                                  ║
║  Dashboard:  http://0.0.0.0:${String(config.port).padEnd(5)}              ║
║  Gateway:    ${config.gatewayWs.padEnd(35)} ║
║  Auth:       ${config.dashboardSecret === "change-me-in-production" ? "⚠️  DEFAULT (unsicher!)".padEnd(35) : "✅ Konfiguriert".padEnd(35)} ║
║  Env:        ${config.nodeEnv.padEnd(35)} ║
╚══════════════════════════════════════════════════╝
  `);
});

// Graceful Shutdown
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`\n[${signal}] Fahre herunter...`);
    wss.clients.forEach((ws) => ws.close());
    server.close(() => {
      console.log("Server beendet.");
      process.exit(0);
    });
  });
}