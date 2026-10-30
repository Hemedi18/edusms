import React from "react";
import { FlaskConical, Smartphone, Globe } from "lucide-react";
import type { TransportType } from "../types/api";

interface TransportBadgeProps {
  transportType: TransportType | string;
  isSimulation?: boolean;
}

export function TransportBadge({ transportType, isSimulation }: TransportBadgeProps) {
  const sim = isSimulation || transportType === "simulation";
  if (sim) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35">
        <FlaskConical className="w-3.5 h-3.5 shrink-0" />
        <span>Simulated (No Real SMS)</span>
      </span>
    );
  }

  if (transportType === "external_provider") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/35">
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span>External Provider</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35">
      <Smartphone className="w-3.5 h-3.5 shrink-0" />
      <span>Android SIM Gateway</span>
    </span>
  );
}
