import React, { useCallback, useEffect, useState } from "react";
import {
  FlaskConical,
  Sparkles,
  RotateCcw,
  Send,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type { MessageRecord } from "../types/api";
import { PageHeader, GlowCard, LoadingSkeleton, EmptyState } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { Modal } from "../components/Modal";
import { useToast } from "../contexts/ToastContext";

interface InjectResult {
  inbound_message_id: string;
  decision: string;
  summary?: string;
  reply_message_id?: string | null;
  matched_rule_id?: string | null;
  ai_used?: boolean;
  [key: string]: unknown;
}

const SAMPLE_PROMPTS = [
  "Hello, what are your opening hours?",
  "When is the semester exam timetable posted?",
  "Can you explain lab assignment 2?",
  "STOP",
];

export function SimulationLabPage() {
  const toast = useToast();

  const [senderNumber, setSenderNumber] = useState("+255754100201");
  const [inboundBody, setInboundBody] = useState("Hello, what are your opening hours?");
  const [injecting, setInjecting] = useState(false);
  const [lastInjectResult, setLastInjectResult] = useState<InjectResult | null>(null);

  const [outRecipient, setOutRecipient] = useState("+255713200302");
  const [outBody, setOutBody] = useState("Reminder: CS101 practical session starts at 14:00 in Lab B.");
  const [outOutcome, setOutOutcome] = useState("simulated_delivered");
  const [sendingOut, setSendingOut] = useState(false);

  const [simMessages, setSimMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadSimFeed = useCallback(async () => {
    try {
      const res = await api.get<MessageRecord[] | { results: MessageRecord[] }>("/messages/?is_simulation=true");
      setSimMessages(unwrapList<MessageRecord>(res as MessageRecord[]));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSimFeed();
  }, [loadSimFeed]);

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      const res = await api.post<{ virtual_contacts_created: number; sample_rule: string }>("/simulation/seed-demo/");
      toast.success(
        "Demo Dataset Seeded",
        `Provisioned sample rules ("${res.sample_rule}"), virtual contacts, and Deterministic Lab Mock AI.`
      );
      await loadSimFeed();
    } catch (err) {
      toast.error("Seed failed", err instanceof Error ? err.message : "Could not seed demo data.");
    } finally {
      setSeeding(false);
    }
  };

  const handleResetSimulation = async () => {
    setResetting(true);
    try {
      const res = await api.post<{
        deleted_simulated_messages: number;
        deleted_simulated_campaigns: number;
        deleted_virtual_contacts: number;
      }>("/simulation/reset/");
      toast.info(
        "Simulation Data Reset",
        `Cleared ${res.deleted_simulated_messages} simulated messages and ${res.deleted_virtual_contacts} virtual contacts.`
      );
      setLastInjectResult(null);
      setResetConfirmOpen(false);
      await loadSimFeed();
    } catch (err) {
      toast.error("Reset failed", err instanceof Error ? err.message : "Could not reset simulation data.");
    } finally {
      setResetting(false);
    }
  };

  const handleInjectInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderNumber.trim() || !inboundBody.trim()) return;
    setInjecting(true);
    try {
      const res = await api.post<InjectResult>("/simulation/inject-inbound/", {
        sender_number: senderNumber.trim(),
        body: inboundBody.trim(),
      });
      setLastInjectResult(res);
      toast.success("Virtual Inbound SMS Injected", `Decision: ${res.decision}`);
      await loadSimFeed();
    } catch (err) {
      toast.error("Injection failed", err instanceof Error ? err.message : "Invalid simulated inbound request.");
    } finally {
      setInjecting(false);
    }
  };

  const handleSimulateOutbound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outRecipient.trim() || !outBody.trim()) return;
    setSendingOut(true);
    try {
      await api.post("/messages/", {
        recipient_number: outRecipient.trim(),
        body: outBody.trim(),
        transport_type: "simulation",
        simulated_outcome: outOutcome,
      });
      toast.success("Simulated Outbound Recorded", `Outcome: ${outOutcome} (No real SMS sent)`);
      await loadSimFeed();
    } catch (err) {
      toast.error("Simulation failed", err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSendingOut(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulation Lab"
        subtitle="Full-stack sandbox exercising real rules, schedules, opt-outs, AI providers, and webhooks with zero carrier SMS charges."
        badge={
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/35">
            <FlaskConical className="w-3.5 h-3.5" />
            <span>No Real SMS Sent</span>
          </span>
        }
        actions={
          <>
            <button type="button" onClick={handleSeedDemo} disabled={seeding} className="btn-secondary text-xs">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              <span>{seeding ? "Seeding..." : "Seed Demo Dataset"}</span>
            </button>
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              className="btn-secondary text-xs text-rose-400"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Sandbox</span>
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Inbound SMS Injector */}
        <GlowCard active>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2">
            <ArrowDownLeft className="w-4 h-4 text-cyan-400" />
            <span>Inject Virtual Inbound SMS</span>
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Simulates an incoming SMS from a virtual phone number and runs your live Automation Mode, Rules, Consent
            Keywords (`STOP`/`START`), and AI Responder.
          </p>

          <form onSubmit={handleInjectInbound} className="space-y-3.5">
            <div>
              <label htmlFor="sim-sender" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Virtual Sender Phone Number
              </label>
              <input
                id="sim-sender"
                type="text"
                value={senderNumber}
                onChange={(e) => setSenderNumber(e.target.value)}
                className="input-field font-mono"
                required
              />
            </div>

            <div>
              <label htmlFor="sim-inbound-body" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Incoming SMS Text
              </label>
              <textarea
                id="sim-inbound-body"
                rows={3}
                value={inboundBody}
                onChange={(e) => setInboundBody(e.target.value)}
                className="input-field"
                required
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SAMPLE_PROMPTS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setInboundBody(sample)}
                    className="text-[11px] px-2 py-1 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            <button type="submit" disabled={injecting} className="btn-primary w-full text-xs">
              <FlaskConical className="w-4 h-4" />
              <span>{injecting ? "Evaluating Pipeline..." : "Inject Inbound SMS & Evaluate Auto-Reply"}</span>
            </button>
          </form>

          {lastInjectResult && (
            <div className="mt-4 p-3.5 surface-elevated space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Evaluation Decision: {lastInjectResult.decision}</span>
                </span>
                {lastInjectResult.reply_message_id && (
                  <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-medium">
                    Auto-Reply Generated
                  </span>
                )}
              </div>
              {lastInjectResult.summary && (
                <p className="text-[var(--text-secondary)]">{String(lastInjectResult.summary)}</p>
              )}
            </div>
          )}
        </GlowCard>

        {/* Outbound Outcome Tester */}
        <div className="surface-card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-violet-400" />
            <span>Test Outbound Delivery & Failure Scenarios</span>
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Verify how your webhooks, retries, and dashboards handle missing carrier DLRs or radio failures without
            burning real SMS credits.
          </p>

          <form onSubmit={handleSimulateOutbound} className="space-y-3.5">
            <div>
              <label htmlFor="sim-out-recipient" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Virtual Recipient Number
              </label>
              <input
                id="sim-out-recipient"
                type="text"
                value={outRecipient}
                onChange={(e) => setOutRecipient(e.target.value)}
                className="input-field font-mono"
                required
              />
            </div>

            <div>
              <label htmlFor="sim-out-outcome" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Simulated Outcome to Trigger
              </label>
              <select
                id="sim-out-outcome"
                value={outOutcome}
                onChange={(e) => setOutOutcome(e.target.value)}
                className="input-field"
              >
                <option value="simulated_delivered">Simulated Delivered (Happy Path)</option>
                <option value="simulated_sent">Simulated Sent (No DLR Yet)</option>
                <option value="delivery_unknown">Delivery Unknown (Carrier Omitted DLR)</option>
                <option value="failed">Simulated Transmission Failure</option>
              </select>
            </div>

            <div>
              <label htmlFor="sim-out-body" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Outbound Message Body
              </label>
              <textarea
                id="sim-out-body"
                rows={3}
                value={outBody}
                onChange={(e) => setOutBody(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <button type="submit" disabled={sendingOut} className="btn-secondary w-full text-xs">
              <Send className="w-4 h-4 text-violet-400" />
              <span>{sendingOut ? "Simulating..." : "Run Outbound Simulation"}</span>
            </button>
          </form>
        </div>
      </div>

      {/* Live Simulated Transcript */}
      <div className="surface-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Simulated SMS Stream</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Every record below is tagged `is_simulation: true` and isolated from carrier metrics.
            </p>
          </div>
          <span className="text-xs text-[var(--text-muted)]">{simMessages.length} events</span>
        </div>

        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : simMessages.length === 0 ? (
          <EmptyState
            title="Sandbox is clean"
            description="Click 'Seed Demo Dataset' or inject an inbound SMS above to watch the auto-responder in action."
            icon={FlaskConical}
            action={
              <button type="button" onClick={handleSeedDemo} className="btn-primary text-xs">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Seed Demo Dataset</span>
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {simMessages.slice(0, 30).map((m) => (
              <div key={m.id} className="surface-elevated p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-semibold">
                      {m.direction === "inbound"
                        ? `${m.sender_number} → Simulator`
                        : `Simulator → ${m.recipient_number}`}
                    </span>
                    {m.is_auto_reply && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-400 font-medium">
                        {m.ai_generated ? "AI Reply" : "Auto-Reply"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-primary)]">{m.body}</p>
                  {m.matched_policy_summary && (
                    <p className="text-[11px] text-[var(--text-muted)]">{m.matched_policy_summary}</p>
                  )}
                </div>
                <div className="shrink-0">
                  <StatusBadge status={m.status} isSimulation compact />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        title="Reset Simulation Sandbox Data?"
        subtitle="Real contacts, paired devices, and real SMS history are NOT touched."
        footer={
          <>
            <button type="button" onClick={() => setResetConfirmOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={handleResetSimulation} disabled={resetting} className="btn-danger">
              <span>{resetting ? "Resetting..." : "Reset Simulation Data"}</span>
            </button>
          </>
        }
      >
        <div className="flex items-start gap-3 text-xs text-[var(--text-secondary)]">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
          <p>
            This permanently deletes all simulated messages (`is_simulation=true`), simulated campaigns, and virtual
            test contacts (`is_virtual=true`) in your workspace so you can start a fresh test run.
          </p>
        </div>
      </Modal>
    </div>
  );
}
