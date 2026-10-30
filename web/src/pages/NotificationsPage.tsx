import React, { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Shield, CheckCircle2 } from "lucide-react";
import { api, unwrapList } from "../api/client";
import type { AuditEventRecord, NotificationRecord } from "../types/api";
import { PageHeader, LoadingSkeleton, EmptyState, ErrorState } from "../components/States";
import { useToast } from "../contexts/ToastContext";

export function NotificationsPage() {
  const toast = useToast();

  const [tab, setTab] = useState<"notifications" | "audit">("notifications");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [nRes, aRes] = await Promise.all([
        api.get<NotificationRecord[] | { results: NotificationRecord[] }>(
          `/notifications/${unreadOnly ? "?is_read=false" : ""}`
        ),
        api.get<AuditEventRecord[] | { results: AuditEventRecord[] }>("/audit-events/"),
      ]);
      setNotifications(unwrapList<NotificationRecord>(nRes as NotificationRecord[]));
      setAuditEvents(unwrapList<AuditEventRecord>(aRes as AuditEventRecord[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    setLoading(true);
    void loadData();
  }, [loadData]);

  const handleMarkRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read/`);
      await loadData();
    } catch (err) {
      toast.error("Failed to mark read", err instanceof Error ? err.message : "Error");
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await api.post<{ marked_read_count: number }>("/notifications/mark-all-read/");
      toast.success("Notifications Cleared", `Marked ${res.marked_read_count} notifications read.`);
      await loadData();
    } catch (err) {
      toast.error("Action failed", err instanceof Error ? err.message : "Could not mark all read.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications & Security Audit Log"
        subtitle="System alerts, gateway connection notifications, and immutable security audit trail."
        actions={
          tab === "notifications" && (
            <>
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer mr-2">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                <span>Unread Only</span>
              </label>
              <button type="button" onClick={handleMarkAllRead} className="btn-secondary text-xs">
                <CheckCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>Mark All Read</span>
              </button>
            </>
          )
        }
      />

      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        <button
          type="button"
          onClick={() => setTab("notifications")}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer inline-flex items-center gap-1.5 ${
            tab === "notifications"
              ? "bg-violet-600 text-white border-violet-500"
              : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Notifications ({notifications.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("audit")}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer inline-flex items-center gap-1.5 ${
            tab === "audit"
              ? "bg-violet-600 text-white border-violet-500"
              : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Audit Log ({auditEvents.length})</span>
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : tab === "notifications" ? (
        notifications.length === 0 ? (
          <EmptyState
            title="All caught up"
            description="New gateway, campaign, and approval alerts will appear here in real time."
            icon={Bell}
          />
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`surface-card p-4 flex items-start justify-between gap-4 ${
                  !n.is_read ? "border-violet-500/45" : ""
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{n.title}</span>
                    {!n.is_read && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-600 text-white">
                        Unread
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">{n.body}</p>
                  <div className="text-[11px] text-[var(--text-muted)] mt-1">
                    {n.category} · {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => void handleMarkRead(n.id)}
                    className="btn-secondary text-xs py-1 px-2.5 shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Mark Read</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-elevated)]">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Summary</th>
                  <th className="py-3 px-4">Actor & IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                {auditEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="py-3 px-4 whitespace-nowrap text-[var(--text-muted)]">
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono text-violet-400">{ev.event_type}</td>
                    <td className="py-3 px-4 text-[var(--text-primary)]">{ev.summary}</td>
                    <td className="py-3 px-4 text-[var(--text-secondary)] font-mono">
                      {ev.actor_identifier || ev.actor_type} {ev.ip_address ? `(${ev.ip_address})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
