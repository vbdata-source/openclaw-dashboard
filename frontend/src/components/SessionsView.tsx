// ============================================================
// SessionsView — WOW Sessions Dashboard Component
// ============================================================

import React, { useState, useMemo } from "react";
import { SessionCard } from "./SessionCard";

// Session Entry Interface (same as App.tsx)
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

// Session Preview Item (from chat history)
export interface SessionPreviewItem {
  role: "user" | "assistant" | "system";
  text: string;
  ts?: number;
}

interface SessionsViewProps {
  sessions: SessionEntry[];
  loading?: boolean;
  onSelectSession: (session: SessionEntry | null) => void;
  selectedSession: SessionEntry | null;
  sessionPreview: SessionPreviewItem[];
  previewLoading: boolean;
}

// Stats Card Component
function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color?: string }) {
  return (
    <div className="oc-sessions-stat">
      <span className="oc-sessions-stat__icon" style={color ? { color } : {}}>{icon}</span>
      <div className="oc-sessions-stat__content">
        <span className="oc-sessions-stat__value">{value}</span>
        <span className="oc-sessions-stat__label">{label}</span>
      </div>
    </div>
  );
}

// Filter Chip Component
function FilterChip({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button 
      className={`oc-sessions-filter ${active ? "oc-sessions-filter--active" : ""}`}
      onClick={onClick}
    >
      {label}
      {count !== undefined && count > 0 && <span className="oc-sessions-filter__count">{count}</span>}
    </button>
  );
}

