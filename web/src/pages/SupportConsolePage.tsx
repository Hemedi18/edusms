import React, { useCallback, useEffect, useState } from "react";
import {
  Headset,
  AlertOctagon,
  Send,
  Mail,
  UserCheck,
  ShieldCheck,
  Laptop,
  Globe,
  CheckCircle2,
  RefreshCw,
  Image as ImageIcon,
  Terminal,
} from "lucide-react";
import { api } from "../api/client";
import { useRealtimeEvent } from "../contexts/RealtimeContext";
import { useToast } from "../contexts/ToastContext";
import type { SupportThreadItem } from "../components/InstantHelpWidget";

interface ErrorReportRecord {
  id: string;
  short_id: string;
  user_email: string;
  user_name: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  stack_trace: string;
  page_url: string;
  screenshot_data_url: string;
  user_session_info: Record<string, unknown>;
  admin_email_sent: boolean;
  auto_reply_email_sent: boolean;
  admin_response: string;
  created_at: string;
}

export function SupportConsolePage() {
  const toast = useToast();

  const [section, setSection] = useState<"chats" | "errors">("chats");
  const [threads, setThreads] = useState<SupportThreadItem[]>([]);
  const [selectedThread, setSelectedThread] = useState<SupportThreadItem | null>(null);
  const [errors, setErrors] = useState<ErrorReportRecord[]>([]);
  const [selectedError, setSelectedError] = useState<ErrorReportRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const [adminReplyText, setAdminReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const [errorResolutionText, setErrorResolutionText] = useState("");
  const [updatingError, setUpdatingError] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [threadsRes, errorsRes] = await Promise.all([
        api.get<SupportThreadItem[]>("/support/threads/").catch(() => []),
        api.get<ErrorReportRecord[]>("/support/errors/").catch(() => []),
      ]);
      const tList = Array.isArray(threadsRes) ? threadsRes : [];
      const eList = Array.isArray(errorsRes) ? errorsRes : [];
      setThreads(tList);
      setErrors(eList);
      if (tList.length > 0 && !selectedThread) {
        setSelectedThread(tList[0]);
      } else if (selectedThread) {
        const refreshed = tList.find((x) => x.id === selectedThread.id);
        if (refreshed) setSelectedThread(refreshed);
      }
      if (eList.length > 0 && !selectedError) {
        setSelectedError(eList[0]);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedThread, selectedError]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useRealtimeEvent(["support.message", "error.reported"], () => {
    void fetchAll();
  });

  const handleSelectThread = async (t: SupportThreadItem) => {
    try {
      const full = await api.get<SupportThreadItem>(`/support/threads/${t.id}/`);
      setSelectedThread(full);
    } catch {
      setSelectedThread(t);
    }
  };

  const handleSendAdminReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedThread || !adminReplyText.trim()) return;
    setSendingReply(true);
    try {
      const updated = await api.post<SupportThreadItem>(`/support/threads/${selectedThread.id}/messages/`, {
        body: adminReplyText.trim(),
        sender_type: "admin",
      });
      setSelectedThread(updated);
      setAdminReplyText("");
      toast.success("Reply delivered live to customer chat & email!");
      void fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  const handleSimulateInboundEmailReply = async () => {
    if (!selectedThread) return;
    const replyBody =
      adminReplyText.trim() ||
      "Hello! I received your message in my email inbox and I am replying directly from email to your live chat.";
    setSendingReply(true);
    try {
      await api.post("/support/email-reply-webhook/", {
        subject: `Re: [EduSMS Live Chat #${selectedThread.short_id}] [Reply-Token:${selectedThread.reply_token}]`,
        from_email: "support@edusms.edusphere.co.tz",
        body: replyBody,
        reply_token: selectedThread.reply_token,
      });
      const updated = await api.get<SupportThreadItem>(`/support/threads/${selectedThread.id}/`);
      setSelectedThread(updated);
      setAdminReplyText("");
      toast.success("Direct email reply bridged into customer Live Chat!");
      void fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Email reply bridge failed");
    } finally {
      setSendingReply(false);
    }
  };

  const handleResolveError = async (statusVal: "investigating" | "resolved") => {
    if (!selectedError) return;
    setUpdatingError(true);
    try {
      const updated = await api.patch<ErrorReportRecord>(`/support/errors/${selectedError.id}/`, {
        status: statusVal,
        admin_response: errorResolutionText.trim() || selectedError.admin_response,
      });
      setSelectedError(updated);
      setErrorResolutionText("");
      toast.success(`Error #${updated.short_id} marked ${statusVal} & user notified via email!`);
      void fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update error report");
    } finally {
      setUpdatingError(false);
    }
  };

  const activeCtx = (
    section === "chats"
      ? selectedThread?.customer_context || {}
      : selectedError?.user_session_info || {}
  ) as Record<string, unknown>;
  const sessionObj = (activeCtx.session || {}) as Record<string, unknown>;
  const telemetryObj = (activeCtx.telemetry || {}) as Record<string, unknown>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Headset className="w-5 h-5 text-violet-400" />
            <span>Live Customer Chat & Error Monitoring Console</span>
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Interact with customers in real time, inspect automatic session & account telemetry on the side of the
            chat, view client screen captures, and manage automatic/manual error reports.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setSection("chats")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                section === "chats" ? "bg-violet-600 text-white" : "text-[var(--text-secondary)]"
              }`}
            >
              <Headset className="w-3.5 h-3.5" />
              <span>Customer Live Chats ({threads.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSection("errors")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                section === "errors" ? "bg-rose-600 text-white" : "text-[var(--text-secondary)]"
              }`}
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>Recorded Errors ({errors.length})</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void fetchAll()}
            className="btn-secondary p-2 text-xs"
            title="Refresh console"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* 3-Column Workspace: List | Conversation/Error View | Automatic Customer Context Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column (3 cols): Threads or Errors List */}
        <div className="lg:col-span-3 surface-card p-3 space-y-2 max-h-[640px] overflow-y-auto">
          {section === "chats" ? (
            threads.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] p-4 text-center">
                No customer chat threads yet. Click the Instant Help icon at the bottom-right to start one!
              </p>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void handleSelectThread(t)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedThread?.id === t.id
                      ? "bg-violet-600/15 border-violet-500/40"
                      : "bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:border-violet-500/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {t.user_name || t.user_email || "Guest Visitor"}
                    </span>
                    <span className="text-[10px] font-mono text-violet-400">#{t.short_id}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                    {t.user_email || "Unauthenticated session"}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/15 text-cyan-400 font-medium">
                      {t.mode === "live_human" ? "Live Chat" : "AI Help"}
                    </span>
                    {t.unread_for_admin > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                        {t.unread_for_admin} new
                      </span>
                    )}
                  </div>
                </button>
              ))
            )
          ) : errors.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] p-4 text-center">No errors recorded.</p>
          ) : (
            errors.map((err) => (
              <button
                key={err.id}
                type="button"
                onClick={() => setSelectedError(err)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selectedError?.id === err.id
                    ? "bg-rose-600/15 border-rose-500/40"
                    : "bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:border-rose-500/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--text-primary)] truncate">{err.title}</span>
                  <span className="text-[10px] font-mono text-rose-400">#{err.short_id}</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                  {err.user_email || "Anonymous"} • {err.source}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      err.status === "resolved"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400"
                    }`}
                  >
                    {err.status.toUpperCase()}
                  </span>
                  {err.admin_email_sent && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <Mail className="w-3 h-3" /> Emailed
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Center Column (5 cols): Active Live Chat or Error Report Inspector */}
        <div className="lg:col-span-5 surface-card flex flex-col min-h-[560px]">
          {section === "chats" ? (
            selectedThread ? (
              <>
                <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[var(--text-primary)]">
                      {selectedThread.user_name || "Customer"} (#{selectedThread.short_id})
                    </h2>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Reply-Token: <code className="font-mono text-violet-400">{selectedThread.reply_token}</code>
                    </p>
                  </div>
                  <span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold">
                    {selectedThread.first_email_notified ? "First Email Sent to Owner" : "Ready"}
                  </span>
                </div>

                <div className="flex-1 p-4 space-y-3 max-h-[380px] overflow-y-auto">
                  {selectedThread.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`p-3 rounded-xl text-xs space-y-1.5 ${
                        m.sender_type === "admin"
                          ? "bg-violet-600/20 border border-violet-500/30 ml-6"
                          : m.sender_type === "user"
                            ? "bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mr-6"
                            : "bg-cyan-500/10 border border-cyan-500/20"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                        <span className="font-bold text-[var(--text-primary)]">{m.sender_label}</span>
                        <span>
                          {m.via_channel} • {new Date(m.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-[var(--text-primary)]">{m.body}</p>
                      {m.screenshot_data_url && (
                        <div className="pt-2">
                          <p className="text-[10px] text-cyan-400 flex items-center gap-1 mb-1">
                            <ImageIcon className="w-3 h-3" /> Client Screen Capture:
                          </p>
                          <img
                            src={m.screenshot_data_url}
                            alt="Client screenshot"
                            className="rounded-lg border border-[var(--border-subtle)] max-h-48 w-auto"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <form
                  onSubmit={handleSendAdminReply}
                  className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2"
                >
                  <textarea
                    rows={2}
                    value={adminReplyText}
                    onChange={(e) => setAdminReplyText(e.target.value)}
                    placeholder="Type reply to customer (shown immediately in their Live Chat & emailed)..."
                    className="input-field text-xs"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSimulateInboundEmailReply()}
                      disabled={sendingReply}
                      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                      title="Test replying directly from your email inbox into the customer's Live Chat"
                    >
                      <Mail className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Send via Email-to-Chat Bridge</span>
                    </button>
                    <button
                      type="submit"
                      disabled={sendingReply || !adminReplyText.trim()}
                      className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Live Reply</span>
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">Select a customer chat thread.</div>
            )
          ) : selectedError ? (
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <span className="text-[11px] font-mono text-rose-400">Incident #{selectedError.short_id}</span>
                  <h2 className="text-base font-bold text-[var(--text-primary)]">{selectedError.title}</h2>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Page: <code className="font-mono">{selectedError.page_url || "N/A"}</code>
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 text-[10px] font-bold block">
                    {selectedError.severity.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-emerald-400 block">
                    {selectedError.auto_reply_email_sent ? "Auto-Reply Email Sent" : "Logged"}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-[var(--text-secondary)]">Error Message:</p>
                <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] whitespace-pre-wrap">
                  {selectedError.message}
                </div>
              </div>

              {selectedError.stack_trace && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1">
                    <Terminal className="w-3.5 h-3.5 text-amber-400" /> Stack Trace / Diagnostics:
                  </p>
                  <pre className="p-3 rounded-xl bg-black/40 border border-[var(--border-subtle)] text-[11px] font-mono text-amber-300 overflow-x-auto max-h-40">
                    {selectedError.stack_trace}
                  </pre>
                </div>
              )}

              {selectedError.screenshot_data_url && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">Captured Client Screen:</p>
                  <img
                    src={selectedError.screenshot_data_url}
                    alt="Error screen snapshot"
                    className="rounded-xl border border-[var(--border-subtle)] max-h-52 w-auto"
                  />
                </div>
              )}

              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                  Send Resolution / Response to User Email ({selectedError.user_email || "No email"}):
                </label>
                <textarea
                  rows={2}
                  value={errorResolutionText}
                  onChange={(e) => setErrorResolutionText(e.target.value)}
                  placeholder="Explain the fix or next steps (will be emailed to the user)..."
                  className="input-field text-xs"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={updatingError}
                    onClick={() => void handleResolveError("investigating")}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    Mark Investigating
                  </button>
                  <button
                    type="button"
                    disabled={updatingError}
                    onClick={() => void handleResolveError("resolved")}
                    className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Resolve & Email User</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">Select an error report.</div>
          )}
        </div>

        {/* Right Column (4 cols): Automatic Customer & Session Context Sidebar */}
        <div
          data-testid="customer-context-sidebar"
          className="lg:col-span-4 surface-card p-4 space-y-4 border-l-2 border-l-violet-500"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-violet-400" />
                <span>Recorded Customer & Session Info</span>
              </h3>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Automatically captured on the side of the chat
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 text-[10px] font-semibold">
              Auto-Synced
            </span>
          </div>

          {/* Identity & Kind of User */}
          <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Kind of User:</span>
              <span className="font-bold text-cyan-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                {String(activeCtx.user_kind || "Authenticated User")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">User Email:</span>
              <span className="font-mono font-semibold text-[var(--text-primary)]">
                {String(activeCtx.email || selectedThread?.user_email || selectedError?.user_email || "guest")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Full Name:</span>
              <span className="font-medium text-[var(--text-primary)]">
                {String(activeCtx.full_name || selectedThread?.user_name || "Visitor")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Organization:</span>
              <span className="text-[var(--text-secondary)]">{String(activeCtx.organization || "N/A")}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Email Verified / MFA:</span>
              <span className="text-[var(--text-secondary)]">
                {activeCtx.email_verified ? "Verified" : "Unverified"} • MFA: {activeCtx.mfa_enabled ? "On" : "Off"}
              </span>
            </div>
          </div>

          {/* Active Session Telemetry */}
          <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2 text-xs">
            <p className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Laptop className="w-3.5 h-3.5 text-emerald-400" />
              <span>Active Session Details</span>
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Session ID:</span>
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                {String(sessionObj.session_id || "active").slice(0, 16)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Device Label:</span>
              <span className="text-[var(--text-primary)]">{String(sessionObj.device_label || "Web Dashboard")}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">IP Address:</span>
              <span className="font-mono text-[11px] text-[var(--text-primary)]">
                {String(sessionObj.ip_address || "127.0.0.1")}
              </span>
            </div>
            <div className="space-y-0.5">
              <span className="text-[var(--text-muted)] block">Current Page URL:</span>
              <code className="block text-[10px] font-mono text-violet-400 break-all">
                {String(activeCtx.page_url || selectedError?.page_url || "/")}
              </code>
            </div>
            <div className="space-y-0.5">
              <span className="text-[var(--text-muted)] block">Browser / User-Agent:</span>
              <p className="text-[10px] text-[var(--text-secondary)] break-words">
                {String(sessionObj.user_agent || activeCtx.browser_info || "Browser")}
              </p>
            </div>
          </div>

          {/* Platform Telemetry */}
          <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2 text-xs">
            <p className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span>Workspace & Gateway Snapshot</span>
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2 rounded-lg bg-[var(--bg-surface)]">
                <p className="text-[10px] text-[var(--text-muted)]">SIM Gateways</p>
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {Number(telemetryObj.online_devices_count || 0)} / {Number(telemetryObj.paired_devices_count || 0)}{" "}
                  online
                </p>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-surface)]">
                <p className="text-[10px] text-[var(--text-muted)]">Total SMS</p>
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {Number(telemetryObj.total_messages_count || 0)}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-surface)]">
                <p className="text-[10px] text-[var(--text-muted)]">Active Mode</p>
                <p className="text-xs font-bold text-violet-400">{String(telemetryObj.active_mode || "Default")}</p>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-surface)]">
                <p className="text-[10px] text-[var(--text-muted)]">Open Errors</p>
                <p className="text-xs font-bold text-rose-400">
                  {Number(telemetryObj.unresolved_errors_count || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
