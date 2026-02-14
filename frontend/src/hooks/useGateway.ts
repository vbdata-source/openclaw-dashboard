// ============================================================
// useGateway — WebSocket Hook für Live-Events + Requests
// ============================================================
// Unterstützt:
// - Live-Event-Streaming vom Gateway
// - req/res Pattern: request("method", params) → Promise
// - Automatisches Reconnect
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";

export type GatewayStatus = "connecting" | "connected" | "disconnected";

export interface GatewayEvent {
  type: string;
  event?: string;
  level?: string;
  message?: string;
  timestamp?: number;
  payload?: any;
  [key: string]: any;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: ReturnType<typeof setTimeout>;
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

  // Pending req/res tracking
  const pendingRequests = useRef<Map<string, PendingRequest>>(new Map());

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // WS ist offen, aber Gateway-Handshake noch nicht abgeschlossen
      // Status bleibt "connecting" bis "gateway:status connected" kommt
      reconnectCount.current = 0;
      console.log("[Gateway] WS verbunden, warte auf Gateway-Handshake...");
    };

    ws.onmessage = (msg) => {
      try {
        const event: GatewayEvent = JSON.parse(msg.data);

        // ── Gateway-Status-Events ──────────────────────────
        if (event.type === "gateway:status") {
          if (event.status === "connected") {
            setStatus("connected");
            console.log("[Gateway] Gateway verbunden");
          } else if (event.status === "disconnected") {
            setStatus("disconnected");
            console.log("[Gateway] Gateway getrennt");
          } else if (event.status === "error") {
            console.error("[Gateway] Gateway-Fehler:", event.error);
          }
          onEventRef.current?.(event);
          return;
        }

        // ── Response auf pending Request ────────────────────
        if (event.type === "res" && event.id) {
          const pending = pendingRequests.current.get(event.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.current.delete(event.id);

            if (event.ok) {
              pending.resolve(event.payload ?? event);
            } else {
              pending.reject(
                new Error(event.error?.message || event.error?.code || "Request fehlgeschlagen")
              );
            }
            return;
          }
        }

        // ── Reguläre Events ────────────────────────────────
        setLastEvent(event);
        setEvents((prev) => {
          const next = [event, ...prev];
          return next.length > 200 ? next.slice(0, 200) : next;
        });

        onEventRef.current?.(event);
      } catch {
        // Non-JSON message
      }
    };

    ws.onclose = (e) => {
      setStatus("disconnected");
      wsRef.current = null;
      console.log("[Gateway] Verbindung geschlossen:", e.code, e.reason);

      // Alle pending requests rejecten
      pendingRequests.current.forEach((req) => {
        clearTimeout(req.timeout);
        req.reject(new Error("WebSocket geschlossen"));
      });
      pendingRequests.current.clear();

      // Reconnect
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
    reconnectCount.current = maxReconnects;
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

  // ── Gateway Request (req/res Pattern) ────────────────────
  const request = useCallback(
    (method: string, params: any = {}, timeoutMs = 15000): Promise<any> => {
      return new Promise((resolve, reject) => {
        const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const timeout = setTimeout(() => {
          pendingRequests.current.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }, timeoutMs);

        pendingRequests.current.set(id, { resolve, reject, timeout });

        const sent = send({
          type: "req",
          method,
          id,
          params,
        });

        if (!sent) {
          clearTimeout(timeout);
          pendingRequests.current.delete(id);
          reject(new Error("WebSocket nicht verbunden"));
        }
      });
    },
    [send]
  );

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

      // Cleanup pending requests
      pendingRequests.current.forEach((req) => {
        clearTimeout(req.timeout);
        req.reject(new Error("Unmount"));
      });
      pendingRequests.current.clear();
    };
  }, [autoConnect, connect, maxReconnects]);

  return {
    status,
    events,
    lastEvent,
    connect,
    disconnect,
    send,
    request,
    clearEvents,
  };
}
