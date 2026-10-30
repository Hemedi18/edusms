import React, { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Smartphone,
  QrCode,
  Pause,
  Play,
  ShieldOff,
  BatteryCharging,
  Battery,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type { DeviceRecord, PairingInitResponse } from "../types/api";
import { PageHeader, GlowCard, LoadingSkeleton, EmptyState, ErrorState } from "../components/States";
import { Modal } from "../components/Modal";
import { useToast } from "../contexts/ToastContext";
import { useRealtimeEvent } from "../contexts/RealtimeContext";

export function DevicesPage() {
  const toast = useToast();

  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pairing Modal State
  const [pairOpen, setPairOpen] = useState(false);
  const [deviceNameHint, setDeviceNameHint] = useState("Campus Lab Galaxy S24");
  const [pairingSession, setPairingSession] = useState<PairingInitResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [initiating, setInitiating] = useState(false);
  const [confirmingSimHandset, setConfirmingSimHandset] = useState(false);

  // Revoke confirmation
  const [revokeTarget, setRevokeTarget] = useState<DeviceRecord | null>(null);

  const loadDevices = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<DeviceRecord[] | { results: DeviceRecord[] }>(
        `/devices/${includeRevoked ? "?include_revoked=true" : ""}`
      );
      setDevices(unwrapList<DeviceRecord>(res as DeviceRecord[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load paired gateway devices.");
    } finally {
      setLoading(false);
    }
  }, [includeRevoked]);

  useEffect(() => {
    setLoading(true);
    void loadDevices();
  }, [loadDevices]);

  useRealtimeEvent(["device.status"], () => {
    void loadDevices();
  });

  // Countdown timer for active pairing session
  useEffect(() => {
    if (!pairingSession) return;
    setSecondsLeft(pairingSession.ttl_seconds);
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pairingSession]);

  const handleInitPairing = async (e: React.FormEvent) => {
    e.preventDefault();
    setInitiating(true);
    try {
      const res = await api.post<PairingInitResponse>("/devices/pair/init/", {
        device_name: deviceNameHint.trim() || "Android SIM Gateway",
      });
      setPairingSession(res);
      toast.success("Single-Use Pairing Code Created", `Code ${res.pairing_code} expires in ${Math.round(res.ttl_seconds / 60)} min.`);
    } catch (err) {
      toast.error("Pairing failed", err instanceof Error ? err.message : "Could not initiate pairing.");
    } finally {
      setInitiating(false);
    }
  };

  const handleConfirmTestHandset = async () => {
    if (!pairingSession) return;
    setConfirmingSimHandset(true);
    try {
      await api.post("/devices/pair/confirm/", {
        pairing_id: pairingSession.pairing_id,
        pairing_code: pairingSession.pairing_code,
        device_name: pairingSession.device_name_hint,
        platform: "android",
        manufacturer: "Samsung",
        device_model: "SM-S921B",
        os_version: "Android 15",
        app_version: "1.0.0",
        sim_available: true,
        carrier_name: "Vodacom TZ",
        network_type: "5G",
        sim_slots: [
          { slot_index: 0, carrier_name: "Vodacom TZ", phone_number: "+255754000111", is_active: true },
          { slot_index: 1, carrier_name: "Airtel TZ", phone_number: "+255682000222", is_active: true },
        ],
        permissions_state: { SEND_SMS: true, RECEIVE_SMS: true, READ_PHONE_STATE: true },
      });
      toast.success("Gateway Device Paired!", `${pairingSession.device_name_hint} is now bound to your workspace.`);
      setPairingSession(null);
      setPairOpen(false);
      await loadDevices();
    } catch (err) {
      toast.error("Confirmation failed", err instanceof Error ? err.message : "Invalid or expired pairing code.");
    } finally {
      setConfirmingSimHandset(false);
    }
  };

  const handlePauseResume = async (dev: DeviceRecord) => {
    const action = dev.is_paused ? "resume" : "pause";
    try {
      await api.post(`/devices/${dev.id}/${action}/`);
      toast.success(dev.is_paused ? "Gateway Resumed" : "Gateway Paused", dev.name);
      await loadDevices();
    } catch (err) {
      toast.error("Action failed", err instanceof Error ? err.message : "Could not update gateway state.");
    }
  };

  const handleUpdateDevice = async (dev: DeviceRecord, patch: Partial<DeviceRecord>) => {
    try {
      await api.patch(`/devices/${dev.id}/`, patch);
      toast.success("Device Updated", dev.name);
      await loadDevices();
    } catch (err) {
      toast.error("Update failed", err instanceof Error ? err.message : "Could not save settings.");
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await api.post(`/devices/${revokeTarget.id}/revoke/`);
      toast.info("Device Credentials Revoked", `${revokeTarget.name} can no longer poll or sync.`);
      setRevokeTarget(null);
      await loadDevices();
    } catch (err) {
      toast.error("Revoke failed", err instanceof Error ? err.message : "Could not revoke device.");
    }
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Android SIM Gateways & Device Pairing"
        subtitle="Bind Android handsets with single-use QR codes, inspect SIM slots & permissions, and control job queues."
        actions={
          <>
            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer mr-2">
              <input
                type="checkbox"
                checked={includeRevoked}
                onChange={(e) => setIncludeRevoked(e.target.checked)}
              />
              <span>Show Revoked</span>
            </label>
            <button type="button" onClick={loadDevices} className="btn-secondary text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPairingSession(null);
                setPairOpen(true);
              }}
              className="btn-primary text-xs"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Pair Android Handset</span>
            </button>
          </>
        }
      />

      {loading ? (
        <LoadingSkeleton rows={3} label="Loading paired devices" />
      ) : error ? (
        <ErrorState message={error} onRetry={loadDevices} />
      ) : devices.length === 0 ? (
        <EmptyState
          title="No Android SIM Gateways paired yet"
          description="Generate a short-lived QR code to connect the EduSMS Flutter Android app, or continue exploring in Simulation Sandbox Mode."
          icon={Smartphone}
          action={
            <button type="button" onClick={() => setPairOpen(true)} className="btn-primary text-xs">
              <QrCode className="w-3.5 h-3.5" />
              <span>Generate Pairing QR Code</span>
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {devices.map((dev) => {
            const isRevoked = Boolean(dev.revoked_at);
            return (
              <GlowCard key={dev.id} active={dev.is_online && !dev.is_paused && !isRevoked} className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        dev.is_online ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-[var(--text-muted)]"
                      }`}
                    >
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-[var(--text-primary)]">{dev.name}</h3>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {dev.manufacturer} {dev.device_model} · {dev.os_version || dev.platform} · Token{" "}
                        <code>{dev.gateway_token_prefix}…</code>
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                      isRevoked
                        ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                        : dev.is_paused
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : dev.is_online
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/35"
                            : "bg-slate-500/15 text-[var(--text-muted)] border-slate-500/30"
                    }`}
                  >
                    {isRevoked ? "Revoked" : dev.is_paused ? "Paused" : dev.is_online ? "Online" : "Offline"}
                  </span>
                </div>

                {dev.recommended_action && (
                  <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-500/35 text-xs flex items-start gap-2 text-amber-500 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{dev.recommended_action}</span>
                  </div>
                )}

                {/* Telemetry Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="surface-elevated p-2.5">
                    <div className="text-[var(--text-muted)]">Carrier</div>
                    <div className="font-semibold mt-0.5 truncate">{dev.carrier_name || "Unknown"}</div>
                  </div>
                  <div className="surface-elevated p-2.5">
                    <div className="text-[var(--text-muted)]">Battery</div>
                    <div className="font-semibold mt-0.5 flex items-center gap-1">
                      {dev.is_charging ? (
                        <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Battery className="w-3.5 h-3.5" />
                      )}
                      <span>{dev.battery_level !== null ? `${dev.battery_level}%` : "—"}</span>
                    </div>
                  </div>
                  <div className="surface-elevated p-2.5">
                    <div className="text-[var(--text-muted)]">Sent / Recv</div>
                    <div className="font-semibold font-mono mt-0.5">
                      {dev.outgoing_message_count} / {dev.incoming_message_count}
                    </div>
                  </div>
                  <div className="surface-elevated p-2.5">
                    <div className="text-[var(--text-muted)]">Pending Jobs</div>
                    <div className="font-semibold font-mono mt-0.5 text-cyan-400">{dev.pending_jobs_count}</div>
                  </div>
                </div>

                {/* SIM Slot Selector & Permissions Diagnostics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="surface-elevated p-3">
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">Active SIM Slot</label>
                    <select
                      disabled={isRevoked}
                      value={dev.selected_sim_slot}
                      onChange={(e) =>
                        void handleUpdateDevice(dev, { selected_sim_slot: Number(e.target.value) })
                      }
                      className="input-field text-xs py-1"
                    >
                      <option value={0}>SIM 1 (Slot 0)</option>
                      <option value={1}>SIM 2 (Slot 1)</option>
                    </select>
                  </div>
                  <div className="surface-elevated p-3 space-y-1">
                    <div className="text-[11px] text-[var(--text-muted)]">Android SMS Role & Permissions</div>
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          dev.permissions_state?.SEND_SMS !== false
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-rose-500/15 text-rose-400"
                        }`}
                      >
                        SEND_SMS
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          dev.permissions_state?.RECEIVE_SMS !== false
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-amber-500/15 text-amber-400"
                        }`}
                      >
                        RECEIVE_SMS
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                        {dev.is_default_sms_app ? "Default SMS App" : "Standard SMS Role"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)] text-xs">
                  <span className="text-[var(--text-muted)] inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      Heartbeat:{" "}
                      {dev.last_heartbeat_at ? new Date(dev.last_heartbeat_at).toLocaleTimeString() : "Never"}
                    </span>
                  </span>

                  {!isRevoked && (
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handlePauseResume(dev)}
                        className="btn-secondary text-xs py-1 px-2.5"
                      >
                        {dev.is_paused ? (
                          <>
                            <Play className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Resume</span>
                          </>
                        ) : (
                          <>
                            <Pause className="w-3.5 h-3.5 text-amber-400" />
                            <span>Pause</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(dev)}
                        className="btn-secondary text-xs py-1 px-2.5 text-rose-400"
                      >
                        <ShieldOff className="w-3.5 h-3.5" />
                        <span>Revoke</span>
                      </button>
                    </div>
                  )}
                </div>
              </GlowCard>
            );
          })}
        </div>
      )}

      {/* Pairing Modal with QRCodeSVG */}
      <Modal
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        title="Pair Android SIM Gateway"
        subtitle="Single-use short-lived pairing session — never embeds permanent user JWTs."
        footer={
          <button type="button" onClick={() => setPairOpen(false)} className="btn-secondary">
            Close
          </button>
        }
      >
        {!pairingSession ? (
          <form onSubmit={handleInitPairing} className="space-y-4">
            <div>
              <label htmlFor="pair-device-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Handset Friendly Name
              </label>
              <input
                id="pair-device-name"
                type="text"
                value={deviceNameHint}
                onChange={(e) => setDeviceNameHint(e.target.value)}
                placeholder="Department Android SIM Phone"
                className="input-field"
                required
              />
            </div>
            <button type="submit" disabled={initiating} className="btn-primary w-full">
              <QrCode className="w-4 h-4" />
              <span>{initiating ? "Generating..." : "Generate Single-Use Pairing Code & QR"}</span>
            </button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <div className="inline-block p-4 rounded-2xl bg-white shadow-md">
              <QRCodeSVG value={pairingSession.qr_payload} size={184} level="M" />
            </div>
            <div>
              <div className="text-xs text-[var(--text-secondary)]">Or enter this 6-character code on the phone:</div>
              <div className="text-2xl font-mono font-bold tracking-widest text-violet-400 mt-1">
                {pairingSession.pairing_code}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                Expires in <span className="font-mono font-semibold">{formatCountdown(secondsLeft)}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--border-subtle)] text-left space-y-2">
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Developer / Evaluator Handset Confirmation
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Don’t have a physical Android phone at hand? Confirm this pairing session as a dual-SIM test gateway
                handset to inspect the full paired device workflow.
              </p>
              <button
                type="button"
                disabled={confirmingSimHandset || secondsLeft === 0}
                onClick={handleConfirmTestHandset}
                className="btn-secondary w-full text-xs"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{confirmingSimHandset ? "Binding Handset..." : "Confirm Pairing (Dev Test Handset)"}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Revoke Confirmation Modal */}
      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revoke Gateway Device Credentials?"
        footer={
          <>
            <button type="button" onClick={() => setRevokeTarget(null)} className="btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={handleRevoke} className="btn-danger">
              Permanently Revoke Device
            </button>
          </>
        }
      >
        <p className="text-xs text-[var(--text-secondary)]">
          Revoking <strong>{revokeTarget?.name}</strong> immediately invalidates its <code>X-Gateway-Token</code> and
          marks any unconfirmed claimed jobs as failed so they cannot be transmitted unexpectedly.
        </p>
      </Modal>
    </div>
  );
}
