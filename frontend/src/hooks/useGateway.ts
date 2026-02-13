// ============================================================
// useGateway — WebSocket Hook für Live-Events
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";

export type GatewayStatus = "connecting" | "connected" | "disconnected";

export interface GatewayEvent {
  type: string;
  [key: string]: any;
}

interface UseGatewayOptions {
  /** Automatisch verbinden wenn authentifiziert */
  autoConnect?: boolean;
  /** Reconnect-Intervall in ms */
  reconnectInterval?: number;
  /** Max Reconnect-Versuche */
  maxReconnects?: number;
  /** Event-Handler */
  onEvent?: (event: GatewayEvent) => void;
}

export function useGateway(options: UseGatewayOptions = {}) {
  const {
    autoConnect = true,
    reconnectInterval = 3000,
    maxReconnects = 10,
    onEvent,
  } = options;

  const [status, setStatus] = useState<GatewayStatus>("disconnected");
  const [events, setEvents] = useState<GatewayEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<GatewayEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    // Bestehende Verbindung schließen
    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus("connecting");

    // WebSocket-URL aus dem aktuellen Standort ableiten
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectCount.current = 0;
      console.log("[Gateway] Verbunden");
    };

    ws.onmessage = (msg) => {
      try {
        const event: GatewayEvent = JSON.parse(msg.data);

        // Gateway-Status-Events separat behandeln
        if (event.type === "gateway:status") {
          if (event.status === "disconnected") {
            setStatus("disconnected");
          }
          return;
        }

        setLastEvent(event);
        setEvents((prev) => {
          const next = [event, ...prev];
          // Max 200 Events im Speicher behalten
          return next.length > 200 ? next.slice(0, 200) : next;
        });

        onEventRef.current?.(event);
      } catch {
        // Non-JSON message, ignorieren
      }
    };

    ws.onclose = (e) => {
      setStatus("disconnected");
      wsRef.current = null;
      console.log("[Gateway] Verbindung geschlossen:", e.code, e.reason);

      // Reconnect wenn nicht absichtlich geschlossen
      if (e.code !== 1000 && reconnectCount.current < maxReconnects) {
        reconnectCount.current++;
        console.log(
          `[Gateway] Reconnect ${reconnectCount.current}/${maxReconnects} in ${reconnectInterval}ms`
        );
        reconnectTimer.current = setTimeout(connect, reconnectInterval);
      }
    };

    ws.onerror = (err) => {
      console.error("[Gateway] WebSocket-Fehler:", err);
    };
  }, [reconnectInterval, maxReconnects]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
    }
    reconnectCount.current = maxReconnects; // Verhindere Reconnect
    if (wsRef.current) {
      wsRef.current.close(1000, "Dashboard disconnect");
    }
    setStatus("disconnected");
  }, [maxReconnects]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  // Auto-Connect
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      reconnectCount.current = maxReconnects;
      wsRef.current?.close(1000);
    };
  }, [autoConnect, connect, maxReconnects]);

  return {
    status,
    events,
    lastEvent,
    connect,
    disconnect,
    send,
    clearEvents,
  };
}
