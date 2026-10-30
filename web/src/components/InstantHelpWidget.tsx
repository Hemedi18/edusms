import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquareHeart,
  Sparkles,
  Camera,
  Send,
  X,
  AlertTriangle,
  Bot,
  UserCheck,
  CheckCircle2,
  Trash2,
  MailCheck,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useRealtimeEvent } from "../contexts/RealtimeContext";
import { useToast } from "../contexts/ToastContext";
import { captureViewportScreenshot } from "../utils/screenshot";

export interface SupportMessageItem {
  id: string;
  thread: string;
  sender_type: "user" | "admin" | "ai" | "system";
  sender_label: string;
  via_channel: string;
  body: string;
  screenshot_data_url: string;
  created_at: string;
}

export interface SupportThreadItem {
  id: string;
  short_id: string;
  user_email: string;
  user_name: string;
  subject: string;
  mode: "ai_assistant" | "live_human";
  status: string;
  reply_token: string;
  first_email_notified: boolean;
  customer_context: Record<string, unknown>;
  unread_for_admin: number;
  unread_for_user: number;
  last_message_at: string;
  messages: SupportMessageItem[];
}

const THREAD_STORAGE_KEY = "edusms.active_support_thread_id";

export function InstantHelpWidget() {
  const { user } = useAuth();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "error">("chat");
  const [chatMode, setChatMode] = useState<"live_human" | "ai_assistant">("live_human");
  const [thread, setThread] = useState<SupportThreadItem | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  // Chat composer state
  const [messageText, setMessageText] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [screenshotDataUrl, setScreenshotDataUrl] = useState("");
  const [capturingScreen, setCapturingScreen] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);

  // Manual error report state
  const [errorTitle, setErrorTitle] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [errorSeverity, setErrorSeverity] = useState<"manual" | "error" | "critical">("manual");
  const [submittingError, setSubmittingError] = useState(false);
  const [lastReportedShortId, setLastReportedShortId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 1. Global Automatic Runtime Error & Unhandled Promise Rejection Recorder
  useEffect(() => {
    const onRuntimeError = (event: ErrorEvent) => {
      const title = event.message || "Uncaught Runtime Error";
      const stack = event.error?.stack || `${event.filename || ""}:${event.lineno || 0}:${event.colno || 0}`;
      void api
        .post("/support/errors/", {
          source: "web_auto",
          severity: "error",
          title: title.slice(0, 220),
          message: title,
          stack_trace: stack,
          page_url: window.location.href,
          user_email: user?.email || guestEmail,
          user_name: user?.full_name || guestName,
        })
        .catch(() => null);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === "string"
            ? event.reason
            : "Unhandled Promise Rejection";
      const stack = event.reason instanceof Error ? event.reason.stack || "" : "";
      void api
        .post("/support/errors/", {
          source: "web_auto",
          severity: "warning",
          title: `Unhandled Async Error: ${reason.slice(0, 180)}`,
          message: reason,
          stack_trace: stack,
          page_url: window.location.href,
          user_email: user?.email || guestEmail,
          user_name: user?.full_name || guestName,
        })
        .catch(() => null);
    };

    window.addEventListener("error", onRuntimeError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onRuntimeError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [user, guestEmail, guestName]);

  // 2. Load or create active support thread when drawer opens
  const loadActiveThread = useCallback(async () => {
    setLoadingThread(true);
    try {
      const storedId = localStorage.getItem(THREAD_STORAGE_KEY) || undefined;
      const res = await api.post<SupportThreadItem>("/support/threads/active/", {
        thread_id: storedId,
        mode: chatMode,
        page_url: window.location.href,
        user_email: user?.email || guestEmail,
        user_name: user?.full_name || guestName,
        browser_info: navigator.userAgent,
      });
      setThread(res);
      setChatMode(res.mode);
      localStorage.setItem(THREAD_STORAGE_KEY, res.id);
    } catch {
      // Fallback local thread state if offline
    } finally {
      setLoadingThread(false);
    }
  }, [chatMode, user, guestEmail, guestName]);

  useEffect(() => {
    if (open && !thread) {
      void loadActiveThread();
    }
  }, [open, thread, loadActiveThread]);

  useEffect(() => {
    if (open && messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [open, thread?.messages?.length]);

  // 3. Real-time WebSocket updates when Admin replies from Support Console or Direct Email
  useRealtimeEvent(["support.message"], (evt) => {
    const payload = evt.payload as { thread_id?: string; message?: SupportMessageItem };
    if (payload.thread_id && thread && payload.thread_id === thread.id && payload.message) {
      setThread((prev) => {
        if (!prev) return prev;
        const exists = prev.messages.some((m) => m.id === payload.message!.id);
        if (exists) return prev;
        return {
          ...prev,
          messages: [...prev.messages, payload.message!],
        };
      });
    }
  });

  const handleCaptureScreenshot = async () => {
    setCapturingScreen(true);
    try {
      const dataUrl = await captureViewportScreenshot();
      if (dataUrl) {
        setScreenshotDataUrl(dataUrl);
        toast.success("Screen captured! Ready to send with your message.");
      }
    } catch {
      toast.error("Could not capture screen snapshot.");
    } finally {
      setCapturingScreen(false);
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() && !screenshotDataUrl) return;
    setSendingMsg(true);
    try {
      let currentThread = thread;
      if (!currentThread) {
        currentThread = await api.post<SupportThreadItem>("/support/threads/active/", {
          mode: chatMode,
          page_url: window.location.href,
          user_email: user?.email || guestEmail,
          user_name: user?.full_name || guestName,
        });
      }
      const updated = await api.post<SupportThreadItem>(`/support/threads/${currentThread.id}/messages/`, {
        body: messageText.trim() || "[Attached Screen Capture]",
        screenshot_data_url: screenshotDataUrl,
        mode: chatMode,
        sender_type: "user",
        page_url: window.location.href,
        user_email: user?.email || guestEmail,
        user_name: user?.full_name || guestName,
      });
      setThread(updated);
      setMessageText("");
      setScreenshotDataUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSendingMsg(false);
    }
  };

  const handleManualErrorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!errorTitle.trim() && !errorMessage.trim()) return;
    setSubmittingError(true);
    try {
      const report = await api.post<{ id: string; short_id: string }>("/support/errors/", {
        source: "web_manual",
        severity: errorSeverity,
        title: errorTitle.trim() || "User Submitted Issue",
        message: errorMessage.trim() || errorTitle.trim(),
        page_url: window.location.href,
        screenshot_data_url: screenshotDataUrl,
        user_email: user?.email || guestEmail,
        user_name: user?.full_name || guestName,
      });
      setLastReportedShortId(report.short_id);
      setErrorTitle("");
      setErrorMessage("");
      setScreenshotDataUrl("");
      toast.success(`Error #${report.short_id} recorded & emailed to Support!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit error report");
    } finally {
      setSubmittingError(false);
    }
  };

  return (
    <>
      {/* Floating Bottom-Right Instant Help & AI Help Button */}
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
        <button
          type="button"
          data-testid="instant-help-fab"
          onClick={() => setOpen((prev) => !prev)}
          className="group flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 text-white font-semibold text-xs shadow-xl shadow-violet-600/30 hover:scale-[1.02] transition-all cursor-pointer"
          aria-label="Open Instant Help and AI Support Chat"
        >
          <MessageSquareHeart className="w-4 h-4" />
          <span>Instant Help & AI Chat</span>
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">Live + Screen</span>
        </button>
      </div>

      {/* Slide-Over Side Chat Interface */}
      {open && (
        <aside
          aria-label="Instant Help Side Chat Drawer"
          className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center text-white shadow">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Instant Help & AI Support</h2>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Live Owner Chat • Instant AI • Screen Capture
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              aria-label="Close Instant Help"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Tabs: Chat vs Report Error */}
          <div className="px-4 pt-3 pb-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-[var(--bg-elevated)] p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === "chat"
                    ? "bg-violet-600 text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Live & AI Chat
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("error")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
                  activeTab === "error"
                    ? "bg-rose-600 text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Report Error</span>
              </button>
            </div>

            {activeTab === "chat" && (
              <div className="flex items-center gap-1 bg-[var(--bg-elevated)] p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setChatMode("live_human")}
                  className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 ${
                    chatMode === "live_human"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  <UserCheck className="w-3 h-3" />
                  <span>Live Chat</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChatMode("ai_assistant")}
                  className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 ${
                    chatMode === "ai_assistant"
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  <Bot className="w-3 h-3" />
                  <span>AI Help</span>
                </button>
              </div>
            )}
          </div>

          {activeTab === "chat" ? (
            <>
              {/* Email Bridge Info Banner */}
              <div className="px-4 py-2 bg-violet-500/10 border-b border-violet-500/20 flex items-center gap-2 text-[11px] text-violet-300">
                <MailCheck className="w-3.5 h-3.5 shrink-0 text-violet-400" />
                <span>
                  {chatMode === "live_human"
                    ? "Messages are emailed immediately to Support. Direct email or console replies appear here live!"
                    : "AI Assistant replies instantly. Switch to Live Chat anytime to talk to a human."}
                </span>
              </div>

              {/* Guest Identity Inputs if unauthenticated */}
              {!user && (
                <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] grid grid-cols-2 gap-2 bg-[var(--bg-elevated)]/50">
                  <input
                    type="text"
                    placeholder="Your Name"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="input-field text-xs py-1.5"
                  />
                  <input
                    type="email"
                    placeholder="Your Email (for replies)"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    className="input-field text-xs py-1.5"
                  />
                </div>
              )}

              {/* Chat Message History */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3">
                {loadingThread ? (
                  <p className="text-xs text-[var(--text-muted)] text-center py-8">Connecting to support channel...</p>
                ) : (
                  (thread?.messages || []).map((msg) => {
                    const isCustomer = msg.sender_type === "user";
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isCustomer ? "items-end" : "items-start"}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
                            {msg.sender_label}
                          </span>
                          {msg.via_channel === "email_reply" && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[9px] font-medium">
                              Replied via Email
                            </span>
                          )}
                          {msg.sender_type === "ai" && (
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 text-[9px] font-medium">
                              AI Help
                            </span>
                          )}
                        </div>
                        <div
                          className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs whitespace-pre-wrap leading-relaxed ${
                            isCustomer
                              ? "bg-violet-600 text-white rounded-br-sm"
                              : "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-bl-sm"
                          }`}
                        >
                          {msg.body}
                          {msg.screenshot_data_url && (
                            <div className="mt-2 pt-2 border-t border-white/15">
                              <img
                                src={msg.screenshot_data_url}
                                alt="Attached Client Screen Capture"
                                className="rounded-lg border border-[var(--border-subtle)] max-h-40 w-auto object-cover"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Screenshot Preview Bar */}
              {screenshotDataUrl && (
                <div className="px-4 py-2 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <img
                      src={screenshotDataUrl}
                      alt="Screen Capture Preview"
                      className="w-14 h-9 rounded border border-violet-500/40 object-cover"
                    />
                    <div>
                      <p className="text-[11px] font-semibold text-[var(--text-primary)]">Screen Snapshot Attached</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Will be sent to Support with your message</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScreenshotDataUrl("")}
                    className="p-1 text-rose-400 hover:bg-rose-500/10 rounded"
                    aria-label="Remove screenshot"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Composer */}
              <form
                onSubmit={handleSendChatMessage}
                className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="instant-help-screenshot-btn"
                    onClick={handleCaptureScreenshot}
                    disabled={capturingScreen}
                    className="btn-secondary py-1.5 px-2.5 text-[11px] flex items-center gap-1.5 shrink-0"
                    title="Take Screenshot of Current Screen"
                  >
                    <Camera className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{capturingScreen ? "Capturing..." : "Take Screenshot"}</span>
                  </button>
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder={
                      chatMode === "live_human"
                        ? "Message Live Support (or attach screenshot)..."
                        : "Ask AI Help anything..."
                    }
                    className="input-field text-xs py-2 flex-1"
                  />
                  <button
                    type="submit"
                    disabled={sendingMsg || (!messageText.trim() && !screenshotDataUrl)}
                    className="btn-primary py-2 px-3 text-xs shrink-0"
                    aria-label="Send support message"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            </>
          ) : (
            /* Manual Error Submission Tab */
            <form onSubmit={handleManualErrorSubmit} className="flex-1 p-4 overflow-y-auto space-y-4">
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-[var(--text-secondary)] space-y-1">
                <p className="font-semibold text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Automatic & Manual Error Reporting</span>
                </p>
                <p className="text-[11px]">
                  Any runtime error occurring in your session is recorded automatically and emailed to the owner. You
                  can also submit an issue manually below with a live screen snapshot.
                </p>
              </div>

              {lastReportedShortId && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>
                    Incident <strong>#{lastReportedShortId}</strong> logged! Admin was emailed and a confirmation was
                    sent to your email.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Issue Summary / Title
                </label>
                <input
                  type="text"
                  required
                  value={errorTitle}
                  onChange={(e) => setErrorTitle(e.target.value)}
                  placeholder="e.g., SIM Gateway pairing code expired or SMS failed"
                  className="input-field text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Severity</label>
                <select
                  value={errorSeverity}
                  onChange={(e) => setErrorSeverity(e.target.value as "manual" | "error" | "critical")}
                  className="input-field text-xs"
                >
                  <option value="manual">General Issue / Question</option>
                  <option value="error">Functional Error</option>
                  <option value="critical">Critical Blocker</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  What happened? (Steps or Error Message)
                </label>
                <textarea
                  rows={4}
                  required
                  value={errorMessage}
                  onChange={(e) => setErrorMessage(e.target.value)}
                  placeholder="Describe the error you encountered..."
                  className="input-field text-xs"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">Screen Capture Attachment</span>
                  <button
                    type="button"
                    onClick={handleCaptureScreenshot}
                    disabled={capturingScreen}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  >
                    <Camera className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{capturingScreen ? "Capturing..." : "Capture Current Screen"}</span>
                  </button>
                </div>
                {screenshotDataUrl && (
                  <div className="relative rounded-xl overflow-hidden border border-[var(--border-subtle)]">
                    <img src={screenshotDataUrl} alt="Captured screen" className="w-full h-36 object-cover" />
                    <button
                      type="button"
                      onClick={() => setScreenshotDataUrl("")}
                      className="absolute top-2 right-2 px-2 py-1 rounded bg-black/70 text-rose-300 text-[10px]"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <button type="submit" disabled={submittingError} className="btn-primary w-full text-xs py-2.5">
                {submittingError ? "Sending Error Report..." : "Submit Error & Email Admin Immediately"}
              </button>
            </form>
          )}
        </aside>
      )}
    </>
  );
}