// Session Detail Panel
function SessionDetailPanel({ session, preview, loading, onClose }: {
  session: SessionEntry;
  preview: SessionPreviewItem[];
  loading: boolean;
  onClose: () => void;
}) {
  const CHANNEL_ICONS: Record<string, string> = {
    telegram: "✈️", whatsapp: "📱", discord: "🎮", slack: "💼",
    msteams: "🏢", signal: "🔒", webchat: "🌐", cron: "⏰",
    subagent: "🤖", imessage: "🍎", googlechat: "💬",
  };
  
  return (
    <div className="oc-session-detail">
      {/* Header */}
      <div className="oc-session-detail__header">
        <div className="oc-session-detail__title">
          <span className="oc-session-detail__icon">{CHANNEL_ICONS[session.channel] || "💬"}</span>
          <div>
            <h3>{session.sender || session.id.slice(0, 20)}</h3>
            <span className="oc-session-detail__sub">{session.channel} • {session.id.slice(0, 24)}...</span>
          </div>
        </div>
        <button className="oc-session-detail__close" onClick={onClose}>✕</button>
      </div>
      
      {/* Stats Bar */}
      <div className="oc-session-detail__stats">
        <div className="oc-session-detail__stat">
          <span>💬</span> {session.messages} Messages
        </div>
        <div className="oc-session-detail__stat">
          <span>🎫</span> {(session.tokens / 1000).toFixed(1)}k Tokens
        </div>
        <div className="oc-session-detail__stat">
          <span>⏱️</span> {new Date(session.startedAt).toLocaleTimeString("de-AT")}
        </div>
      </div>
      
      {/* Chat History */}
      <div className="oc-session-detail__chat">
        {loading && (
          <div className="oc-session-detail__loading">
            <span className="oc-loading-spinner">⏳</span>
            <span>Lade Chat-Verlauf...</span>
          </div>
        )}
        
        {!loading && preview.length === 0 && (
          <div className="oc-session-detail__empty">
            <span>📭</span>
            <span>Keine Nachrichten vorhanden</span>
          </div>
        )}
        
        {!loading && preview.map((msg, i) => (
          <div key={i} className={`oc-session-detail__msg oc-session-detail__msg--${msg.role}`}>
            <div className="oc-session-detail__msg-header">
              <span className="oc-session-detail__msg-role">
                {msg.role === "user" ? "👤 User" : msg.role === "assistant" ? "🤖 Agent" : "⚙️ System"}
              </span>
              {msg.ts && (
                <span className="oc-session-detail__msg-time">
                  {new Date(msg.ts).toLocaleTimeString("de-AT")}
                </span>
              )}
            </div>
            <div className="oc-session-detail__msg-text">{msg.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionsView({ 
  sessions, 
  loading, 
  onSelectSession, 
  selectedSession, 
  sessionPreview, 
  previewLoading 
}: SessionsViewProps) {
  const [filter, setFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"activity" | "tokens" | "messages">("activity");
  
  // Calculate stats
  const stats = useMemo(() => {
    const total = sessions.length;
    const active = sessions.filter(s => s.status === "active").length;
    const totalTokens = sessions.reduce((sum, s) => sum + s.tokens, 0);
    const totalMessages = sessions.reduce((sum, s) => sum + s.messages, 0);
    const channels = new Set(sessions.map(s => s.channel)).size;
    
    return { total, active, totalTokens, totalMessages, channels };
  }, [sessions]);
  
  // Get unique channels for filter
  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sessions.forEach(s => {
      counts[s.channel] = (counts[s.channel] || 0) + 1;
    });
    return counts;
  }, [sessions]);
  
  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let filtered = sessions;
    
    // Apply channel filter
    if (filter !== "all") {
      if (filter === "active") {
        filtered = filtered.filter(s => s.status === "active");
      } else {
        filtered = filtered.filter(s => s.channel === filter);
      }
    }
    
    // Sort
    return [...filtered].sort((a, b) => {
      // Active sessions always first
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      
      switch (sortBy) {
        case "tokens":
          return b.tokens - a.tokens;
        case "messages":
          return b.messages - a.messages;
        case "activity":
        default:
          return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      }
    });
  }, [sessions, filter, sortBy]);
  
  return (
    <div className="oc-sessions-layout">
      {/* Main Content */}
      <div className={`oc-sessions-main ${selectedSession ? "oc-sessions-main--narrow" : ""}`}>
        {/* Header */}
        <div className="oc-sessions-header">
          <div className="oc-sessions-header__left">
            <h2 className="oc-sessions-title">
              ⚡ Live Sessions
              {loading && <span className="oc-loading-sm">⏳</span>}
            </h2>
            {stats.active > 0 && (
              <span className="oc-sessions-live-badge">
                <span className="oc-pulse-dot" />
                {stats.active} aktiv
              </span>
            )}
          </div>
          
          <div className="oc-sessions-header__right">
            <select 
              className="oc-sessions-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="activity">Nach Aktivität</option>
              <option value="tokens">Nach Tokens</option>
              <option value="messages">Nach Nachrichten</option>
            </select>
          </div>
        </div>
        
        {/* Stats Row */}
        <div className="oc-sessions-stats">
          <StatCard icon="🤖" value={stats.total} label="Sessions" />
          <StatCard icon="💬" value={stats.totalMessages} label="Messages" />
          <StatCard icon="🎫" value={`${(stats.totalTokens / 1000).toFixed(1)}k`} label="Tokens" />
          <StatCard icon="📡" value={stats.channels} label="Kanäle" />
        </div>
        
        {/* Filter Row */}
        <div className="oc-sessions-filters">
          <FilterChip 
            label="Alle" 
            active={filter === "all"} 
            count={sessions.length}
            onClick={() => setFilter("all")} 
          />
          <FilterChip 
            label="🟢 Aktiv" 
            active={filter === "active"} 
            count={stats.active}
            onClick={() => setFilter("active")} 
          />
          {Object.entries(channelCounts).map(([ch, count]) => (
            <FilterChip 
              key={ch}
              label={ch} 
              active={filter === ch} 
              count={count}
              onClick={() => setFilter(ch)} 
            />
          ))}
        </div>
        
        {/* Session Cards */}
        <div className="oc-sessions-grid">
          {filteredSessions.length === 0 && !loading && (
            <div className="oc-sessions-empty">
              <span className="oc-sessions-empty__icon">📭</span>
              <span>Keine Sessions gefunden</span>
            </div>
          )}
          
          {filteredSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isSelected={selectedSession?.id === session.id}
              onClick={() => onSelectSession(selectedSession?.id === session.id ? null : session)}
            />
          ))}
        </div>
      </div>
      
      {/* Detail Panel */}
      {selectedSession && (
        <SessionDetailPanel
          session={selectedSession}
          preview={sessionPreview}
          loading={previewLoading}
          onClose={() => onSelectSession(null)}
        />
      )}
    </div>
  );
}

export default SessionsView;
