# 🦞 OpenClaw Dashboard

Management-UI für OpenClaw — Job Board, Memory Editor, Session Monitor, Config Editor.

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
OPENCLAW_HOST=openclaw-gateway        # Container-Name deines OpenClaw
OPENCLAW_GATEWAY_TOKEN=abc123...      # openssl rand -hex 32
DASHBOARD_SECRET=xyz789...            # openssl rand -hex 16
OPENCLAW_NETWORK_NAME=coolify_default # docker network ls
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
| Job Board (Kanban) | ✅ 5 Lanes, Erstellen, Verschieben, Löschen |
| Memory & Identity Editor | ✅ 4 Scopes, Inline-Edit, CRUD |
| Session Monitor | ✅ Live-Sessions, Token-Tracking, Event Log |
| Config Editor | ✅ Visuell + JSON, alle Sektionen |
| Login / Auth | ✅ JWT, httpOnly Cookie, Rate Limiting |
| WebSocket Live-Events | ✅ Auto-Reconnect, Gateway-Proxy |

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
│   └── index.js                  # Express + WS-Proxy + Auth
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx               # Alle Views in einer Datei
        ├── app.css
        ├── lib/api.ts            # REST API Client
        └── hooks/useGateway.ts   # WebSocket Hook
```
