import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, Smartphone, CheckCircle2, Sparkles, ArrowRight } from "lucide-react";
import { Modal } from "./Modal";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { api } from "../api/client";

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState<"simulation" | "sim_gateway">(
    user?.default_execution_mode === "sim_gateway" ? "sim_gateway" : "simulation"
  );
  const [seedDemo, setSeedDemo] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleComplete = async () => {
    setSubmitting(true);
    try {
      if (selectedMode === "simulation" && seedDemo) {
        await api.post("/simulation/seed-demo/");
      }
      await updateProfile({
        onboarding_completed: true,
        default_execution_mode: selectedMode,
      });
      toast.success(
        "Workspace Ready",
        selectedMode === "simulation"
          ? "Simulation Mode configured. You can test rules, campaigns, and AI without carrier SMS charges."
          : "Redirecting to Android SIM Gateway Pairing."
      );
      onClose();
      if (selectedMode === "sim_gateway") {
        navigate("/devices");
      }
    } catch (err) {
      toast.error("Setup failed", err instanceof Error ? err.message : "Could not complete onboarding.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Welcome to EduSMS"
      subtitle="Choose how you want to start sending, receiving, and automating SMS workflows."
      maxWidthClass="max-w-2xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Remind Me Later
          </button>
          <button type="button" onClick={handleComplete} disabled={submitting} className="btn-primary">
            <span>{submitting ? "Configuring..." : "Complete Setup"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setSelectedMode("simulation")}
          className={`text-left p-4 rounded-xl border transition cursor-pointer ${
            selectedMode === "simulation"
              ? "glow-card-active border-cyan-500/60"
              : "surface-elevated hover:border-[var(--border-strong)]"
          }`}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center">
              <FlaskConical className="w-5 h-5" />
            </div>
            {selectedMode === "simulation" && <CheckCircle2 className="w-5 h-5 text-cyan-400" />}
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Simulation Sandbox Mode (Recommended First)
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
            Zero carrier charges and no phone required. Test keyword/regex auto-replies, modes, AI prompts, bulk
            campaigns, and webhooks safely with clearly labeled simulated statuses.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSelectedMode("sim_gateway")}
          className={`text-left p-4 rounded-xl border transition cursor-pointer ${
            selectedMode === "sim_gateway"
              ? "glow-card-active border-violet-500/60"
              : "surface-elevated hover:border-[var(--border-strong)]"
          }`}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center">
              <Smartphone className="w-5 h-5" />
            </div>
            {selectedMode === "sim_gateway" && <CheckCircle2 className="w-5 h-5 text-violet-400" />}
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Pair Android SIM Gateway Handset
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
            Scan a single-use QR code from the EduSMS Android app to transmit and receive real carrier SMS using your
            physical SIM card. Standard carrier SMS tariffs apply.
          </p>
        </button>
      </div>

      {selectedMode === "simulation" && (
        <label className="surface-elevated p-3.5 flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={seedDemo}
            onChange={(e) => setSeedDemo(e.target.checked)}
            className="mt-1 rounded"
          />
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span>Seed sample virtual contacts, rules & deterministic mock AI</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Creates virtual contacts (`+255754100201`), sample Opening Hours & Exam Timetable rules, and an instant
              simulated inbound message thread.
            </p>
          </div>
        </label>
      )}
    </Modal>
  );
}
