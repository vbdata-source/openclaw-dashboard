# OpenClaw Dashboard — Deployment Guide

Diese Dokumentation beschreibt wie das OpenClaw Dashboard mit OpenClaw zusammenarbeitet und wie beide Systeme auf einem neuen Server eingerichtet werden.

## 📋 Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                        Coolify Server                           │
│                                                                 │
│  ┌─────────────────────┐      ┌─────────────────────────────┐  │
│  │     OpenClaw        │      │    OpenClaw Dashboard       │  │
│  │   (Moltbot/Agent)   │      │      (Web UI)               │  │
│  │                     │      │                             │  │
│  │  - WebSocket :18789 │◄────►│  - Express Server :3200     │  │
│  │  - Config/Status    │      │  - React Frontend           │  │
│  │  - Sessions         │      │  - Job Executor             │  │
│  │                     │      │                             │  │
│  │  Volume:            │      │  Volumes:                   │  │
│  │  └─ /home/node/     │      │  ├─ /app/data (Jobs DB)     │  │
│  │     .openclaw/      │─────►│  └─ /openclaw-workspace/    │  │
│  │     └─ workspace/   │ bind │      workspace/ (ro/rw)     │  │
│  │        ├─ MEMORY.md │mount │                             │  │
│  │        ├─ SOUL.md   │      │                             │  │
│  │        └─ ...       │      │                             │  │
│  └─────────────────────┘      └─────────────────────────────┘  │
│                                                                 │
│  Netzwerk: coolify_default (oder custom)                        │
└─────────────────────────────────────────────────────────────────┘
```

## 🔗 Kommunikation

### WebSocket-Verbindung (Primär)

Das Dashboard verbindet sich per WebSocket zum OpenClaw Gateway:

```
Dashboard ──WebSocket──► OpenClaw Gateway (:18789)
```

**Funktionen über WebSocket:**
- Echtzeit-Status (Sessions, Channels, Heartbeat)
- Config lesen/schreiben
- Chat-History
- Cron-Jobs verwalten
- System Events senden

### Workspace-Zugriff (Bind-Mount)

Das Dashboard greift direkt auf OpenClaw's Workspace-Dateien zu:

```
/var/lib/docker/volumes/<openclaw-volume>/_data/workspace/
    ↓ (bind-mount)
