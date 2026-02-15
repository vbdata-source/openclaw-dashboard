// ============================================================
// SettingsView — Main settings page with sidebar navigation
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { SettingsSection } from "./SettingsSection";
import { SettingsField } from "./SettingsField";
import api from "../../lib/api";

// ── Types ─────────────────────────────────────────────────
interface SettingsViewProps {
  config: any;
  onConfigChange: (config: any) => void;
  loading?: boolean;
}

type SectionKey = "agents" | "channels" | "gateway" | "tools" | "plugins" | "advanced";

interface NavItem {
  key: SectionKey;
  label: string;
  icon: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "agents", label: "Agents", icon: "🤖", description: "Model, Concurrency, Compaction" },
  { key: "channels", label: "Channels", icon: "📱", description: "Telegram, Teams, etc." },
  { key: "gateway", label: "Gateway", icon: "🌐", description: "Server, Binding, Proxy" },
  { key: "tools", label: "Tools", icon: "🔧", description: "Exec, Elevated, Browser" },
  { key: "plugins", label: "Plugins", icon: "🔌", description: "Erweiterungen" },
  { key: "advanced", label: "Erweitert", icon: "⚙️", description: "Meta, Compaction" },
];

// Model options
const MODEL_OPTIONS = [
  { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5 (Best)" },
  { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { value: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro" },
];

// ── Helper: Deep get/set ──────────────────────────────────
function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function setPath(obj: any, path: string, value: any): any {
  const clone = JSON.parse(JSON.stringify(obj || {}));
  const keys = path.split(".");
  let current = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return clone;
}

// ── Main Component ────────────────────────────────────────
export function SettingsView({ config, onConfigChange, loading }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>("agents");
  const [localConfig, setLocalConfig] = useState<any>(config || {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showRestartBanner, setShowRestartBanner] = useState(false);

  // Sync with parent config
  useEffect(() => {
    if (config && !dirty) {
      setLocalConfig(config);
    }
  }, [config, dirty]);

  // Field change handler
  const handleChange = useCallback((path: string, value: any) => {
    setLocalConfig((prev: any) => setPath(prev, path, value));
    setDirty(true);
    setSaveError(null);
  }, []);

  // Save handler
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.config.update(localConfig);
      setDirty(false);
      setShowRestartBanner(true);
      onConfigChange(localConfig);
      // Auto-hide banner after 10s
      setTimeout(() => setShowRestartBanner(false), 10000);
    } catch (err: any) {
      setSaveError(err.message || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }, [localConfig, onConfigChange]);

  // Discard changes
  const handleDiscard = useCallback(() => {
    if (confirm("Ungespeicherte Änderungen verwerfen?")) {
      setLocalConfig(config);
      setDirty(false);
      setSaveError(null);
    }
  }, [config]);

  // Get field value helper
  const getValue = useCallback((path: string) => getPath(localConfig, path), [localConfig]);

  // ── Render Sections ─────────────────────────────────────
  const renderAgentsSection = () => (
    <>
      <SettingsSection title="Model" icon="🧠" description="Welches KI-Modell soll verwendet werden?">
        <SettingsField
          label="Primary Model"
          type="select"
          value={getValue("agents.defaults.model")}
          onChange={(v) => handleChange("agents.defaults.model", v)}
          options={MODEL_OPTIONS}
          description="Haupt-Modell für alle Agents"
        />
        <SettingsField
          label="Fallback Model"
          type="select"
          value={getValue("agents.defaults.fallbackModels.0")}
          onChange={(v) => handleChange("agents.defaults.fallbackModels", v ? [v] : [])}
          options={MODEL_OPTIONS}
          description="Wenn das primäre Modell nicht verfügbar ist"
        />
      </SettingsSection>

      <SettingsSection title="Concurrency" icon="⚡" description="Parallele Ausführung">
        <SettingsField
          label="Max Concurrent"
          type="number"
          value={getValue("agents.defaults.maxConcurrent")}
          onChange={(v) => handleChange("agents.defaults.maxConcurrent", v)}
          min={1}
          max={20}
          description="Maximale parallele Sessions"
        />
        <SettingsField
          label="Subagents Max"
          type="number"
          value={getValue("agents.defaults.subagentsMax")}
          onChange={(v) => handleChange("agents.defaults.subagentsMax", v)}
          min={1}
          max={50}
          description="Maximale Unteragenten pro Session"
        />
      </SettingsSection>

      <SettingsSection title="Compaction" icon="📦" description="Wie wird der Kontext komprimiert?">
        <SettingsField
          label="Mode"
          type="select"
          value={getValue("agents.defaults.compaction.mode")}
          onChange={(v) => handleChange("agents.defaults.compaction.mode", v)}
          options={[
            { value: "safeguard", label: "Safeguard (Standard)" },
            { value: "aggressive", label: "Aggressive" },
            { value: "off", label: "Aus" },
          ]}
        />
      </SettingsSection>
    </>
  );

  const renderChannelsSection = () => {
    const channels = localConfig?.channels || {};
    const channelKeys = Object.keys(channels);

    return (
      <>
        {channelKeys.length === 0 && (
          <div className="oc-settings-empty">
            <span className="oc-settings-empty__icon">📡</span>
            <p>Keine Channels konfiguriert</p>
          </div>
        )}

        {channels.telegram && (
          <SettingsSection
            title="Telegram"
            icon="✈️"
            badge={channels.telegram.enabled !== false ? "Aktiv" : "Aus"}
            badgeColor={channels.telegram.enabled !== false ? "#22c55e" : "#64748b"}
          >
            <SettingsField
              label="Aktiviert"
              type="toggle"
              value={channels.telegram.enabled !== false}
              onChange={(v) => handleChange("channels.telegram.enabled", v)}
            />
            <SettingsField
              label="Bot Token"
              type="password"
              value={getValue("channels.telegram.botToken")}
              onChange={(v) => handleChange("channels.telegram.botToken", v)}
              placeholder="123456:ABC-DEF..."
            />
            <SettingsField
              label="DM Policy"
              type="select"
              value={getValue("channels.telegram.dmPolicy")}
              onChange={(v) => handleChange("channels.telegram.dmPolicy", v)}
              options={[
                { value: "open", label: "Open (Alle erlaubt)" },
                { value: "allowlist", label: "Allowlist" },
                { value: "closed", label: "Closed (Nur explizit)" },
              ]}
            />
            <SettingsField
              label="Allow From"
              type="array"
              value={getValue("channels.telegram.allowFrom")}
              onChange={(v) => handleChange("channels.telegram.allowFrom", v)}
              placeholder="User IDs oder * für alle"
            />
          </SettingsSection>
        )}

        {channels.msteams && (
          <SettingsSection
            title="MS Teams"
            icon="💼"
            badge={channels.msteams.enabled !== false ? "Aktiv" : "Aus"}
            badgeColor={channels.msteams.enabled !== false ? "#22c55e" : "#64748b"}
          >
            <SettingsField
              label="Aktiviert"
              type="toggle"
              value={channels.msteams.enabled !== false}
              onChange={(v) => handleChange("channels.msteams.enabled", v)}
            />
            <SettingsField
              label="App ID"
              type="text"
              value={getValue("channels.msteams.appId")}
              onChange={(v) => handleChange("channels.msteams.appId", v)}
            />
            <SettingsField
              label="Password"
              type="password"
              value={getValue("channels.msteams.password")}
              onChange={(v) => handleChange("channels.msteams.password", v)}
            />
            <SettingsField
              label="Tenant ID"
              type="text"
              value={getValue("channels.msteams.tenantId")}
              onChange={(v) => handleChange("channels.msteams.tenantId", v)}
            />
          </SettingsSection>
        )}

        {channels.discord && (
          <SettingsSection
            title="Discord"
            icon="🎮"
            badge={channels.discord.enabled !== false ? "Aktiv" : "Aus"}
            badgeColor={channels.discord.enabled !== false ? "#22c55e" : "#64748b"}
          >
            <SettingsField
              label="Aktiviert"
              type="toggle"
              value={channels.discord.enabled !== false}
              onChange={(v) => handleChange("channels.discord.enabled", v)}
            />
            <SettingsField
              label="Bot Token"
              type="password"
              value={getValue("channels.discord.botToken")}
              onChange={(v) => handleChange("channels.discord.botToken", v)}
            />
          </SettingsSection>
        )}
      </>
    );
  };

  const renderGatewaySection = () => (
    <>
      <SettingsSection title="Server Binding" icon="🔗">
        <SettingsField
          label="Bind"
          type="select"
          value={getValue("gateway.bind")}
          onChange={(v) => handleChange("gateway.bind", v)}
          options={[
            { value: "localhost", label: "Localhost only" },
            { value: "lan", label: "LAN" },
            { value: "public", label: "Public (0.0.0.0)" },
          ]}
          description="Auf welchen Interfaces der Server lauscht"
        />
        <SettingsField
          label="Port"
          type="number"
          value={getValue("gateway.port")}
          onChange={(v) => handleChange("gateway.port", v)}
          min={1}
          max={65535}
          placeholder="4444"
        />
      </SettingsSection>

      <SettingsSection title="Proxy" icon="🔀">
        <SettingsField
          label="Trusted Proxies"
          type="array"
          value={getValue("gateway.trustedProxies")}
          onChange={(v) => handleChange("gateway.trustedProxies", v)}
          placeholder="IP-Adressen, komma-separiert"
        />
      </SettingsSection>

      <SettingsSection title="Security" icon="🔐">
        <SettingsField
          label="Idle Timeout (min)"
          type="number"
          value={getValue("gateway.idleTimeoutMin")}
          onChange={(v) => handleChange("gateway.idleTimeoutMin", v)}
          min={0}
          description="Session-Timeout in Minuten (0 = nie)"
        />
      </SettingsSection>
    </>
  );

  const renderToolsSection = () => (
    <>
      <SettingsSection title="Exec" icon="⌨️" description="Shell-Befehlsausführung">
        <SettingsField
          label="Security Mode"
          type="select"
          value={getValue("tools.exec.security")}
          onChange={(v) => handleChange("tools.exec.security", v)}
          options={[
            { value: "full", label: "Full (Alles erlaubt)" },
            { value: "allowlist", label: "Allowlist" },
            { value: "deny", label: "Deny (Nichts erlaubt)" },
          ]}
          description="Wie streng sollen Shell-Befehle kontrolliert werden?"
        />
      </SettingsSection>

      <SettingsSection title="Elevated" icon="🔓" description="Sudo/Admin-Zugriff">
        <SettingsField
          label="Aktiviert"
          type="toggle"
          value={getValue("tools.elevated.enabled")}
          onChange={(v) => handleChange("tools.elevated.enabled", v)}
          description="Erlaube erhöhte Rechte für bestimmte Operationen"
        />
        <SettingsField
          label="Allow From"
          type="array"
          value={getValue("tools.elevated.allowFrom")}
          onChange={(v) => handleChange("tools.elevated.allowFrom", v)}
          placeholder="User IDs"
        />
      </SettingsSection>

      <SettingsSection title="Browser" icon="🌍" description="Browser-Automatisierung">
        <SettingsField
          label="Aktiviert"
          type="toggle"
          value={getValue("tools.browser.enabled")}
          onChange={(v) => handleChange("tools.browser.enabled", v)}
        />
        <SettingsField
          label="Target"
          type="select"
          value={getValue("tools.browser.target")}
          onChange={(v) => handleChange("tools.browser.target", v)}
          options={[
            { value: "sandbox", label: "Sandbox" },
            { value: "host", label: "Host" },
          ]}
        />
      </SettingsSection>
    </>
  );

  const renderPluginsSection = () => (
    <div className="oc-settings-empty">
      <span className="oc-settings-empty__icon">🔌</span>
      <p>Plugin-Verwaltung kommt bald!</p>
      <p className="oc-settings-empty__hint">Phase 2: Plugin-Store & Installation</p>
    </div>
  );

  const renderAdvancedSection = () => (
    <>
      <SettingsSection title="Meta" icon="📋" collapsible defaultCollapsed>
        <SettingsField
          label="Instance Name"
          type="text"
          value={getValue("meta.name")}
          onChange={(v) => handleChange("meta.name", v)}
          placeholder="OpenClaw"
        />
        <SettingsField
          label="Environment"
          type="select"
          value={getValue("meta.env")}
          onChange={(v) => handleChange("meta.env", v)}
          options={[
            { value: "development", label: "Development" },
            { value: "production", label: "Production" },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Debug" icon="🐛" collapsible defaultCollapsed>
        <SettingsField
          label="Verbose Logging"
          type="toggle"
          value={getValue("debug.verbose")}
          onChange={(v) => handleChange("debug.verbose", v)}
        />
        <SettingsField
          label="Log Level"
          type="select"
          value={getValue("debug.logLevel")}
          onChange={(v) => handleChange("debug.logLevel", v)}
          options={[
            { value: "error", label: "Error" },
            { value: "warn", label: "Warn" },
            { value: "info", label: "Info" },
            { value: "debug", label: "Debug" },
          ]}
        />
      </SettingsSection>
    </>
  );

  const renderSection = () => {
    switch (activeSection) {
      case "agents": return renderAgentsSection();
      case "channels": return renderChannelsSection();
      case "gateway": return renderGatewaySection();
      case "tools": return renderToolsSection();
      case "plugins": return renderPluginsSection();
      case "advanced": return renderAdvancedSection();
      default: return null;
    }
  };

  return (
    <div className="oc-settings">
      {/* Restart Banner */}
      {showRestartBanner && (
        <div className="oc-settings__banner oc-settings__banner--info">
          <span className="oc-settings__banner-icon">ℹ️</span>
          <span>Änderungen gespeichert. Gateway-Neustart für volle Wirkung empfohlen.</span>
          <button
            className="oc-settings__banner-close"
            onClick={() => setShowRestartBanner(false)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Save Error Banner */}
      {saveError && (
        <div className="oc-settings__banner oc-settings__banner--error">
          <span className="oc-settings__banner-icon">❌</span>
          <span>{saveError}</span>
          <button
            className="oc-settings__banner-close"
            onClick={() => setSaveError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header with Save Button */}
      <div className="oc-settings__header">
        <h2 className="oc-view-title">
          ⚙️ Einstellungen
          {loading && <span className="oc-loading-sm">⏳</span>}
        </h2>
        <div className="oc-settings__actions">
          {dirty && (
            <button className="oc-btn-ghost" onClick={handleDiscard}>
              Verwerfen
            </button>
          )}
          <button
            className={`oc-btn-primary ${dirty ? "oc-btn-primary--pulse" : ""}`}
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? "⏳ Speichern..." : dirty ? "💾 Speichern" : "✓ Gespeichert"}
          </button>
        </div>
      </div>

      {/* Main Layout: Sidebar + Content */}
      <div className="oc-settings__layout">
        {/* Sidebar Navigation */}
        <nav className="oc-settings__nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`oc-settings__nav-item ${activeSection === item.key ? "oc-settings__nav-item--active" : ""}`}
              onClick={() => setActiveSection(item.key)}
            >
              <span className="oc-settings__nav-icon">{item.icon}</span>
              <div className="oc-settings__nav-text">
                <span className="oc-settings__nav-label">{item.label}</span>
                <span className="oc-settings__nav-desc">{item.description}</span>
              </div>
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <div className="oc-settings__content">
          {renderSection()}
        </div>
      </div>

      {/* Unsaved Changes Warning (Dirty State Indicator) */}
      {dirty && (
        <div className="oc-settings__dirty-indicator">
          <span className="oc-dirty-dot" />
          Ungespeicherte Änderungen
        </div>
      )}
    </div>
  );
}
