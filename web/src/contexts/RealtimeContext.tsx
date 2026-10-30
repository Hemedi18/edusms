import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { tokenStore } from "../api/client";
import { useAuth } from "./AuthContext";

export interface RealtimeMessage {
  event: string;
  payload: Record<string, unknown>;
  timestamp?: string;
}

type EventSubscriber = (msg: RealtimeMessage) => void;

interface RealtimeContextValue {
  isConnected: boolean;
  lastEvent: RealtimeMessage | null;
  subscribe: (handler: EventSubscriber) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RealtimeMessage | null>(null);
  const subscribersRef = useRef<Set<EventSubscriber>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined" || typeof window.WebSocket === "undefined") {
      setIsConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retryAttempt = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const token = tokenStore.getAccess();
      if (!token) return;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host || "127.0.0.1:8000";
      const wsUrl = `${proto}//${host}/ws/events/?token=${encodeURIComponent(token)}`;

      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setIsConnected(false);
        return;
      }

      ws.onopen = () => {
        if (disposed) return;
        retryAttempt = 0;
        setIsConnected(true);
      };

      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse(String(ev.data)) as Record<string, unknown>;
          const eventName = String(parsed.event || parsed.type || "");
          if (!eventName || eventName === "pong") return;
          const payload =
            parsed.payload && typeof parsed.payload === "object"
              ? (parsed.payload as Record<string, unknown>)
              : parsed.data && typeof parsed.data === "object"
                ? (parsed.data as Record<string, unknown>)
                : {};
          const normalized: RealtimeMessage = {
            event: eventName,
            payload,
            timestamp: parsed.timestamp ? String(parsed.timestamp) : undefined,
          };
          setLastEvent(normalized);
          for (const sub of Array.from(subscribersRef.current)) {
            sub(normalized);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setIsConnected(false);
        const delayMs = Math.min(15000, 1500 * Math.pow(1.6, retryAttempt));
        retryAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delayMs);
      };

      ws.onerror = () => {
        // onclose handles reconnection gracefully
      };
    };

    connect();

    const handleTokenUpdate = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
    window.addEventListener("edusms:tokens-updated", handleTokenUpdate);

    return () => {
      disposed = true;
      window.removeEventListener("edusms:tokens-updated", handleTokenUpdate);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [isAuthenticated]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      isConnected,
      lastEvent,
      subscribe: (handler: EventSubscriber) => {
        subscribersRef.current.add(handler);
        return () => {
          subscribersRef.current.delete(handler);
        };
      },
    }),
    [isConnected, lastEvent]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error("useRealtime must be used within a RealtimeProvider");
  }
  return ctx;
}

export function useRealtimeEvent(eventTypes: string[], handler: (msg: RealtimeMessage) => void): void {
  const { subscribe } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const typesKey = eventTypes.join(",");

  useEffect(() => {
    const allowed = new Set(typesKey.split(",").filter(Boolean));
    return subscribe((msg) => {
      if (allowed.has("*") || allowed.has(msg.event)) {
        handlerRef.current(msg);
      }
    });
  }, [subscribe, typesKey]);
}