/openclaw-workspace/workspace/
```

**Dateien im Workspace:**
- `MEMORY.md` — Langzeitgedächtnis
- `SOUL.md` — Persönlichkeit
- `IDENTITY.md` — Name & Rolle
- `USER.md` — Benutzer-Info
- `TOOLS.md` — Tool-Notizen
- `HEARTBEAT.md` — Heartbeat-Tasks
- `AGENTS.md` — Agent-Anweisungen
- `memory/*.md` — Tagesnotizen

---

## 🚀 Neuinstallation (Schritt für Schritt)

### Voraussetzungen

- Server mit Docker (empfohlen: Hetzner VPS, 4GB+ RAM)
- Coolify installiert (https://coolify.io)
- GitHub Account mit Zugriff auf beide Repos

### Schritt 1: OpenClaw installieren

1. **Neues Projekt in Coolify erstellen**
   - Name: z.B. "Moltbot" oder "OpenClaw"

2. **Service hinzufügen: Docker Compose**
   - GitHub Repo: `https://github.com/openclaw/openclaw` (oder Fork)
   - Branch: `main`

3. **Environment Variables setzen:**
   ```env
   # Telegram Bot Token
   TELEGRAM_BOT_TOKEN=your-bot-token
   
   # Gateway Token (für Dashboard-Zugriff)
   OPENCLAW_GATEWAY_TOKEN=your-secure-token
   
   # Optional: Weitere Channel-Configs
   ```

4. **Deploy** — warten bis Container läuft

5. **Volume-Name notieren:**
   - Coolify → Service → Persistent Storage
   - Der Volume-Name sieht aus wie: `d48ookcc80wg8ss48kwsckws_moltbot-data`
   - **Diesen Namen für Schritt 2 merken!**

### Schritt 2: Dashboard installieren

1. **Neues Projekt in Coolify erstellen**
   - Name: "OpenClaw Dashboard"

2. **Service hinzufügen: Docker Compose**
   - GitHub Repo: `https://github.com/vbdata-source/openclaw-dashboard`
   - Branch: `main`

3. **Environment Variables setzen:**
   ```env
   # ── OpenClaw Verbindung ──
   OPENCLAW_HOST=<openclaw-container-name>
   OPENCLAW_PORT=18789
   OPENCLAW_GATEWAY_TOKEN=<gleicher-token-wie-openclaw>
   
   # ── Workspace Volume ──
   # WICHTIG: Volume-Pfad aus Schritt 1.5!
   OPENCLAW_DATA_PATH=/var/lib/docker/volumes/<volume-name>/_data/workspace
   
   # ── Dashboard Auth ──
   DASHBOARD_SECRET=<random-32-char-string>
   
   # ── Netzwerk ──
   OPENCLAW_NETWORK_NAME=coolify_default
   ```

4. **Netzwerk konfigurieren:**
   - Beide Container müssen im gleichen Docker-Netzwerk sein
   - Standard: `coolify_default`
   - Bei Custom-Setup: Netzwerk-Name in beiden Services gleich setzen

5. **Deploy**

### Schritt 3: Verifizieren

1. **Dashboard öffnen:** `https://dashboard.your-domain.com`

2. **Login** mit dem konfigurierten `DASHBOARD_SECRET`

3. **Checken:**
   - ✅ Gateway verbunden (grüner Status)
   - ✅ Config/Status laden
   - ✅ Workspace-Dateien anzeigbar
   - ✅ Workspace-Dateien editierbar

---

## 🔧 Troubleshooting

### Problem: "Gateway disconnected"

**Ursache:** Dashboard kann OpenClaw nicht erreichen

**Lösungen:**
1. Container-Namen prüfen:
   ```bash
   docker ps --format "{{.Names}}" | grep -i openclaw
   ```
2. `OPENCLAW_HOST` auf korrekten Container-Namen setzen
3. Beide Container im gleichen Netzwerk?
   ```bash
   docker network inspect coolify_default
   ```

### Problem: "502 Bad Gateway" bei Memory-Dateien

**Ursache:** Workspace-Volume nicht gemountet oder falsche Permissions

**Diagnose:**
```bash
# Container-Name finden
docker ps | grep dashboard

# Volume prüfen
docker exec <dashboard-container> ls -la /openclaw-workspace/workspace/
```

**Mögliche Fehler:**
- `No such file or directory` → Volume nicht gemountet
- `Permission denied` → Falscher User (muss uid=1000 sein)

**Lösung:**
1. Volume-Pfad in `OPENCLAW_DATA_PATH` korrigieren
2. Pfad muss auf `.../workspace` enden (nicht `.openclaw`)

### Problem: "Datei nicht schreibbar"

**Ursache:** Dashboard-Container läuft nicht als uid=1000

**Prüfen:**
```bash
docker exec <dashboard-container> id
# Sollte: uid=1000(node) gid=1000(node) zeigen
```

**Lösung:** Dockerfile verwendet jetzt `USER node` (uid=1000)

### Problem: Volume ist leer nach Redeploy

**Ursache:** Coolify erstellt neue Volumes statt externe zu verwenden

**Lösung:** Bind-mount statt named volume verwenden:
```yaml
volumes:
  - /var/lib/docker/volumes/<volume-name>/_data/workspace:/openclaw-workspace/workspace
```

---

## 📁 Wichtige Pfade

### Auf dem Host

| Pfad | Beschreibung |
|------|--------------|
| `/var/lib/docker/volumes/<openclaw-volume>/_data/` | OpenClaw Home-Verzeichnis |
| `/var/lib/docker/volumes/<openclaw-volume>/_data/workspace/` | Workspace-Dateien |
| `/var/lib/docker/volumes/<openclaw-volume>/_data/openclaw.json` | OpenClaw Config |
| `/var/lib/docker/volumes/<dashboard-volume>/_data/` | Dashboard SQLite DB |

### Im Dashboard-Container

| Pfad | Beschreibung |
|------|--------------|
| `/app/` | Server + Frontend |
| `/app/data/dashboard.db` | SQLite (Jobs, Auth) |
| `/openclaw-workspace/workspace/` | Gemounteter Workspace |

### Im OpenClaw-Container

| Pfad | Beschreibung |
|------|--------------|
| `/home/node/.openclaw/` | OpenClaw Home |
| `/home/node/.openclaw/workspace/` | Workspace |
| `/home/node/.openclaw/openclaw.json` | Config |

---

## 🔐 Sicherheit

### Gateway Token

- Wird für WebSocket-Auth zwischen Dashboard und OpenClaw verwendet
- Muss in beiden Services identisch sein
- Empfehlung: 32+ Zeichen, zufällig generiert

```bash
# Token generieren
openssl rand -hex 32
```

### Dashboard Secret

- Wird für Session-Cookies und Login verwendet
- Nur im Dashboard gesetzt
- Bei Änderung: Alle User müssen neu einloggen

### Netzwerk-Isolation

- Dashboard und OpenClaw kommunizieren über internes Docker-Netzwerk
- Gateway-Port (18789) sollte NICHT nach außen exposed sein
- Nur Dashboard-Port (3200) wird über Coolify/Traefik exposed

---

## 📊 Environment Variables Referenz

### OpenClaw

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `OPENCLAW_GATEWAY_TOKEN` | Auth-Token für Dashboard | `abc123...` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | `123456:ABC...` |

### Dashboard

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `OPENCLAW_HOST` | OpenClaw Container-Name | `moltbot-xyz123` |
| `OPENCLAW_PORT` | Gateway Port | `18789` |
| `OPENCLAW_GATEWAY_TOKEN` | Auth-Token (gleich wie OpenClaw) | `abc123...` |
| `OPENCLAW_DATA_PATH` | Absoluter Pfad zum Workspace | `/var/lib/docker/volumes/.../workspace` |
| `DASHBOARD_SECRET` | Session-Secret | `random-string` |
| `OPENCLAW_NETWORK_NAME` | Docker Netzwerk | `coolify_default` |
| `SESSION_TIMEOUT` | Session-Timeout in Minuten | `480` |

---

## 🔄 Updates

### Dashboard updaten

1. Code ändern und pushen
2. Coolify erkennt automatisch → Redeploy
3. **Kein Datenverlust** — Volumes bleiben erhalten

### OpenClaw updaten

1. In Coolify: OpenClaw Service → Redeploy
2. Oder: `openclaw update.run` über Gateway

---

## 📝 Lessons Learned (Februar 2025)

1. **Coolify + externe Volumes:** `external: true` in docker-compose.yml funktioniert nicht zuverlässig. Besser: Bind-mounts mit absolutem Pfad.

2. **Permissions:** OpenClaw läuft als uid=1000, Dashboard muss auch als uid=1000 laufen für Schreibzugriff.

3. **Volume-Pfad:** Muss direkt auf `/workspace` zeigen, nicht auf `.openclaw` (hat 700 Permissions).

4. **Container-Namen:** Coolify vergibt eigene Namen (`service-xyz123-timestamp`), nicht die aus `container_name`.

---

*Dokumentation erstellt: 2025-02-14*
*Letzte Aktualisierung: 2025-02-14*
