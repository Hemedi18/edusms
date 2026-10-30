import React from "react";
import {
  CheckCircle2,
  Clock,
  FlaskConical,
  HelpCircle,
  Loader2,
  Radio,
  ShieldAlert,
  XCircle,
  Ban,
} from "lucide-react";

interface StatusBadgeProps {
  status: string;
  isSimulation?: boolean;
  compact?: boolean;
}

export function getHonestStatusMeta(status: string, isSimulation = false) {
  const s = (status || "").toLowerCase();

  if (isSimulation || s.startsWith("simulated_")) {
    if (s === "failed") {
      return {
        label: "Simulated Failed (No Real SMS)",
        shortLabel: "Sim Failed",
        tone: "bg-rose-500/15 text-rose-500 dark:text-rose-400 border-rose-500/30",
        Icon: XCircle,
      };
    }
    if (s === "delivery_unknown") {
      return {
        label: "Simulated Unknown DLR (No Real SMS)",
        shortLabel: "Sim Unknown",
        tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
        Icon: HelpCircle,
      };
    }
    if (s === "pending_approval" || s === "pending_human_approval") {
      return {
        label: "Awaiting Human Review (Simulated)",
        shortLabel: "Awaiting Review",
        tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
        Icon: ShieldAlert,
      };
    }
    if (s === "simulated_received") {
      return {
        label: "Simulated Inbound (No Real SMS)",
        shortLabel: "Simulated (No Real SMS)",
        tone: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35",
        Icon: FlaskConical,
      };
    }
    if (s === "simulated_sent") {
      return {
        label: "Simulated Sent (No Real SMS)",
        shortLabel: "Simulated (No Real SMS)",
        tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35",
        Icon: FlaskConical,
      };
    }
    return {
      label: "Simulated (No Real SMS)",
      shortLabel: "Simulated (No Real SMS)",
      tone: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35",
      Icon: FlaskConical,
    };
  }

  switch (s) {
    case "queued":
      return {
        label: "Queued for Gateway",
        shortLabel: "Queued for Gateway",
        tone: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
        Icon: Clock,
      };
    case "dispatched_to_device":
      return {
        label: "Claimed by Handset",
        shortLabel: "Claimed by Handset",
        tone: "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30",
        Icon: Loader2,
      };
    case "submitted":
      return {
        label: "Accepted for Transmission (Unconfirmed Delivery)",
        shortLabel: "Accepted (Unconfirmed)",
        tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/35",
        Icon: Radio,
      };
    case "delivered":
      return {
        label: "Carrier Delivered (Confirmed)",
        shortLabel: "Carrier Delivered",
        tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35",
        Icon: CheckCircle2,
      };
    case "delivery_unknown":
      return {
        label: "Sent — Delivery Unknown",
        shortLabel: "Sent — Delivery Unknown",
        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35",
        Icon: HelpCircle,
      };
    case "received":
      return {
        label: "Received via SIM Gateway",
        shortLabel: "Received (SIM)",
        tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35",
        Icon: CheckCircle2,
      };
    case "pending_approval":
    case "pending_human_approval":
      return {
        label: "Awaiting Human Review",
        shortLabel: "Awaiting Human Review",
        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35",
        Icon: ShieldAlert,
      };
    case "failed":
      return {
        label: "Failed",
        shortLabel: "Failed",
        tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35",
        Icon: XCircle,
      };
    case "canceled":
      return {
        label: "Canceled",
        shortLabel: "Canceled",
        tone: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
        Icon: Ban,
      };
    case "expired":
      return {
        label: "Expired",
        shortLabel: "Expired",
        tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
        Icon: Clock,
      };
    default:
      return {
        label: status || "Unknown",
        shortLabel: status || "Unknown",
        tone: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
        Icon: Clock,
      };
  }
}

export function StatusBadge({ status, isSimulation = false, compact = false }: StatusBadgeProps) {
  const { label, shortLabel, tone, Icon } = getHonestStatusMeta(status, isSimulation);
  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${tone}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{compact ? shortLabel : label}</span>
    </span>
  );
}
