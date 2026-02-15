# OpenClaw Dashboard: Settings-UI Redesign

## Kontext

Wir entwickeln das **OpenClaw Dashboard** — eine Web-UI zur Verwaltung eines AI-Agenten-Systems. Die aktuelle Config-Seite zeigt nur einen rohen JSON-Baum (read-only). Wir wollen eine **richtige Settings-UI** mit editierbaren Feldern, Token-Maskierung und übersichtlichem Layout.

**Tech-Stack:**
- React 18 + TypeScript
- Vite
- CSS (kein Tailwind, eigene Styles)
- Deployment: Coolify auf Hetzner

**Bestehendes Layout:**
- Sidebar-Navigation (Links)
- Content-Bereich (Rechts)
- Dark-Mode Support (CSS Variables)

---

## Das Problem

Die aktuelle Config-Ansicht ist unbrauchbar:

1. **Nur Lesen** — keine Bearbeitung möglich
2. **Tokens sichtbar** — Sicherheitsrisiko (Telegram Bot Token, MS Teams Password, etc.)
3. **Hässliches UI** — roher JSON-Baum, nicht benutzerfreundlich
4. **Keine Struktur** — alles in einem großen Block

---

## Das Ziel

Eine Settings-UI die:

- ✏️ **Editierbar** ist — Dropdowns, Toggles, Inputs
- 🔐 **Tokens maskiert** — `••••••••` mit "Show/Hide" Button
- 🎨 **Übersichtlich** ist — Kategorien, Cards, klare Struktur
- 💾 **Speichern kann** — Änderungen an OpenClaw Gateway senden
- ⚡ **Restart kommuniziert** — User weiß, dass Config-Änderung Restart triggert

---

## API-Grundlage

### Endpoints (bereits verfügbar)

```typescript
// Config lesen
gateway.action = "config.get"
// Response: { config: {...}, hash: "abc123", uiHints: {...}, schema: {...} }

// Config patchen (partial update, merge)
gateway.action = "config.patch"
gateway.raw = JSON.stringify({ "agents.defaults.model.primary": "anthropic/claude-sonnet-4-5" })
// Triggert automatisch Restart!

// Config komplett ersetzen
gateway.action = "config.apply"
gateway.raw = JSON.stringify(fullConfig)
// Triggert automatisch Restart!
```

### Schema-Features (automatisch vom Backend)

Das Backend liefert ein JSON-Schema mit **uiHints**:

```typescript
interface UiHint {
  label?: string;        // Display-Name
  help?: string;         // Tooltip/Beschreibung
  group?: string;        // Gruppierung (Agents, Channels, Gateway...)
  order?: number;        // Sortierreihenfolge
  sensitive?: boolean;   // Token-Maskierung!
  advanced?: boolean;    // Erweiterte Option (ausblendbar)
  placeholder?: string;  // Input-Placeholder
}
```

**Beispiele aus dem echten Schema:**

```javascript
"channels.telegram.botToken": {
  "label": "Telegram Bot Token",
  "sensitive": true  // ← Automatisch maskieren!
}

"channels.msteams.appPassword": {
  "label": "MS Teams App Password", 
  "sensitive": true
}

"gateway.auth.token": {
  "label": "Gateway Token",
  "help": "Required for gateway access",
  "sensitive": true
}

"agents.defaults.model.primary": {
  "label": "Primary Model",
  "help": "Primary model (provider/model)."
}
```

### Gruppen (aus uiHints)

| Group | Order | Beispiel-Felder |
|-------|-------|-----------------|
| Agents | 40 | model.primary, model.fallbacks, maxConcurrent |
| Channels | 150 | telegram.*, msteams.*, discord.* |
| Gateway | 30 | bind, auth, tls |
| Tools | 50 | exec.security, elevated, web.* |
| Plugins | 205 | entries.telegram.enabled, entries.msteams.enabled |
| Messages | 80 | tts.*, ackReaction |
| Commands | 85 | native, text, bash |

---

## Aktuelle Config-Struktur (Auszug)

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-5",
        "fallbacks": ["anthropic/claude-sonnet-4-5"]
      },
      "maxConcurrent": 4,
      "compaction": { "mode": "safeguard" }
    }
  },
  "channels": {
    "telegram": {
      "botToken": "8349204798:AAEh6OAF...",  // SENSITIVE!
      "dmPolicy": "open",
      "allowFrom": ["5249745642", "*"],
      "streamMode": "partial"
    },
    "msteams": {
      "enabled": true,
      "appId": "ffc003e9-...",
      "appPassword": "mwF8Q~hYKcg...",  // SENSITIVE!
      "tenantId": "23e70d4a-..."
    }
  },
  "tools": {
    "exec": { "security": "full" },
    "elevated": { "enabled": true }
  },
  "gateway": {
    "bind": "lan",
    "controlUi": { "allowInsecureAuth": true }
  },
  "plugins": {
    "entries": {
      "telegram": { "enabled": true },
      "msteams": { "enabled": true },
      "whatsapp": { "enabled": false }
    }
  }
}
```

---

## UI-Konzept (Draft)

### Layout: Sidebar + Content

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚙️ Einstellungen                                       [💾 Speichern]│
├────────────────┬─────────────────────────────────────────────────────┤
│                │                                                     │
│  🤖 Agents  ◄──┼──►  Agents Settings                                │
│  📱 Channels   │     ┌─────────────────────────────────────────────┐│
│  🌐 Gateway    │     │ 🤖 Model                                    ││
│  🔧 Tools      │     │                                             ││
│  🔌 Plugins    │     │ Primary    [▼ anthropic/claude-opus-4-5  ] ││
│  💬 Messages   │     │ Fallback   [▼ anthropic/claude-sonnet-4-5] ││
│  ⌨️ Commands   │     └─────────────────────────────────────────────┘│
│                │     ┌─────────────────────────────────────────────┐│
│                │     │ ⚡ Concurrency                              ││
│                │     │                                             ││
│                │     │ Max Concurrent     [    4    ]              ││
│                │     └─────────────────────────────────────────────┘│
│                │                                                     │
└────────────────┴─────────────────────────────────────────────────────┘
```

