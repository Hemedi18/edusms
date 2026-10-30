import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Send,
  Search,
  CheckCircle2,
  Ban,
  AlertTriangle,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Info,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type { DeviceRecord, MessageRecord, SenderIdentityConfig, TransportType } from "../types/api";
import { PageHeader, LoadingSkeleton, EmptyState, ErrorState } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { TransportBadge } from "../components/TransportBadge";
import { Modal } from "../components/Modal";
import { useToast } from "../contexts/ToastContext";
import { useRealtimeEvent } from "../contexts/RealtimeContext";

export function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const [tab, setTab] = useState<"all" | "approval" | "real" | "simulated">(
    () => (searchParams.get("tab") as "all" | "approval" | "real" | "simulated") || "all"
  );
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"" | "inbound" | "outbound">("");
  const [statusFilter, setStatusFilter] = useState("");
  const [transportFilter, setTransportFilter] = useState("");

  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [identities, setIdentities] = useState<SenderIdentityConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(() => searchParams.get("compose") === "1");
  const [selectedMsg, setSelectedMsg] = useState<MessageRecord | null>(null);
  const [statusExplain, setStatusExplain] = useState<string>("");

  // Compose state
  const [recipient, setRecipient] = useState("+255754100201");
  const [body, setBody] = useState("");
  const [transportType, setTransportType] = useState<TransportType>("simulation");
  const [deviceId, setDeviceId] = useState("");
  const [simSlot, setSimSlot] = useState<number>(0);
  const [senderIdentityId, setSenderIdentityId] = useState("");
  const [simulatedOutcome, setSimulatedOutcome] = useState("simulated_delivered");
  const [ttlMinutes, setTtlMinutes] = useState(120);
  const [sending, setSending] = useState(false);

  const loadMessages = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams();
    if (search.trim()) qs.set("search", search.trim());
    if (direction) qs.set("direction", direction);
    if (statusFilter) qs.set("status", statusFilter);
    if (transportFilter) qs.set("transport_type", transportFilter);
    if (tab === "approval") qs.set("status", "pending_approval");
    if (tab === "real") qs.set("is_simulation", "false");
    if (tab === "simulated") qs.set("is_simulation", "true");

    try {
      const [msgRes, devRes, idRes] = await Promise.all([
        api.get<MessageRecord[] | { results: MessageRecord[] }>(`/messages/?${qs.toString()}`),
        api.get<DeviceRecord[] | { results: DeviceRecord[] }>("/devices/").catch(() => []),
        api.get<SenderIdentityConfig[] | { results: SenderIdentityConfig[] }>("/sender-identities/").catch(() => []),
      ]);
      const list = unwrapList<MessageRecord>(msgRes as MessageRecord[]);
      setMessages(list);
      const devs = unwrapList<DeviceRecord>(devRes as DeviceRecord[]);
      setDevices(devs);
      if (!deviceId && devs.length > 0) setDeviceId(devs[0].id);
      const ids = unwrapList<SenderIdentityConfig>(idRes as SenderIdentityConfig[]);
      setIdentities(ids);
      if (!senderIdentityId && ids.length > 0) setSenderIdentityId(ids[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages.");
    } finally {
      setLoading(false);
    }
  }, [search, direction, statusFilter, transportFilter, tab, deviceId, senderIdentityId]);

  useEffect(() => {
    setLoading(true);
    void loadMessages();
  }, [loadMessages]);

  useRealtimeEvent(["message.updated"], () => {
    void loadMessages();
  });

  const openDetail = async (msg: MessageRecord) => {
    setSelectedMsg(msg);
    setStatusExplain("");
    try {
      const [fresh, st] = await Promise.all([
        api.get<MessageRecord>(`/messages/${msg.id}/`),
        api.get<{ status_explanation: string }>(`/messages/${msg.id}/status/`),
      ]);
      setSelectedMsg(fresh);
      setStatusExplain(st.status_explanation);
    } catch {
      // fallback to list item
    }
  };

  const handleComposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient.trim() || !body.trim()) {
      toast.warning("Missing fields", "Enter both recipient phone number and SMS body.");
      return;
    }
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        recipient_number: recipient.trim(),
        body: body.trim(),
        transport_type: transportType,
        ttl_minutes: ttlMinutes,
      };
      if (transportType === "simulation") {
        payload.simulated_outcome = simulatedOutcome;
      } else if (transportType === "sim_gateway") {
        if (deviceId) payload.device_id = deviceId;
        payload.sim_slot = simSlot;
      } else if (transportType === "external_provider" && senderIdentityId) {
        payload.sender_identity_id = senderIdentityId;
      }

      const created = await api.post<MessageRecord>("/messages/", payload);
      toast.success(
        created.is_simulation ? "Simulated SMS Recorded" : "Outbound SMS Submitted",
        created.is_simulation
          ? "No real carrier SMS was sent."
          : `Current status: ${created.status}`
      );
      setBody("");
      setComposeOpen(false);
      setSearchParams({});
      await loadMessages();
    } catch (err) {
      toast.error("Failed to send message", err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSending(false);
    }
  };

  const handleCancelMessage = async (msgId: string) => {
    try {
      const updated = await api.post<MessageRecord>(`/messages/${msgId}/cancel/`);
      toast.success("Message Canceled", "Message was halted before handset transmission.");
      setSelectedMsg(updated);
      await loadMessages();
    } catch (err) {
      toast.error("Cannot cancel message", err instanceof Error ? err.message : "Cancel failed.");
    }
  };

  const handleApproveReply = async (msgId: string) => {
    try {
      const updated = await api.post<MessageRecord>(`/messages/${msgId}/approve-reply/`);
      toast.success("Reply Approved", "Automated reply has been approved for dispatch.");
      setSelectedMsg(updated);
      await loadMessages();
    } catch (err) {
      toast.error("Approval failed", err instanceof Error ? err.message : "Could not approve reply.");
    }
  };

  const smsSegments = Math.max(1, Math.ceil((body.length || 1) / 160));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages & Human Approval Queue"
        subtitle="Inspect inbound/outbound SMS, delivery timelines, and pending auto-replies."
        actions={
          <>
            <button type="button" onClick={loadMessages} className="btn-secondary text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <button type="button" onClick={() => setComposeOpen(true)} className="btn-primary text-xs">
              <Send className="w-3.5 h-3.5" />
              <span>Compose SMS</span>
            </button>
          </>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        {(
          [
            { id: "all", label: "All Messages" },
            { id: "approval", label: "Human Approval Queue" },
            { id: "real", label: "Real Carrier Traffic" },
            { id: "simulated", label: "Simulation Sandbox" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer ${
              tab === t.id
                ? "bg-violet-600 text-white border-violet-500"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="surface-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-2.5" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, body, policy..."
            aria-label="Search messages"
            className="input-field pl-9"
          />
        </div>
        <select
          aria-label="Filter by direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value as "" | "inbound" | "outbound")}
          className="input-field"
        >
          <option value="">All Directions</option>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field"
        >
          <option value="">All Statuses</option>
          <option value="pending_approval">Awaiting Human Review</option>
          <option value="queued">Queued for Gateway</option>
          <option value="dispatched_to_device">Claimed by Handset</option>
          <option value="submitted">Accepted (Unconfirmed Delivery)</option>
          <option value="delivered">Carrier Delivered (Confirmed)</option>
          <option value="delivery_unknown">Sent — Delivery Unknown</option>
          <option value="simulated_delivered">Simulated Delivered</option>
          <option value="failed">Failed</option>
          <option value="canceled">Canceled</option>
        </select>
        <select
          aria-label="Filter by transport"
          value={transportFilter}
          onChange={(e) => setTransportFilter(e.target.value)}
          className="input-field"
        >
          <option value="">All Transports</option>
          <option value="simulation">Simulation Sandbox</option>
          <option value="sim_gateway">Android SIM Gateway</option>
          <option value="external_provider">External SMS Provider</option>
        </select>
      </div>

      {/* Message List */}
      {loading ? (
        <LoadingSkeleton rows={5} label="Loading messages" />
      ) : error ? (
        <ErrorState message={error} onRetry={loadMessages} />
      ) : messages.length === 0 ? (
        <EmptyState
          title="No messages match your filters"
          description="Compose a simulated or real SMS, or visit Simulation Lab to inject sample inbound student queries."
          action={
            <button type="button" onClick={() => setComposeOpen(true)} className="btn-primary text-xs">
              <Send className="w-3.5 h-3.5" />
              <span>Compose First SMS</span>
            </button>
          }
        />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-elevated)]">
                  <th className="py-3 px-4">Direction & Party</th>
                  <th className="py-3 px-4">Message Preview</th>
                  <th className="py-3 px-4">Transport</th>
                  <th className="py-3 px-4">Honest Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                {messages.map((msg) => (
                  <tr
                    key={msg.id}
                    onClick={() => void openDetail(msg)}
                    className="hover:bg-[var(--bg-elevated)]/60 cursor-pointer transition"
                  >
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {msg.direction === "inbound" ? (
                          <ArrowDownLeft className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 text-violet-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                            {msg.direction === "inbound" ? msg.sender_number : msg.recipient_number}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {msg.contact_name || (msg.direction === "inbound" ? "Inbound" : "Outbound")} ·{" "}
                            {new Date(msg.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      <p className="text-xs text-[var(--text-primary)] truncate">{msg.body}</p>
                      {(msg.is_auto_reply || msg.ai_generated) && (
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium">
                          {msg.ai_generated ? "AI Auto-Reply" : "Rule Auto-Reply"}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <TransportBadge transportType={msg.transport_type} isSimulation={msg.is_simulation} />
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StatusBadge status={msg.status} isSimulation={msg.is_simulation} compact />
                    </td>
                    <td
                      className="py-3.5 px-4 whitespace-nowrap text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        {msg.status === "pending_approval" && (
                          <button
                            type="button"
                            onClick={() => void handleApproveReply(msg.id)}
                            className="btn-primary text-xs py-1 px-2.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                        )}
                        {(msg.status === "queued" || msg.status === "pending_approval") && (
                          <button
                            type="button"
                            onClick={() => void handleCancelMessage(msg.id)}
                            className="btn-secondary text-xs py-1 px-2.5 text-rose-400"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Compose SMS Modal */}
      <Modal
        open={composeOpen}
        onClose={() => {
          setComposeOpen(false);
          setSearchParams({});
        }}
        title="Compose Outbound SMS"
        subtitle="Explicitly select Simulation Sandbox or a physical/registered carrier transport."
        footer={
          <>
            <button type="button" onClick={() => setComposeOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="compose-sms-form" disabled={sending} className="btn-primary">
              <Send className="w-4 h-4" />
              <span>
                {sending
                  ? "Submitting..."
                  : transportType === "simulation"
                    ? "Send in Simulation Mode"
                    : "Queue Real SMS"}
              </span>
            </button>
          </>
        }
      >
        <form id="compose-sms-form" onSubmit={handleComposeSubmit} className="space-y-4">
          <div>
            <label htmlFor="compose-transport" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Execution Transport
            </label>
            <select
              id="compose-transport"
              value={transportType}
              onChange={(e) => setTransportType(e.target.value as TransportType)}
              className="input-field"
            >
              <option value="simulation">Simulation Sandbox — Free, No Real Carrier SMS</option>
              <option value="sim_gateway">Android SIM Gateway — Real Carrier SMS via Paired Phone</option>
              <option value="external_provider">External SMS Provider — Registered Sender ID</option>
            </select>
          </div>

          {transportType === "sim_gateway" && (
            <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-500/35 text-xs space-y-2">
              <div className="flex items-start gap-2 text-amber-600 dark:text-amber-300 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Real Physical SIM Carrier SMS Disclosure</span>
              </div>
              <p className="text-[var(--text-secondary)]">
                This message will be transmitted over the cellular network from your paired Android SIM card’s native
                carrier number. Standard carrier SMS charges/bundle deductions apply.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Android Gateway</label>
                  <select
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    className="input-field text-xs"
                  >
                    <option value="">Auto-select active device</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.is_online ? "Online" : "Offline"})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-secondary)] mb-1">SIM Slot</label>
                  <select
                    value={simSlot}
                    onChange={(e) => setSimSlot(Number(e.target.value))}
                    className="input-field text-xs"
                  >
                    <option value={0}>SIM Slot 1 (Index 0)</option>
                    <option value={1}>SIM Slot 2 (Index 1)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {transportType === "external_provider" && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Registered External Provider Identity
              </label>
              <select
                value={senderIdentityId}
                onChange={(e) => setSenderIdentityId(e.target.value)}
                className="input-field"
              >
                <option value="">Select configured provider identity...</option>
                {identities
                  .filter((i) => i.identity_type === "external_provider")
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label} ({i.alphanumeric_sender_id || i.provider_name})
                    </option>
                  ))}
              </select>
            </div>
          )}

          {transportType === "simulation" && (
            <div>
              <label htmlFor="compose-sim-outcome" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Simulated Sandbox Outcome
              </label>
              <select
                id="compose-sim-outcome"
                value={simulatedOutcome}
                onChange={(e) => setSimulatedOutcome(e.target.value)}
                className="input-field"
              >
                <option value="simulated_delivered">Simulated Delivered (No Real SMS)</option>
                <option value="simulated_sent">Simulated Sent Only</option>
                <option value="delivery_unknown">Simulated Missing Carrier DLR (Delivery Unknown)</option>
                <option value="failed">Simulated Radio/Carrier Failure</option>
              </select>
            </div>
          )}

          <div>
            <label htmlFor="compose-recipient" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Recipient Phone Number (E.164 or local e.g. 0754...)
            </label>
            <input
              id="compose-recipient"
              type="tel"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="+255754100201"
              className="input-field font-mono"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="compose-body" className="text-xs font-medium text-[var(--text-secondary)]">
                SMS Message Body
              </label>
              <span className="text-[11px] text-[var(--text-muted)]">
                {body.length} chars · ~{smsSegments} SMS {smsSegments === 1 ? "segment" : "segments"}
              </span>
            </div>
            <textarea
              id="compose-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your SMS text..."
              className="input-field"
              required
            />
          </div>

          <div>
            <label htmlFor="compose-ttl" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Queue Expiry TTL (minutes — prevents stale late SMS if phone is offline)
            </label>
            <input
              id="compose-ttl"
              type="number"
              min={5}
              max={10080}
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(Number(e.target.value))}
              className="input-field w-40"
            />
          </div>
        </form>
      </Modal>

      {/* Message Detail Inspector Modal */}
      <Modal
        open={Boolean(selectedMsg)}
        onClose={() => setSelectedMsg(null)}
        title="Message Delivery & Policy Inspector"
        subtitle={selectedMsg ? `ID: ${selectedMsg.id}` : undefined}
        maxWidthClass="max-w-2xl"
        footer={
          selectedMsg && (
            <>
              {selectedMsg.status === "pending_approval" && (
                <button
                  type="button"
                  onClick={() => void handleApproveReply(selectedMsg.id)}
                  className="btn-primary text-xs"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Approve & Dispatch Reply</span>
                </button>
              )}
              {(selectedMsg.status === "queued" || selectedMsg.status === "pending_approval") && (
                <button
                  type="button"
                  onClick={() => void handleCancelMessage(selectedMsg.id)}
                  className="btn-danger text-xs"
                >
                  <Ban className="w-4 h-4" />
                  <span>Cancel Before Transmission</span>
                </button>
              )}
              <button type="button" onClick={() => setSelectedMsg(null)} className="btn-secondary text-xs">
                Close
              </button>
            </>
          )
        }
      >
        {selectedMsg && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <TransportBadge transportType={selectedMsg.transport_type} isSimulation={selectedMsg.is_simulation} />
              <StatusBadge status={selectedMsg.status} isSimulation={selectedMsg.is_simulation} />
            </div>

            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div className="text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Honest Status Explanation: </strong>
                {statusExplain ||
                  (selectedMsg.is_simulation
                    ? "Simulated sandbox execution — no real carrier SMS was transmitted."
                    : selectedMsg.status === "submitted"
                      ? "Accepted by Android handset/provider for radio transmission, but carrier delivery confirmation (DLR) has NOT arrived yet."
                      : selectedMsg.status === "delivered"
                        ? "Confirmed delivered by cellular carrier delivery receipt."
                        : `Current lifecycle status: ${selectedMsg.status}`)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs surface-elevated p-3.5">
              <div>
                <span className="text-[var(--text-muted)]">Sender:</span>
                <div className="font-mono font-semibold mt-0.5">{selectedMsg.sender_number || "—"}</div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Recipient:</span>
                <div className="font-mono font-semibold mt-0.5">{selectedMsg.recipient_number || "—"}</div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Created:</span>
                <div className="mt-0.5">{new Date(selectedMsg.created_at).toLocaleString()}</div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Policy / Trigger Summary:</span>
                <div className="mt-0.5">{selectedMsg.matched_policy_summary || "Direct manual/API message"}</div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Message Body</div>
              <div className="surface-elevated p-3.5 text-sm whitespace-pre-wrap">{selectedMsg.body}</div>
            </div>

            {selectedMsg.failure_reason && (
              <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/35 text-xs text-rose-400">
                <strong>Failure ({selectedMsg.failure_code || "ERROR"}):</strong> {selectedMsg.failure_reason}
              </div>
            )}

            {/* Attempts */}
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                Transmission Attempts ({selectedMsg.attempts?.length || 0})
              </h3>
              {!selectedMsg.attempts || selectedMsg.attempts.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No gateway attempts recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {selectedMsg.attempts.map((att) => (
                    <div key={att.id} className="surface-elevated p-2.5 text-xs flex items-center justify-between">
                      <div>
                        <span className="font-semibold">Attempt #{att.attempt_number}</span> · {att.transport_type}
                        {att.sim_slot !== null && ` (SIM #${att.sim_slot + 1})`}
                        {att.error_detail && <div className="text-rose-400 mt-0.5">{att.error_detail}</div>}
                      </div>
                      <span className="font-mono px-2 py-0.5 rounded bg-[var(--bg-surface)]">{att.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delivery Events Timeline */}
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                Delivery Events Timeline ({selectedMsg.delivery_events?.length || 0})
              </h3>
              {!selectedMsg.delivery_events || selectedMsg.delivery_events.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No delivery events logged yet.</p>
              ) : (
                <div className="space-y-2">
                  {selectedMsg.delivery_events.map((ev) => (
                    <div key={ev.id} className="surface-elevated p-2.5 text-xs flex items-start gap-2.5">
                      <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase text-[11px]">{ev.event_type}</span>
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {new Date(ev.occurred_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-[var(--text-secondary)] mt-0.5">{ev.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
