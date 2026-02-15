// ============================================================
// SettingsView — Main settings page with sidebar navigation
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { SettingsSection } from "./SettingsSection";
import { SettingsField } from "./SettingsField";
import api from "../../lib/api";

// ── Types ─────────────────────────────────────────────────
interface AuthProfile {
  type?: string;
  mode?: string;
  provider?: string;
  token?: string;
}

interface SettingsViewProps {
  config: any;
  configHash?: string;
  onConfigChange: (config: any, newHash?: string) => void;
  loading?: boolean;
  gwRequest?: (method: string, params?: any) => Promise<any>;
}

type SectionKey = "agents" | "auth" | "channels" | "gateway" | "tools" | "plugins" | "advanced";

interface NavItem {
  key: SectionKey;
  label: string;
  icon: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "agents", label: "Agents", icon: "🤖", description: "Model, Concurrency, Compaction" },
  { key: "auth", label: "Auth", icon: "🔑", description: "API Keys, Claude Max, OAuth" },
  { key: "channels", label: "Channels", icon: "📱", description: "Telegram, Teams, etc." },
  { key: "gateway", label: "Gateway", icon: "🌐", description: "Server, Binding, Proxy" },
  { key: "tools", label: "Tools", icon: "🔧", description: "Exec, Elevated, Browser" },
  { key: "plugins", label: "Plugins", icon: "🔌", description: "Erweiterungen" },
  { key: "advanced", label: "Erweitert", icon: "⚙️", description: "Meta, Debug" },
];

// Provider prefixes we care about
const RELEVANT_PROVIDERS = ["anthropic", "openai", "google"];