### Channels-Bereich (mit Token-Maskierung)

```
┌────────────────┬─────────────────────────────────────────────────────┐
│                │                                                     │
│  🤖 Agents     │  📱 Channel Settings                               │
│  📱 Channels ◄─┼──►                                                  │
│  🌐 Gateway    │  ┌─────────────────────────────────────────────────┐│
│  ...           │  │ 📱 Telegram                           [✓] An   ││
│                │  │                                                 ││
│                │  │ Bot Token  [••••••••••••••••] [👁 Show]         ││
│                │  │ DM Policy  [▼ open              ]               ││
│                │  │ Allow From [5249745642, *       ]               ││
│                │  │ Stream     [▼ partial           ]               ││
│                │  └─────────────────────────────────────────────────┘│
│                │  ┌─────────────────────────────────────────────────┐│
│                │  │ 💼 MS Teams                           [✓] An   ││
│                │  │                                                 ││
│                │  │ App ID     [ffc003e9-f9e8-461f...]              ││
│                │  │ Password   [••••••••••••••••] [👁 Show]         ││
│                │  │ Tenant ID  [23e70d4a-6ae0-45c4...]              ││
│                │  └─────────────────────────────────────────────────┘│
│                │  ┌─────────────────────────────────────────────────┐│
│                │  │ 📱 WhatsApp                          [ ] Aus   ││
│                │  │ (Nicht konfiguriert)                            ││
│                │  └─────────────────────────────────────────────────┘│
│                │                                                     │
└────────────────┴─────────────────────────────────────────────────────┘
```

---

## Komponenten-Anforderungen

### 1. SettingsSection (Container)

```tsx
interface SettingsSectionProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
  collapsible?: boolean;
}
```

### 2. SettingsField (generisch)

```tsx
interface SettingsFieldProps {
  path: string;              // z.B. "agents.defaults.model.primary"
  label: string;
  help?: string;
  type: 'text' | 'number' | 'select' | 'toggle' | 'array' | 'password';
  sensitive?: boolean;       // → Maskierung
  options?: { value: string; label: string }[];  // für select
  value: any;
  onChange: (path: string, value: any) => void;
}
```

### 3. SensitiveInput (Token-Maskierung)

```tsx
interface SensitiveInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// Features:
// - Default: maskiert (••••••••)
// - Toggle-Button zum Anzeigen/Verbergen
// - Clipboard-Copy Button?
```

### 4. ArrayEditor (für allowFrom, fallbacks, etc.)

```tsx
interface ArrayEditorProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

// Features:
// - Items als Tags/Chips anzeigen
// - Add/Remove Buttons
// - Inline-Edit?
```

---

## Fragen an die Experten

### UX/Design

1. **Speichern-Flow:**
   - Save-Button oben rechts (global)?
   - Oder Auto-Save mit Debounce?
   - Oder Save pro Section?

2. **Restart-Kommunikation:**
   - Config-Änderung triggert Gateway-Restart
   - Wie kommunizieren wir das? Toast? Modal? Banner?
   - "Änderungen werden nach Neustart aktiv" vs. sofort?

3. **Validation:**
   - Live-Validation während Eingabe?
   - Oder erst beim Speichern?
   - Schema-basierte Validation (JSON Schema → Zod)?

4. **Dirty State:**
   - Unsaved-Changes-Indicator?
   - "Änderungen verwerfen" Button?
   - Browser-Warning bei Navigation mit unsaved changes?

### Technisch

5. **State Management:**
   - Local State + Submit?
   - Optimistic Updates?
   - Wie mit Restart umgehen (WebSocket reconnect)?

6. **Sensitive Fields:**
   - Soll das Backend Tokens nur maskiert liefern?
   - Oder Frontend-only Maskierung (aktuell: Backend liefert Klartext)?
   - Bei Edit: Muss man den vollen Token neu eingeben oder nur ändern wenn gewünscht?

7. **Schema-Driven Rendering:**
   - Sollen wir die UI komplett aus dem Schema generieren?
   - Oder handgeschriebene Komponenten pro Bereich?
   - Hybrid: Schema für Feldtypen, handgeschrieben für Layout?

### Priorisierung

8. **MVP-Scope:**
   - Welche Bereiche zuerst? (Vorschlag: Agents + Channels)
   - Advanced-Felder initial verstecken?
   - Plugins erst Phase 2?

---

## Erwartete Outputs

1. **UI/UX-Empfehlungen** — Welcher Ansatz für Save/Restart/Validation?
2. **Komponenten-Architektur** — Schema-driven vs. handgeschrieben?
3. **Security-Empfehlungen** — Token-Handling Best Practices
4. **Priorisierter Implementierungsplan** — Was zuerst?

---

## Referenz: Sessions-UI (bereits implementiert)

Wir haben kürzlich die Sessions-Ansicht überarbeitet:
- `SessionCard.tsx` — Cards mit Status, Preview, Stats
- `SessionsView.tsx` — Liste + Filter + Detail-Panel
- Animationen, Hover-Effekte, Dark-Mode

Die Settings-UI sollte stilistisch dazu passen.

---

*Erstellt: 2026-02-15*
