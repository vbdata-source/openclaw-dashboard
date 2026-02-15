// ============================================================
// SessionCard — WOW Session Card Component
// ============================================================

import React from "react";

// Session Entry Interface (also defined in App.tsx)
interface SessionEntry {
  id: string;
  channel: string;
  sender: string;
  agent: string;
  status: "active" | "idle" | "completed";
  messages: number;
  tokens: number;
  startedAt: string;
  lastActivity: string;
  lastMessage?: string;
  model?: string;
  cost?: number;
}

// Channel Icons & Colors
const CHANNEL_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  telegram: { icon: "✈️", color: "#0088cc", label: "Telegram" },
  whatsapp: { icon: "📱", color: "#25D366", label: "WhatsApp" },
  discord: { icon: "🎮", color: "#5865F2", label: "Discord" },
  slack: { icon: "💼", color: "#4A154B", label: "Slack" },
  msteams: { icon: "🏢", color: "#6264A7", label: "MS Teams" },
  signal: { icon: "🔒", color: "#3A76F0", label: "Signal" },
  webchat: { icon: "🌐", color: "#6366f1", label: "Webchat" },
  cron: { icon: "⏰", color: "#f59e0b", label: "Cron Job" },
  subagent: { icon: "🤖", color: "#8b5cf6", label: "Subagent" },
  imessage: { icon: "🍎", color: "#34C759", label: "iMessage" },
  googlechat: { icon: "💬", color: "#00AC47", label: "Google Chat" },
  multi: { icon: "🔀", color: "#6366f1", label: "Multi-Channel" },
  main: { icon: "🦞", color: "#ef4444", label: "Main Session" },
};

// Status Config
const STATUS_CONFIG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  active: { icon: "🟢", color: "#22c55e", bg: "rgba(34,197,94,0.15)", label: "Aktiv" },
  idle: { icon: "🟡", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", label: "Idle" },
  completed: { icon: "⚪", color: "#64748b", bg: "rgba(100,116,139,0.15)", label: "Beendet" },
};

// Helper: Relative Time
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours}h`;
  const days = Math.floor(hours / 24);
  return `vor ${days}d`;
}

// Helper: Duration
function formatDuration(startStr: string, endStr?: string): string {
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const diff = end - start;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// Helper: Extract readable name from session ID
function extractName(sessionId: string, sender: string): string {
  // If sender looks like a real name, use it
  if (sender && !sender.includes(":") && !sender.match(/^[\d+]+$/)) {
    return sender;
  }
  
  // Extract from session key patterns
  // e.g. "agent:main:telegram:dm:+43664..." -> "Telegram DM"
  // e.g. "agent:main:webchat:dashboard" -> "Dashboard"
  // e.g. "dashboard:job:abc123" -> "Job abc123"
  const parts = sessionId.split(":");
  
  if (parts[0] === "dashboard" && parts[1] === "job") {
    return `Job ${parts[2]?.slice(0, 8) || ""}`;
  }
  
  if (parts.length >= 4) {
    const channel = parts[2];
    const type = parts[3];
    if (type === "dm" && parts[4]) {
      // Phone number or ID
      const id = parts.slice(4).join(":");
      if (id.startsWith("+")) {
        return `${id.slice(0, 4)}...${id.slice(-4)}`;
      }
      return id.slice(0, 12);
    }
    if (type === "group" || type === "channel") {
      return `${type.charAt(0).toUpperCase() + type.slice(1)} ${parts[4]?.slice(0, 8) || ""}`;
    }
    return parts.slice(3).join(":").slice(0, 20);
  }
  
  // Fallback: use sender or truncated ID
  return sender?.slice(0, 20) || sessionId.slice(0, 16);
}

interface SessionCardProps {
  session: SessionEntry;
  isSelected?: boolean;
  onClick?: () => void;
}

export function SessionCard({ session, isSelected, onClick }: SessionCardProps) {
  const ch = CHANNEL_CONFIG[session.channel] || { icon: "📨", color: "#888", label: session.channel };
  const st = STATUS_CONFIG[session.status] || STATUS_CONFIG.completed;
  
  // Token bar percentage (max ~50k for visual)
  const tokenPct = Math.min((session.tokens / 50000) * 100, 100);
  const tokenColor = tokenPct > 80 ? "#ef4444" : tokenPct > 50 ? "#f59e0b" : "#22c55e";
  
  // Readable name
  const displayName = extractName(session.id, session.sender);
  
  return (
    <div 
      className={`oc-session-card ${session.status === "active" ? "oc-session-card--active" : ""} ${isSelected ? "oc-session-card--selected" : ""}`}
      onClick={onClick}
    >
      {/* Channel Badge */}
      <div className="oc-session-card__channel" style={{ backgroundColor: ch.color + "22", color: ch.color }}>
        <span className="oc-session-card__channel-icon">{ch.icon}</span>
      </div>
      
      {/* Main Content */}
      <div className="oc-session-card__content">
        {/* Header Row */}
        <div className="oc-session-card__header">
          <div className="oc-session-card__title">
            <span className="oc-session-card__name">{displayName}</span>
            <span className="oc-session-card__channel-label">{ch.label}</span>
          </div>
          <div className="oc-session-card__status" style={{ color: st.color, backgroundColor: st.bg }}>
            {session.status === "active" && <span className="oc-session-card__pulse" />}
            {st.label}
          </div>
        </div>
        
        {/* Last Message Preview */}
        {session.lastMessage && (
          <div className="oc-session-card__preview">
            "{session.lastMessage.slice(0, 60)}{session.lastMessage.length > 60 ? "..." : ""}"
          </div>
        )}
        
        {/* Stats Row */}
        <div className="oc-session-card__stats">
          <span className="oc-session-card__stat" title="Nachrichten">
            💬 {session.messages >= 0 ? session.messages : "—"}
          </span>
          <span className="oc-session-card__stat" title="Tokens">
            🎫 {(session.tokens / 1000).toFixed(1)}k
          </span>
          <span className="oc-session-card__stat" title="Dauer">
            ⏱️ {formatDuration(session.startedAt, session.status === "completed" ? session.lastActivity : undefined)}
          </span>
          <span className="oc-session-card__time">
            {timeAgo(session.lastActivity)}
          </span>
        </div>
        
        {/* Token Progress Bar */}
        <div className="oc-session-card__bar">
          <div 
            className="oc-session-card__bar-fill" 
            style={{ width: `${tokenPct}%`, backgroundColor: tokenColor }}
          />
        </div>
      </div>
    </div>
  );
}

export default SessionCard;