// Hook: Load models from OpenRouter API
function useOpenRouterModels() {
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check cache first (valid for 1 hour)
    const cached = localStorage.getItem("openrouter-models-v2");
    const cacheTime = localStorage.getItem("openrouter-models-v2-time");
    if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 3600000) {
      setModels(JSON.parse(cached));
      setLoading(false);
      return;
    }

    fetch("https://openrouter.ai/api/v1/models")
      .then((res) => res.json())
      .then((data) => {
        const filtered = (data.data || [])
          .filter((m: any) => RELEVANT_PROVIDERS.some((p) => m.id.startsWith(p + "/")))
          .sort((a: any, b: any) => {
            // Sort by provider, then by name
            const provA = a.id.split("/")[0];
            const provB = b.id.split("/")[0];
            if (provA !== provB) return provA.localeCompare(provB);
            return a.name.localeCompare(b.name);
          })
          .map((m: any) => ({
            value: m.id,
            label: m.name.replace(/^[^:]+:\s*/, ""), // Remove "Provider: " prefix
          }));
        setModels(filtered);
        // Cache it
        localStorage.setItem("openrouter-models-v2", JSON.stringify(filtered));
        localStorage.setItem("openrouter-models-v2-time", Date.now().toString());
      })
      .catch((err) => {
        console.error("Failed to load models:", err);
        // Fallback to some defaults
        setModels([
          { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5" },
          { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
          { value: "openai/gpt-4o", label: "GPT-4o" },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  return { models, loading };
}

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
export function SettingsView({ config, configHash, onConfigChange, loading, gwRequest }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>("agents");
  const [localConfig, setLocalConfig] = useState<any>(config || {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showRestartBanner, setShowRestartBanner] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Dynamic model list from OpenRouter
  const { models: MODEL_OPTIONS, loading: modelsLoading } = useOpenRouterModels();

  // Auth Profiles (separate from main config)
  const [authProfiles, setAuthProfiles] = useState<Record<string, AuthProfile>>({});
  const [authProfilesDirty, setAuthProfilesDirty] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Load auth profiles on mount
  useEffect(() => {
    const loadAuthProfiles = async () => {
      try {
        setAuthLoading(true);
        const res = await api.authProfiles.get();
        if (res.ok && res.profiles) {
          setAuthProfiles(res.profiles);
        }
      } catch (err) {
        console.error("Failed to load auth profiles:", err);
      } finally {
        setAuthLoading(false);
      }
    };
    loadAuthProfiles();
  }, []);

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

  // Auth profile change handler
  const handleAuthChange = useCallback((profileKey: string, field: string, value: any) => {
    setAuthProfiles((prev) => ({
      ...prev,
      [profileKey]: {
        ...prev[profileKey],
        [field]: value,
      },
    }));
    setAuthProfilesDirty(true);
    setSaveError(null);
  }, []);

  // Save handler
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Save main config if dirty (use WebSocket RPC for config.patch)
      if (dirty) {
        if (!gwRequest) {
          throw new Error("WebSocket nicht verbunden");
        }
        if (!configHash) {
          throw new Error("Config-Hash fehlt - bitte Seite neu laden");
        }
        const res = await gwRequest("config.patch", { 
          raw: JSON.stringify(localConfig),
          baseHash: configHash
        });
        setDirty(false);
        // Pass new hash back to parent
        onConfigChange(localConfig, res?.hash);
      }
      
      // Save auth profiles if dirty
      if (authProfilesDirty) {
        await api.authProfiles.update(authProfiles);
        setAuthProfilesDirty(false);
      }
      
      setShowRestartBanner(true);
      // Auto-hide banner after 10s
      setTimeout(() => setShowRestartBanner(false), 10000);
    } catch (err: any) {
      setSaveError(err.message || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }, [localConfig, authProfiles, dirty, authProfilesDirty, onConfigChange, gwRequest, configHash]);

  // Discard changes
  const handleDiscard = useCallback(async () => {
    if (confirm("Ungespeicherte Änderungen verwerfen?")) {
      setLocalConfig(config);
      setDirty(false);
      setAuthProfilesDirty(false);
      setSaveError(null);
      // Reload auth profiles
      try {
        const res = await api.authProfiles.get();
        if (res.ok && res.profiles) {
          setAuthProfiles(res.profiles);
        }
      } catch {}
    }
  }, [config]);

  // Restart handler - uses HTTP API for restart
  const handleRestart = useCallback(async () => {
    if (!confirm("Gateway wirklich neustarten?\n\nLaufende Sessions werden kurz unterbrochen.")) {
      return;
    }
    
    setRestarting(true);
    try {
      // Use HTTP API - backend triggers restart via config re-apply
      const res = await api.gateway.restart("Dashboard restart button");
      
      if (res?.ok) {
        setShowRestartBanner(false);
        alert("✅ Gateway wird neugestartet...\n\nDie Seite verbindet sich automatisch neu.");
        // Give gateway time to restart, then reload
        setTimeout(() => window.location.reload(), 5000);
      } else if (res?.instructions) {
        // Fallback instructions if direct restart not possible
        alert("⚠️ Manueller Restart nötig:\n\n" + res.instructions.join("\n"));
      } else {
        alert("⚠️ Restart-Antwort: " + JSON.stringify(res));
      }
    } catch (err: any) {
      console.error("Restart error:", err);
      alert(
        "❌ Restart fehlgeschlagen\n\n" +
        (err.message || "Unbekannter Fehler") + "\n\n" +
        "Alternative: Coolify → OpenClaw → Restart"
      );
    } finally {
      setRestarting(false);
    }
  }, []);

  // Get field value helper
  const getValue = useCallback((path: string) => getPath(localConfig, path), [localConfig]);

  // ── Render Sections ─────────────────────────────────────
  const renderAgentsSection = () => (
    <>
      <SettingsSection title="Model" icon="🧠" description="Welches KI-Modell soll verwendet werden?">
        <SettingsField
          label="Primary Model"
          type="select"
          value={getValue("agents.defaults.model.primary")}
          onChange={(v) => handleChange("agents.defaults.model.primary", v)}
          options={MODEL_OPTIONS}
          description="Haupt-Modell für alle Agents"
        />
        <SettingsField
          label="Fallback Model"
          type="select"
          value={getValue("agents.defaults.model.fallbacks.0")}
          onChange={(v) => handleChange("agents.defaults.model.fallbacks", v ? [v] : [])}
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
          value={getValue("agents.defaults.subagents.maxConcurrent")}
          onChange={(v) => handleChange("agents.defaults.subagents.maxConcurrent", v)}
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

  const renderAuthSection = () => {
    const profileKeys = Object.keys(authProfiles);

    // Provider options
    const PROVIDER_OPTIONS = [
      { value: "anthropic", label: "Anthropic (Claude)" },
      { value: "openai", label: "OpenAI (GPT)" },
      { value: "google", label: "Google (Gemini)" },
      { value: "openrouter", label: "OpenRouter" },
    ];

    // Mode options per provider
    const MODE_OPTIONS: Record<string, { value: string; label: string; description: string }[]> = {
      anthropic: [
        { value: "token", label: "API Token", description: "Anthropic API Key" },
        { value: "max", label: "Claude Max", description: "Claude Pro/Max Subscription (OAuth)" },
        { value: "oauth", label: "OAuth", description: "OAuth Flow" },
      ],
      openai: [
        { value: "token", label: "API Token", description: "OpenAI API Key" },
      ],
      google: [
        { value: "token", label: "API Token", description: "Google AI API Key" },
        { value: "oauth", label: "OAuth", description: "Google OAuth" },
      ],
      openrouter: [
        { value: "token", label: "API Token", description: "OpenRouter API Key" },
      ],
    };

    const getProviderIcon = (provider: string) => {
      switch (provider) {
        case "anthropic": return "🅰️";
        case "openai": return "🤖";
        case "google": return "🔷";
        case "openrouter": return "🔀";
        default: return "🔑";
      }
    };

    return (
      <>
        {authLoading && (
          <div className="oc-settings-empty">
            <span className="oc-settings-empty__icon">⏳</span>
            <p>Lade Auth-Profile...</p>
          </div>
        )}

        {!authLoading && profileKeys.length === 0 && (
          <div className="oc-settings-empty">
            <span className="oc-settings-empty__icon">🔑</span>
            <p>Keine Auth-Profile konfiguriert</p>
          </div>
        )}

        {!authLoading && profileKeys.map((profileKey) => {
          const profile = authProfiles[profileKey];
          const provider = profile?.provider || "anthropic";
          // auth-profiles.json uses "type", openclaw.json uses "mode"
          const mode = profile?.type || profile?.mode || "token";
          const modeOptions = MODE_OPTIONS[provider] || MODE_OPTIONS.anthropic;
          const modeInfo = modeOptions.find(m => m.value === mode);
          const token = profile?.token || "";

          // Check if it's an OAuth token (starts with sk-ant-oat)
          const isOAuthToken = token.startsWith("sk-ant-oat");
          const effectiveMode = isOAuthToken ? "max" : mode;
          const effectiveModeInfo = modeOptions.find(m => m.value === effectiveMode) || modeInfo;

          return (
            <SettingsSection
              key={profileKey}
              title={profileKey}
              icon={getProviderIcon(provider)}
              badge={effectiveModeInfo?.label || effectiveMode}
              badgeColor={effectiveMode === "max" ? "#8b5cf6" : effectiveMode === "token" ? "#22c55e" : "#3b82f6"}
            >
              <SettingsField
                label="Provider"
                type="select"
                value={provider}
                onChange={(v) => handleAuthChange(profileKey, "provider", v)}
                options={PROVIDER_OPTIONS}
              />
              <SettingsField
                label="Modus"
                type="select"
                value={effectiveMode}
                onChange={(v) => handleAuthChange(profileKey, "type", v)}
                options={modeOptions.map(m => ({ value: m.value, label: m.label }))}
                description={effectiveModeInfo?.description}
              />

              {/* Token mode: show API key field */}
              {effectiveMode === "token" && (
                <SettingsField
                  label="API Key"
                  type="password"
                  value={token}
                  onChange={(v) => handleAuthChange(profileKey, "token", v)}
                  placeholder="sk-ant-... / sk-..."
                  description="Dein API-Schlüssel vom Provider"
                />
              )}

              {/* Max/OAuth mode: show status and token info */}
              {(effectiveMode === "max" || effectiveMode === "oauth") && (
                <div className="oc-auth-oauth-info">
                  <p>🔐 {effectiveMode === "max" ? "Claude Max/Pro" : "OAuth"} aktiv</p>
                  <p className="oc-auth-oauth-hint">
                    {token ? `Token: ${token.slice(0, 20)}...${token.slice(-8)}` : "Kein Token vorhanden"}
                  </p>
                  <p className="oc-auth-oauth-hint">
                    Zum Erneuern: <code>openclaw auth add --max</code>
                  </p>
                </div>
              )}
            </SettingsSection>
          );
        })}

        <SettingsSection title="Neues Profil hinzufügen" icon="➕" collapsible defaultCollapsed>
          <p className="oc-settings-hint">
            Neue Auth-Profile können über die CLI hinzugefügt werden:<br/>
            <code>openclaw auth add anthropic</code><br/>
            <code>openclaw auth add --max</code> (für Claude Pro/Max)
          </p>
        </SettingsSection>
      </>
    );
  };

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
              label="App Password"
              type="password"
              value={getValue("channels.msteams.appPassword")}
              onChange={(v) => handleChange("channels.msteams.appPassword", v)}
            />
            <SettingsField
              label="Tenant ID"
              type="text"
              value={getValue("channels.msteams.tenantId")}
              onChange={(v) => handleChange("channels.msteams.tenantId", v)}
            />
            <SettingsField
              label="DM Policy"
              type="select"
              value={getValue("channels.msteams.dmPolicy")}
              onChange={(v) => handleChange("channels.msteams.dmPolicy", v)}
              options={[
                { value: "open", label: "Open (Alle erlaubt)" },
                { value: "allowlist", label: "Allowlist" },
                { value: "closed", label: "Closed (Nur explizit)" },
              ]}
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
      <SettingsSection title="Server" icon="🔗">
        <SettingsField
          label="Mode"
          type="select"
          value={getValue("gateway.mode")}
          onChange={(v) => handleChange("gateway.mode", v)}
          options={[
            { value: "local", label: "Local" },
            { value: "cloud", label: "Cloud" },
          ]}
          description="Gateway-Betriebsmodus"
        />
        <SettingsField
          label="Bind"
          type="select"
          value={getValue("gateway.bind")}
          onChange={(v) => handleChange("gateway.bind", v)}
          options={[
            { value: "loopback", label: "Loopback (127.0.0.1)" },
            { value: "localhost", label: "Localhost" },
            { value: "lan", label: "LAN" },
            { value: "public", label: "Public (0.0.0.0)" },
          ]}
          description="Auf welchen Interfaces der Server lauscht"
        />
      </SettingsSection>

      <SettingsSection title="Proxy" icon="🔀" collapsible>
        <SettingsField
          label="Trusted Proxies"
          type="array"
          value={getValue("gateway.trustedProxies")}
          onChange={(v) => handleChange("gateway.trustedProxies", v)}
          placeholder="CIDR-Ranges, komma-separiert"
          description="z.B. 10.0.0.0/8, 172.16.0.0/12"
        />
      </SettingsSection>

      <SettingsSection title="Control UI" icon="🖥️" collapsible>
        <SettingsField
          label="Allow Insecure Auth"
          type="toggle"
          value={getValue("gateway.controlUi.allowInsecureAuth")}
          onChange={(v) => handleChange("gateway.controlUi.allowInsecureAuth", v)}
          description="HTTP-Auth ohne HTTPS erlauben (nur für lokale Netze!)"
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
          label="Allow From (Telegram)"
          type="array"
          value={getValue("tools.elevated.allowFrom.telegram")}
          onChange={(v) => handleChange("tools.elevated.allowFrom.telegram", v)}
          placeholder="Telegram User IDs"
          description="User IDs die elevated-Befehle ausführen dürfen"
        />
      </SettingsSection>

      <SettingsSection title="Browser" icon="🌍" description="Browser-Automatisierung" collapsible defaultCollapsed>
        <SettingsField
          label="Aktiviert"
          type="toggle"
          value={getValue("tools.browser.enabled") !== false}
          onChange={(v) => handleChange("tools.browser.enabled", v)}
        />
        <SettingsField
          label="Target"
          type="select"
          value={getValue("tools.browser.target") || "sandbox"}
          onChange={(v) => handleChange("tools.browser.target", v)}
          options={[
            { value: "sandbox", label: "Sandbox" },
            { value: "host", label: "Host" },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Approvals" icon="✅" description="Exec-Genehmigungen" collapsible defaultCollapsed>
        <SettingsField
          label="Exec Approvals"
          type="toggle"
          value={getValue("approvals.exec.enabled")}
          onChange={(v) => handleChange("approvals.exec.enabled", v)}
          description="Befehle müssen erst genehmigt werden"
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
      case "auth": return renderAuthSection();
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
            className="oc-settings__restart-btn"
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? "⏳ Neustart..." : "🔄 Jetzt neustarten"}
          </button>
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
          {(loading || authLoading) && <span className="oc-loading-sm">⏳</span>}
        </h2>
        <div className="oc-settings__actions">
          {(dirty || authProfilesDirty) && (
            <button className="oc-btn-ghost" onClick={handleDiscard}>
              Verwerfen
            </button>
          )}
          <button
            className={`oc-btn-primary ${(dirty || authProfilesDirty) ? "oc-btn-primary--pulse" : ""}`}
            onClick={handleSave}
            disabled={!(dirty || authProfilesDirty) || saving}
          >
            {saving ? "⏳ Speichern..." : (dirty || authProfilesDirty) ? "💾 Speichern" : "✓ Gespeichert"}
          </button>
          <button
            className="oc-btn-restart"
            onClick={handleRestart}
            disabled={restarting}
            title="Gateway neustarten"
          >
            {restarting ? "⏳" : "🔄"} Restart
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
      {(dirty || authProfilesDirty) && (
        <div className="oc-settings__dirty-indicator">
          <span className="oc-dirty-dot" />
          Ungespeicherte Änderungen
        </div>
      )}
    </div>
  );
}
