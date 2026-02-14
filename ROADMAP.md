# OpenClaw Dashboard - Job-Queue Roadmap

> Destilliert aus Multi-Agent-Diskussion, fokussiert auf Pareto (20% → 80%)

---

## Phase 1: MVP (1-2 Tage) 🎯

### Ziel
Funktionierendes Kanban-Board mit Job-Verwaltung

### Features
- [x] Kanban-UI mit Drag & Drop (existiert)
- [x] Job-Status: Backlog → Queued → Running → Done/Failed
- [ ] **JobStore Backend** (`server/jobStore.js`)
  - `saveJob(job)`, `getJobs()`, `updateJob(id, data)`, `deleteJob(id)`
  - File-basiert (JSON in `./data/jobs/`)
  - ID-Sanitizer: `id.replace(/[^a-f0-9-]/gi, '')`
- [ ] **REST-Endpoints** (`server/index.js`)
  - `POST /api/jobs` - Job erstellen
  - `GET /api/jobs` - Jobs laden
  - `PUT /api/jobs/:id` - Job updaten
  - `DELETE /api/jobs/:id` - Job löschen
- [ ] **Input-Validierung** (Zod oder manuell)
  - `title`: string, 1-200 Zeichen
  - `priority`: enum (low/medium/high/critical)
  - `status`: enum (backlog/queued/running/done/failed)
- [ ] **WebSocket Events**
  - `job.created`, `job.updated`, `job.deleted`

### Nicht im MVP
- ❌ History-Tracking
- ❌ Result-URL/Dateispeicherung  
- ❌ RBAC (Rollen)
- ❌ Pagination
- ❌ Chat-Integration für Job-Erstellung

---

## Phase 2: Hardening (3-5 Tage) 🔒

### Security
- [ ] Rate-Limiting (`express-rate-limit`, 30 req/min)
- [ ] CSRF-Protection (wenn Cookie-Auth)
- [ ] CSP-Header (Helmet)
- [ ] XSS-Sanitizing für Job-Output (DOMPurify)

### Features
- [ ] `scheduledAt` - Geplante Ausführung
- [ ] `resultUrl` - Link zum Ergebnis
- [ ] Pagination für `GET /api/jobs` (`?page=1&limit=50`)
- [ ] Filter nach Status (`?status=running`)

### Code-Qualität
- [ ] `App.tsx` aufteilen:
  - `components/KanbanBoard.tsx`
  - `components/JobCard.tsx`
  - `hooks/useJobs.ts`
- [ ] Typen in `types.ts` auslagern

---

## Phase 3: Scale (bei Bedarf) 📈

### Performance
- [ ] Virtualisierung (react-window) für >100 Jobs
- [ ] WebSocket-Batching (Events alle 100ms bündeln)
- [ ] DB-Migration (SQLite statt JSON-Files)

### Enterprise
- [ ] Job-History mit Audit-Trail
- [ ] RBAC (Admin/Operator/Viewer)
- [ ] Prometheus-Metriken
- [ ] Circuit-Breaker für Agent-Aufrufe

---

## Datenmodell

```typescript
interface Job {
  id: string;           // UUID
  title: string;        // max 200 chars
  description: string;  // max 2000 chars
  status: 'backlog' | 'queued' | 'running' | 'done' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  agent: string;        // Agent-Name
  createdAt: string;    // ISO timestamp
  updatedAt: string;    // ISO timestamp
  
  // Phase 2:
  scheduledAt?: string;
  finishedAt?: string;
  error?: string;
  resultUrl?: string;
}
```

---

## Quick Start für Phase 1

```bash
# 1. JobStore erstellen
touch server/jobStore.js

# 2. Endpoints in server/index.js hinzufügen

# 3. Frontend an echte API anbinden (statt Mock-Daten)

# 4. Testen
curl -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Job","priority":"medium"}'
```

---

*Erstellt: 2026-02-14*
*Basierend auf: OpenBotMan Multi-Agent Diskussion*
