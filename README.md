# 🦞 OpenClaw Dashboard

Management-UI für OpenClaw — Job Board, Memory Editor, Session Monitor, Config Editor.

> 📖 **Ausführliche Deployment-Dokumentation:** [DEPLOYMENT.md](./DEPLOYMENT.md)  
> Beschreibt die Architektur, Neuinstallation, Troubleshooting und alle Environment Variables.

## Architektur

```
Browser ──HTTPS──→ [Dashboard :3200] ──internal──→ [OpenClaw :18789]
                   (exponiert)                     (nur Docker-intern)
```

Zwei getrennte Container, verbunden über ein internes Docker-Netzwerk.  
OpenClaw ist von außen nicht erreichbar — nur das Dashboard.

## Deployment in Coolify

### Option 1: Repo direkt bauen (empfohlen)

1. **Coolify → Neues Projekt → Docker Compose**
2. GitHub-Repo URL eintragen
3. Compose-File: `docker-compose.yml`
4. Environment Variables setzen:

```env
# Pflicht
OPENCLAW_HOST=openclaw-gateway        # Container-Name deines OpenClaw
OPENCLAW_GATEWAY_TOKEN=abc123...      # openssl rand -hex 32
DASHBOARD_SECRET=xyz789...            # openssl rand -hex 16
OPENCLAW_NETWORK_NAME=coolify_default # docker network ls

# Optional (für Settings UI)
OPENCLAW_DATA_PATH=/path/to/.openclaw/workspace    # Für Memory Editor
OPENCLAW_AGENTS_PATH=/path/to/.openclaw/agents     # Für Auth Settings
```

5. Deploy → Coolify klont, baut, startet.

### Option 2: Pre-Built Image

Falls GitHub Actions aktiv ist, wird bei jedem Push ein fertiges Image  
nach `ghcr.io/<user>/openclaw-dashboard:latest` gepusht.

→ Verwende `docker-compose.prebuilt.yml` und ersetze `<user>`.

### Netzwerk finden

Dein OpenClaw-Container läuft bereits in Coolify. So findest du den Netzwerk-Namen:

```bash
# Alle Netzwerke auflisten
docker network ls

# Oder direkt vom OpenClaw-Container:
docker inspect <openclaw-container> --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'
```

### Tokens generieren

```bash
openssl rand -hex 32   # → OPENCLAW_GATEWAY_TOKEN
openssl rand -hex 16   # → DASHBOARD_SECRET
```

## Lokale Entwicklung

```bash
# Terminal 1: Backend
cd server && npm install && npm run dev

# Terminal 2: Frontend (Vite Dev Server mit API-Proxy)
cd frontend && npm install && npm run dev
# → http://localhost:5173
```

## Features

| Modul | Status |
|---|---|
| 💬 Chat | ✅ Direct Chat mit Agent |
| ⚡ Sessions | ✅ Live-Sessions, Token-Tracking, Event Log |
| ▦ Job Board (Kanban) | ✅ 6 Lanes, Drag & Drop, Rückfragen |
| 🔄 Cron Jobs | ✅ Erstellen, Bearbeiten, Delivery |
| ◉ Memory Editor | ✅ Workspace-Dateien, memory/ Ordner |
| ⚙️ Settings | ✅ **NEU:** Graphische Konfiguration |
| 🔐 Login / Auth | ✅ JWT, httpOnly Cookie, Rate Limiting |
| 📡 WebSocket | ✅ Auto-Reconnect, Gateway-Proxy |

### Settings UI (Neu)

Vollständige graphische Konfiguration von OpenClaw:

| Section | Was konfigurierbar ist |
|---------|----------------------|
| 🤖 Agents | Model, Fallback, Concurrency, Compaction |
| 🔑 Auth | Provider, Modus (API/Max/OAuth), Tokens |
| 📱 Channels | Telegram, MS Teams, Discord |
| 🌐 Gateway | Mode, Bind, Trusted Proxies |
| 🔧 Tools | Exec Security, Elevated, Browser |
| ⚙️ Advanced | Meta, Debug |

**Features:**
- Token-Maskierung mit Show/Hide Toggle
- Automatische Erkennung von Claude Max (OAuth)
- Dirty State mit pulsierendem Save-Button
- Liest/schreibt echte Config-Dateien

## Sicherheit

- JWT Auth mit httpOnly Cookies
- Rate Limiting (120 req/min API, 10/15min Login)
- Helmet Security Headers
- Non-root Container User
- Kein direkter Gateway-Zugriff von außen
- Gateway-Token als Shared Secret

## Projektstruktur

```
├── Dockerfile                    # Multi-Stage Build
├── docker-compose.yml            # Coolify: baut aus Repo
├── docker-compose.prebuilt.yml   # Coolify: fertiges Image
├── .env.example
├── .github/workflows/build.yml   # CI: Image → GHCR
├── server/
│   ├── package.json
│   ├── index.js                  # Express + WS-Proxy + Auth + API
│   ├── jobStore.js               # Job-Persistenz
│   └── jobExecutor.js            # Job-Ausführung via OpenClaw
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx               # Hauptkomponente
        ├── app.css               # Styles
        ├── lib/api.ts            # REST API Client
        ├── hooks/useGateway.ts   # WebSocket Hook
        ├── styles/sessions.css   # Sessions Styles
        └── components/
            ├── SessionsView.tsx  # Sessions Tab
            ├── SessionCard.tsx   # Session Card
            └── settings/         # Settings UI
                ├── index.ts
                ├── SettingsView.tsx
                ├── SettingsField.tsx
                ├── SettingsSection.tsx
                └── SensitiveInput.tsx
```
