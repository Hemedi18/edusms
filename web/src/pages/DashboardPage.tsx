import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  FlaskConical,
  MessageSquarePlus,
  Smartphone,
  Sparkles,
  Users,
  ArrowUpRight,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type { AnalyticsOverview, AutomationModeRecord } from "../types/api";
import { GlowCard, PageHeader, LoadingSkeleton, ErrorState } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../contexts/ToastContext";
import { useRealtimeEvent } from "../contexts/RealtimeContext";

function TrafficTimeseriesChart({
  data,
}: {
  data: AnalyticsOverview["timeseries"];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-xs text-[var(--text-muted)]">
        No time-series activity recorded in this window yet.
      </div>
    );
  }

  const width = 760;
  const height = 220;
  const padLeft = 36;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(
    4,
    ...data.flatMap((d) => [d.real_outbound, d.real_inbound, d.sim_outbound, d.sim_inbound])
  );

  const xAt = (idx: number) =>
    data.length === 1 ? padLeft + plotW / 2 : padLeft + (idx / (data.length - 1)) * plotW;
  const yAt = (val: number) => padTop + plotH - (val / maxVal) * plotH;

  const buildPath = (selector: (d: AnalyticsOverview["timeseries"][number]) => number) =>
    data
      .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx).toFixed(1)} ${yAt(selector(pt)).toFixed(1)}`)
      .join(" ");

  const series = [
    { key: "real_outbound", label: "Real Outbound (SIM/Provider)", color: "#7C3AED", fn: (d: AnalyticsOverview["timeseries"][number]) => d.real_outbound },
    { key: "real_inbound", label: "Real Inbound (SIM)", color: "#10B981", fn: (d: AnalyticsOverview["timeseries"][number]) => d.real_inbound },
    { key: "sim_outbound", label: "Simulated Outbound", color: "#06B6D4", fn: (d: AnalyticsOverview["timeseries"][number]) => d.sim_outbound },
    { key: "sim_inbound", label: "Simulated Inbound", color: "#3B82F6", fn: (d: AnalyticsOverview["timeseries"][number]) => d.sim_inbound },
  ];

  const activePoint = hoverIdx !== null ? data[hoverIdx] : data[data.length - 1];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
        {activePoint && (
          <div className="text-xs text-[var(--text-secondary)] font-mono">
            {activePoint.date}: Real Out {activePoint.real_outbound} · Real In {activePoint.real_inbound} · Sim Out{" "}
            {activePoint.sim_outbound} · Sim In {activePoint.sim_inbound}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily real and simulated SMS volume chart"
        className="w-full h-56 overflow-visible"
      >
        {[0, 0.5, 1].map((frac) => {
          const y = padTop + plotH * (1 - frac);
          const tickVal = Math.round(maxVal * frac);
          return (
            <g key={frac}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="currentColor"
                className="text-slate-500/20"
                strokeDasharray="3 3"
              />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
                {tickVal}
              </text>
            </g>
          );
        })}

        {series.map((s) => (
          <path
            key={s.key}
            d={buildPath(s.fn)}
            fill="none"
            stroke={s.color}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {data.map((pt, idx) => {
          const x = xAt(idx);
          const showLabel = idx === 0 || idx === data.length - 1 || idx === Math.floor(data.length / 2);
          return (
            <g key={pt.date}>
              {showLabel && (
                <text x={x} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {pt.date.slice(5)}
                </text>
              )}
              <rect
                x={x - plotW / Math.max(2, data.length * 2)}
                y={padTop}
                width={plotW / Math.max(1, data.length)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [days, setDays] = useState(14);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [modes, setModes] = useState<AutomationModeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switchingModeId, setSwitchingModeId] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setError(null);
    try {
      const [ov, modesResp] = await Promise.all([
        api.get<AnalyticsOverview>(`/analytics/overview/?days=${days}`),
        api.get<AutomationModeRecord[] | { results: AutomationModeRecord[] }>("/automation/modes/").catch(() => []),
      ]);
      setOverview(ov);
      setModes(unwrapList<AutomationModeRecord>(modesResp as AutomationModeRecord[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard overview.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    setLoading(true);
    void loadDashboard();
  }, [loadDashboard]);

  useRealtimeEvent(["message.updated", "device.status", "automation.mode_changed"], () => {
    void loadDashboard();
  });

  const handleActivateMode = async (mode: AutomationModeRecord) => {
    setSwitchingModeId(mode.id);
    try {
      await api.post(`/automation/modes/${mode.id}/activate/`);
      toast.success("Automation Mode Activated", `Active mode switched to ${mode.name}.`);
      await loadDashboard();
    } catch (err) {
      toast.error("Failed to switch mode", err instanceof Error ? err.message : "Could not activate mode.");
    } finally {
      setSwitchingModeId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Platform Overview" subtitle="Real-time telemetry across SIM gateways, automation, and Simulation Lab." />
        <LoadingSkeleton rows={5} label="Loading analytics overview" />
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="space-y-6">
        <PageHeader title="Platform Overview" />
        <ErrorState message={error || "Analytics unavailable"} onRetry={loadDashboard} />
      </div>
    );
  }

  const m = overview.message_summary;
  const g = overview.gateway_summary;
  const c = overview.contacts_summary;
  const a = overview.automation_summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Overview"
        subtitle="Strict separation between confirmed physical SIM traffic and Simulation Mode testing."
        actions={
          <>
            <div className="inline-flex rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium cursor-pointer ${
                    days === d
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button type="button" onClick={() => navigate("/simulation")} className="btn-secondary text-xs">
              <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
              <span>Simulation Lab</span>
            </button>
            <button type="button" onClick={() => navigate("/messages?compose=1")} className="btn-primary text-xs">
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Compose SMS</span>
            </button>
          </>
        }
      />

      {/* Pending Human Approval Alert Banner */}
      {m.pending_human_approval > 0 && (
        <div
          role="region"
          aria-label="Pending human approval alert"
          className="surface-card p-4 border-amber-500/45 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {m.pending_human_approval} Automated {m.pending_human_approval === 1 ? "Reply" : "Replies"} Awaiting Human Review
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Held safely in queue because rule or mode policy requires explicit human approval before transmission.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/messages?tab=approval")}
            className="btn-primary text-xs shrink-0"
          >
            <span>Review Approval Queue</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GlowCard active={g.online_devices > 0}>
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Real Carrier SMS ({days}d)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {m.real_outbound_delivered_confirmed}
            </span>
            <span className="text-xs text-emerald-500 dark:text-emerald-400 font-medium">Confirmed Delivered</span>
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
            <span>Submitted: {m.real_outbound_submitted}</span>
            <span>Queued: {m.real_outbound_queued}</span>
            <span>Failed: {m.real_outbound_failed}</span>
          </div>
        </GlowCard>

        <GlowCard>
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Simulation Sandbox ({days}d)</span>
            <FlaskConical className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {m.simulated_outbound + m.simulated_inbound}
            </span>
            <span className="text-xs text-cyan-500 dark:text-cyan-300 font-medium">No Real SMS Sent</span>
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)] flex gap-3">
            <span>Sim Out: {m.simulated_outbound}</span>
            <span>Sim In: {m.simulated_inbound}</span>
          </div>
        </GlowCard>

        <GlowCard>
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Contacts & Consent</span>
            <Users className="w-4 h-4 text-violet-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">{c.opted_in_contacts}</span>
            <span className="text-xs text-[var(--text-secondary)]">opted-in of {c.total_contacts}</span>
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)] flex gap-3">
            <span>Groups: {c.groups_count}</span>
            <span>Suppressed: {c.suppressed_or_opted_out}</span>
          </div>
        </GlowCard>

        <GlowCard>
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Automation & AI</span>
            <Bot className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">{a.auto_replies_sent}</span>
            <span className="text-xs text-[var(--text-secondary)]">auto-replies ({a.active_mode})</span>
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)] flex gap-3">
            <span>Active Rules: {a.enabled_rules_count}</span>
            <span>AI Calls: {a.ai_calls_count}</span>
          </div>
        </GlowCard>
      </div>

      {/* Chart + Gateway Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 surface-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Message Volume — Real Carrier vs Simulation
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Daily inbound and outbound breakdown over the past {overview.window_days} days
              </p>
            </div>
            <Activity className="w-4 h-4 text-violet-400" />
          </div>
          <TrafficTimeseriesChart data={overview.timeseries} />
        </div>

        <div className="space-y-4">
          {/* Gateway Health Card */}
          <GlowCard active={g.sim_ready_devices > 0}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-violet-400" />
                <span>Android SIM Gateway Health</span>
              </h2>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  g.online_devices > 0
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-slate-500/15 text-[var(--text-muted)]"
                }`}
              >
                {g.online_devices > 0 ? "Online" : "No Handset Online"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 my-3 text-center">
              <div className="surface-elevated p-2">
                <div className="text-lg font-bold">{g.paired_devices}</div>
                <div className="text-[11px] text-[var(--text-muted)]">Paired</div>
              </div>
              <div className="surface-elevated p-2">
                <div className="text-lg font-bold text-emerald-400">{g.online_devices}</div>
                <div className="text-[11px] text-[var(--text-muted)]">Online</div>
              </div>
              <div className="surface-elevated p-2">
                <div className="text-lg font-bold text-cyan-400">{g.sim_ready_devices}</div>
                <div className="text-[11px] text-[var(--text-muted)]">SIM Ready</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/devices")}
              className="btn-secondary w-full text-xs"
            >
              {g.paired_devices === 0 ? "Pair Android Phone via QR" : "Manage Paired Gateways"}
            </button>
          </GlowCard>

          {/* Active Automation Mode Quick-Switcher */}
          <div className="surface-card p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Quick Automation Mode</span>
              </h2>
              <span className="text-[11px] text-[var(--text-muted)]">
                {a.global_automation_enabled ? "Enabled" : "Master Off"}
              </span>
            </div>
            {modes.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No modes configured yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {modes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    disabled={switchingModeId === mode.id}
                    onClick={() => handleActivateMode(mode)}
                    aria-pressed={mode.is_active}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                      mode.is_active
                        ? "bg-violet-600 text-white border-violet-500 shadow-sm"
                        : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {mode.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Honest Status Breakdown & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="surface-card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            Honest Delivery & Execution Status Breakdown
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            “Submitted” means accepted by handset/provider; “Carrier Delivered” requires an explicit carrier DLR.
          </p>
          {overview.status_breakdown.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-4">
              No messages sent or simulated in the selected window.
            </p>
          ) : (
            <div className="space-y-2.5">
              {overview.status_breakdown.map((row, idx) => (
                <div
                  key={`${row.status}-${row.is_simulation}-${idx}`}
                  className="flex items-center justify-between p-2.5 surface-elevated"
                >
                  <StatusBadge status={row.status} isSimulation={row.is_simulation} />
                  <span className="text-sm font-semibold font-mono text-[var(--text-primary)]">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="surface-card p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Platform Quick Actions</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              Jump directly to common operational & developer testing workflows.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => navigate("/simulation")}
                className="surface-elevated p-3.5 text-left hover:border-cyan-500/45 transition cursor-pointer"
              >
                <div className="text-xs font-semibold text-[var(--text-primary)]">Inject Simulated Inbound SMS</div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Test auto-reply rules & AI in Simulation Lab
                </div>
              </button>
              <button
                type="button"
                onClick={() => navigate("/campaigns")}
                className="surface-elevated p-3.5 text-left hover:border-violet-500/45 transition cursor-pointer"
              >
                <div className="text-xs font-semibold text-[var(--text-primary)]">Launch Bulk Campaign</div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Preview opt-outs, duplicates & throttling
                </div>
              </button>
              <button
                type="button"
                onClick={() => navigate("/contacts")}
                className="surface-elevated p-3.5 text-left hover:border-violet-500/45 transition cursor-pointer"
              >
                <div className="text-xs font-semibold text-[var(--text-primary)]">Import Contacts CSV</div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Normalize +255 numbers & manage consent
                </div>
              </button>
              <button
                type="button"
                onClick={() => navigate("/developers")}
                className="surface-elevated p-3.5 text-left hover:border-blue-500/45 transition cursor-pointer"
              >
                <div className="text-xs font-semibold text-[var(--text-primary)]">Create Scoped API Key</div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Configure HMAC webhooks & REST integrations
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
