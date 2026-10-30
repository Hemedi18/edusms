import React, { useCallback, useEffect, useState } from "react";
import {
  Megaphone,
  Plus,
  Play,
  Pause,
  Ban,
  FastForward,
  Download,
  Eye,
  Send,
  ShieldAlert,
  Smartphone,
  Globe,
  Trash2,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type {
  AudiencePreviewResponse,
  BulkCampaignRecord,
  CampaignRecipientRecord,
  ContactGroupRecord,
  DeviceRecord,
  SenderIdentityConfig,
  TransportType,
} from "../types/api";
import { PageHeader, LoadingSkeleton, EmptyState, ErrorState } from "../components/States";
import { TransportBadge } from "../components/TransportBadge";
import { Modal } from "../components/Modal";
import { useToast } from "../contexts/ToastContext";

export function CampaignsPage() {
  const toast = useToast();

  const [tab, setTab] = useState<"campaigns" | "identities">("campaigns");
  const [campaigns, setCampaigns] = useState<BulkCampaignRecord[]>([]);
  const [groups, setGroups] = useState<ContactGroupRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [identities, setIdentities] = useState<SenderIdentityConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Campaign Builder Modal
  const [builderOpen, setBuilderOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cTemplate, setCTemplate] = useState(
    "Hello {{contact_name}}, reminder that tomorrow's lecture starts at 09:00 in Hall A."
  );
  const [cTransport, setCTransport] = useState<TransportType>("simulation");
  const [cDeviceId, setCDeviceId] = useState("");
  const [cGroupIds, setCGroupIds] = useState<string[]>([]);
  const [cRawNumbers, setCRawNumbers] = useState("+255754100201\n+255713200302");
  const [cIntervalMs, setCIntervalMs] = useState(500);
  const [cMaxVolume, setCMaxVolume] = useState(500);
  const [audiencePreview, setAudiencePreview] = useState<AudiencePreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  // Test Send & Recipients Inspector
  const [testSendCampaign, setTestSendCampaign] = useState<BulkCampaignRecord | null>(null);
  const [testRecipient, setTestRecipient] = useState("+255754100201");
  const [inspectCampaign, setInspectCampaign] = useState<BulkCampaignRecord | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipientRecord[]>([]);

  // Sender Identity Modal
  const [idModalOpen, setIdModalOpen] = useState(false);
  const [idLabel, setIdLabel] = useState("");
  const [idType, setIdType] = useState<"sim_slot" | "external_provider">("sim_slot");
  const [idDevice, setIdDevice] = useState("");
  const [idSimSlot, setIdSimSlot] = useState(0);
  const [idSimHint, setIdSimHint] = useState("+255754000111");
  const [idProviderName, setIdProviderName] = useState("Africa's Talking / Twilio");
  const [idProviderUrl, setIdProviderUrl] = useState("https://api.smsprovider.example.com/v1/messages");
  const [idAlpha, setIdAlpha] = useState("EDUSMS");
  const [idApiKey, setIdApiKey] = useState("");

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [cRes, gRes, dRes, iRes] = await Promise.all([
        api.get<BulkCampaignRecord[] | { results: BulkCampaignRecord[] }>("/campaigns/"),
        api.get<ContactGroupRecord[] | { results: ContactGroupRecord[] }>("/groups/").catch(() => []),
        api.get<DeviceRecord[] | { results: DeviceRecord[] }>("/devices/").catch(() => []),
        api.get<SenderIdentityConfig[] | { results: SenderIdentityConfig[] }>("/sender-identities/").catch(() => []),
      ]);
      setCampaigns(unwrapList<BulkCampaignRecord>(cRes as BulkCampaignRecord[]));
      setGroups(unwrapList<ContactGroupRecord>(gRes as ContactGroupRecord[]));
      const devs = unwrapList<DeviceRecord>(dRes as DeviceRecord[]);
      setDevices(devs);
      if (!cDeviceId && devs.length > 0) setCDeviceId(devs[0].id);
      if (!idDevice && devs.length > 0) setIdDevice(devs[0].id);
      setIdentities(unwrapList<SenderIdentityConfig>(iRes as SenderIdentityConfig[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns.");
    } finally {
      setLoading(false);
    }
  }, [cDeviceId, idDevice]);

  useEffect(() => {
    setLoading(true);
    void loadAll();
  }, [loadAll]);

  const handlePreviewAudience = async () => {
    setPreviewing(true);
    try {
      const rawList = cRawNumbers
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean);
      const res = await api.post<AudiencePreviewResponse>("/campaigns/preview-audience/", {
        message_template: cTemplate,
        transport_type: cTransport,
        group_ids: cGroupIds,
        raw_numbers: rawList,
        max_volume: cMaxVolume,
      });
      setAudiencePreview(res);
    } catch (err) {
      toast.error("Preview failed", err instanceof Error ? err.message : "Could not preview audience.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cName.trim() || !cTemplate.trim()) return;
    setCreatingCampaign(true);
    try {
      const rawList = cRawNumbers
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        name: cName.trim(),
        message_template: cTemplate,
        transport_type: cTransport,
        group_ids: cGroupIds,
        raw_numbers: rawList,
        inter_message_interval_ms: cIntervalMs,
        max_volume: cMaxVolume,
      };
      if (cTransport === "sim_gateway" && cDeviceId) {
        payload.device = cDeviceId;
      }
      await api.post("/campaigns/", payload);
      toast.success("Campaign Created", `${cName} is ready in draft state.`);
      setBuilderOpen(false);
      setAudiencePreview(null);
      await loadAll();
    } catch (err) {
      toast.error("Campaign creation failed", err instanceof Error ? err.message : "Invalid campaign configuration.");
    } finally {
      setCreatingCampaign(false);
    }
  };

  const runCampaignAction = async (id: string, actionPath: string, successTitle: string) => {
    try {
      await api.post(`/campaigns/${id}/${actionPath}/`, {});
      toast.success(successTitle);
      await loadAll();
    } catch (err) {
      toast.error("Campaign action failed", err instanceof Error ? err.message : "Request failed.");
    }
  };

  const openRecipientsModal = async (camp: BulkCampaignRecord) => {
    setInspectCampaign(camp);
    try {
      const res = await api.get<CampaignRecipientRecord[] | { results: CampaignRecipientRecord[] }>(
        `/campaigns/${camp.id}/recipients/`
      );
      setRecipients(unwrapList<CampaignRecipientRecord>(res as CampaignRecipientRecord[]));
    } catch {
      setRecipients([]);
    }
  };

  const handleCreateSenderIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Record<string, unknown> = {
        label: idLabel.trim(),
        identity_type: idType,
        is_enabled: true,
      };
      if (idType === "sim_slot") {
        payload.device = idDevice || null;
        payload.sim_slot = idSimSlot;
        payload.sim_phone_number_hint = idSimHint.trim();
        payload.alphanumeric_sender_id = ""; // Strictly empty — SIM slots cannot spoof sender IDs!
        payload.registration_status = "sim_native";
      } else {
        payload.provider_name = idProviderName.trim();
        payload.provider_base_url = idProviderUrl.trim();
        payload.alphanumeric_sender_id = idAlpha.trim();
        payload.registration_status = idApiKey.trim() ? "verified_active" : "dev_adapter";
        if (idApiKey.trim()) payload.provider_api_key = idApiKey.trim();
      }
      await api.post("/sender-identities/", payload);
      toast.success("Sender Identity Saved", idLabel);
      setIdModalOpen(false);
      setIdApiKey("");
      await loadAll();
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Check sender identity fields.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Campaigns & Sender Identities"
        subtitle="Consent-verified bulk SMS broadcasting with deduplication, throttling, live cancellation, and honest sender IDs."
        actions={
          tab === "campaigns" ? (
            <button
              type="button"
              onClick={() => {
                setAudiencePreview(null);
                setBuilderOpen(true);
              }}
              className="btn-primary text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Bulk Campaign</span>
            </button>
          ) : (
            <button type="button" onClick={() => setIdModalOpen(true)} className="btn-primary text-xs">
              <Plus className="w-3.5 h-3.5" />
              <span>Add Sender Identity</span>
            </button>
          )
        }
      />

      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        <button
          type="button"
          onClick={() => setTab("campaigns")}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer ${
            tab === "campaigns"
              ? "bg-violet-600 text-white border-violet-500"
              : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
          }`}
        >
          Bulk Campaigns ({campaigns.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("identities")}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer ${
            tab === "identities"
              ? "bg-violet-600 text-white border-violet-500"
              : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
          }`}
        >
          Sender Identities ({identities.length})
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} label="Loading campaigns" />
      ) : error ? (
        <ErrorState message={error} onRetry={loadAll} />
      ) : tab === "campaigns" ? (
        campaigns.length === 0 ? (
          <EmptyState
            title="No bulk campaigns created yet"
            description="Build a campaign in Simulation Mode or via a paired Android SIM with audience deduplication and opt-out filtering."
            icon={Megaphone}
            action={
              <button type="button" onClick={() => setBuilderOpen(true)} className="btn-primary text-xs">
                <span>Launch Campaign Builder</span>
              </button>
            }
          />
        ) : (
          <div className="space-y-4">
            {campaigns.map((camp) => {
              const s = camp.stats;
              const eligible = Math.max(1, s.eligible_recipients || 1);
              const pct = Math.min(100, Math.round(((s.transmission_attempts || 0) / eligible) * 100));
              return (
                <div key={camp.id} className="surface-card p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-base font-bold text-[var(--text-primary)]">{camp.name}</h3>
                        <TransportBadge transportType={camp.transport_type} isSimulation={camp.is_simulation} />
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono uppercase bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                          {camp.status}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-1">
                        Template: {camp.message_template}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {(camp.status === "draft" || camp.status === "scheduled") && (
                        <button
                          type="button"
                          onClick={() => void runCampaignAction(camp.id, "start", "Campaign Started")}
                          className="btn-primary text-xs py-1.5 px-3"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Start</span>
                        </button>
                      )}
                      {camp.status === "running" && (
                        <>
                          <button
                            type="button"
                            onClick={() => void runCampaignAction(camp.id, "process-batch", "Processed Next Batch")}
                            className="btn-secondary text-xs py-1.5 px-2.5"
                          >
                            <FastForward className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Step Batch</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void runCampaignAction(camp.id, "pause", "Campaign Paused")}
                            className="btn-secondary text-xs py-1.5 px-2.5"
                          >
                            <Pause className="w-3.5 h-3.5 text-amber-400" />
                            <span>Pause</span>
                          </button>
                        </>
                      )}
                      {camp.status === "paused" && (
                        <button
                          type="button"
                          onClick={() => void runCampaignAction(camp.id, "resume", "Campaign Resumed")}
                          className="btn-primary text-xs py-1.5 px-3"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Resume</span>
                        </button>
                      )}
                      {camp.status !== "completed" && camp.status !== "canceled" && (
                        <button
                          type="button"
                          onClick={() => void runCampaignAction(camp.id, "cancel", "Campaign Canceled")}
                          className="btn-secondary text-xs py-1.5 px-2.5 text-rose-400"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Cancel</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setTestSendCampaign(camp)}
                        className="btn-secondary text-xs py-1.5 px-2.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Test Send</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void openRecipientsModal(camp)}
                        className="btn-secondary text-xs py-1.5 px-2.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Recipients</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void api.downloadFile(`/campaigns/${camp.id}/export-csv/`, `campaign_${camp.id}_report.csv`)
                        }
                        className="btn-secondary text-xs py-1.5 px-2.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div>
                    <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
                      <span>
                        Progress: {s.transmission_attempts} / {s.eligible_recipients} eligible recipients
                      </span>
                      <span className="font-mono">{s.eligible_recipients > 0 ? `${pct}%` : "0%"}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 to-cyan-500 transition-all"
                        style={{ width: `${s.eligible_recipients > 0 ? pct : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Honest Breakdown */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="surface-elevated p-2">
                      <span className="text-[var(--text-muted)]">Eligible:</span>{" "}
                      <strong>{s.eligible_recipients}</strong>
                    </div>
                    <div className="surface-elevated p-2">
                      <span className="text-[var(--text-muted)]">Excluded/Opt-out:</span>{" "}
                      <strong className="text-amber-400">{s.excluded_recipients}</strong>
                    </div>
                    <div className="surface-elevated p-2">
                      <span className="text-[var(--text-muted)]">
                        {camp.is_simulation ? "Sim Delivered:" : "Carrier Confirmed:"}
                      </span>{" "}
                      <strong className="text-emerald-400">
                        {camp.is_simulation ? s.simulated_delivered_messages : s.delivery_confirmed_messages}
                      </strong>
                    </div>
                    <div className="surface-elevated p-2">
                      <span className="text-[var(--text-muted)]">Submitted (Unconfirmed):</span>{" "}
                      <strong>{s.submitted_messages}</strong>
                    </div>
                    <div className="surface-elevated p-2">
                      <span className="text-[var(--text-muted)]">Failed:</span>{" "}
                      <strong className="text-rose-400">{s.failed_messages}</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Sender Identities Tab */
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/35 text-xs flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-[var(--text-secondary)]">
              <div className="font-semibold text-[var(--text-primary)]">
                Technical Integrity: Physical SIM Numbers vs Registered Alphanumeric Sender IDs
              </div>
              <p>
                Cellular networks enforce sender identity at the carrier MSC/SMSC. Messages sent via an{" "}
                <strong>Android SIM Gateway (`sim_slot`)</strong> ALWAYS originate from the SIM card’s native carrier
                phone number and <strong>cannot</strong> spoof alphanumeric Sender IDs. Alphanumeric Sender IDs (1–11
                chars, e.g. <code>EDUSMS</code>) are supported exclusively via legitimate{" "}
                <strong>External SMS Providers (`external_provider`)</strong> after regulatory registration.
              </p>
            </div>
          </div>

          {identities.length === 0 ? (
            <EmptyState
              title="No sender identities configured"
              description="Label your physical SIM card slots or configure a registered External SMS Provider alphanumeric Sender ID."
              icon={Smartphone}
              action={
                <button type="button" onClick={() => setIdModalOpen(true)} className="btn-primary text-xs">
                  <span>Add Sender Identity</span>
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {identities.map((idCfg) => (
                <div key={idCfg.id} className="surface-card p-4 flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {idCfg.identity_type === "sim_slot" ? (
                        <Smartphone className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Globe className="w-4 h-4 text-blue-400" />
                      )}
                      <span className="text-sm font-semibold">{idCfg.label}</span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {idCfg.identity_type === "sim_slot" ? (
                        <>
                          Carrier SIM Native Number ({idCfg.sim_phone_number_hint || `SIM #${idCfg.sim_slot + 1}`}) — No
                          spoofing
                        </>
                      ) : (
                        <>
                          External Provider ({idCfg.provider_name}) · Sender ID:{" "}
                          <code className="font-mono font-bold">{idCfg.alphanumeric_sender_id || "—"}</code> · Key:{" "}
                          <code>{idCfg.masked_provider_api_key || "Unset"}</code>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.delete(`/sender-identities/${idCfg.id}/`);
                      void loadAll();
                    }}
                    className="btn-secondary text-xs py-1 px-2 text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Campaign Builder Modal */}
      <Modal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title="Bulk Campaign Builder"
        subtitle="Preview deduplication, opt-outs, and rendered templates before creating."
        maxWidthClass="max-w-2xl"
        footer={
          <>
            <button
              type="button"
              onClick={handlePreviewAudience}
              disabled={previewing}
              className="btn-secondary text-xs"
            >
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
              <span>{previewing ? "Previewing..." : "Preview Audience & Exclusions"}</span>
            </button>
            <button
              type="submit"
              form="campaign-builder-form"
              disabled={creatingCampaign}
              className="btn-primary text-xs"
            >
              {creatingCampaign ? "Creating..." : "Create Campaign"}
            </button>
          </>
        }
      >
        <form id="campaign-builder-form" onSubmit={handleCreateCampaign} className="space-y-3.5">
          <div>
            <label htmlFor="camp-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Campaign Name
            </label>
            <input
              id="camp-name"
              type="text"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              placeholder="CS101 Exam Venue Notice"
              className="input-field"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="camp-transport" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Execution Transport
              </label>
              <select
                id="camp-transport"
                value={cTransport}
                onChange={(e) => setCTransport(e.target.value as TransportType)}
                className="input-field"
              >
                <option value="simulation">Simulation Sandbox (No Real SMS)</option>
                <option value="sim_gateway">Android SIM Gateway (Real Carrier SMS)</option>
                <option value="external_provider">External SMS Provider</option>
              </select>
            </div>
            <div>
              <label htmlFor="camp-interval" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Throttle Interval (ms between SMS)
              </label>
              <input
                id="camp-interval"
                type="number"
                min={0}
                value={cIntervalMs}
                onChange={(e) => setCIntervalMs(Number(e.target.value))}
                className="input-field"
              />
            </div>
          </div>

          {groups.length > 0 && (
            <div>
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Target Contact Groups</span>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => {
                  const checked = cGroupIds.includes(g.id);
                  return (
                    <label
                      key={g.id}
                      className="surface-elevated px-2.5 py-1 text-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCGroupIds((prev) =>
                            e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)
                          )
                        }
                      />
                      <span>
                        {g.name} ({g.member_count})
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="camp-raw-numbers" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Additional Phone Numbers (one per line)
            </label>
            <textarea
              id="camp-raw-numbers"
              rows={3}
              value={cRawNumbers}
              onChange={(e) => setCRawNumbers(e.target.value)}
              className="input-field font-mono text-xs"
            />
          </div>

          <div>
            <label htmlFor="camp-template" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Message Template (supports {"{{contact_name}}"})
            </label>
            <textarea
              id="camp-template"
              rows={3}
              value={cTemplate}
              onChange={(e) => setCTemplate(e.target.value)}
              className="input-field"
              required
            />
          </div>

          {audiencePreview && (
            <div role="region" aria-label="Audience preview summary" className="surface-elevated p-3.5 space-y-2 text-xs">
              <div className="font-semibold text-cyan-400">Audience Validation & Exclusion Preview</div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded bg-[var(--bg-surface)]">
                  <div className="text-[var(--text-muted)]">Input</div>
                  <div className="font-bold">{audiencePreview.total_input_count}</div>
                </div>
                <div className="p-2 rounded bg-[var(--bg-surface)]">
                  <div className="text-[var(--text-muted)]">Duplicates</div>
                  <div className="font-bold">{audiencePreview.duplicate_removed_count}</div>
                </div>
                <div className="p-2 rounded bg-[var(--bg-surface)]">
                  <div className="text-[var(--text-muted)]">Eligible</div>
                  <div className="font-bold text-emerald-400">{audiencePreview.eligible_count}</div>
                </div>
                <div className="p-2 rounded bg-[var(--bg-surface)]">
                  <div className="text-[var(--text-muted)]">Excluded</div>
                  <div className="font-bold text-amber-400">{audiencePreview.excluded_count}</div>
                </div>
              </div>
              <div>
                <strong>Sample Rendered SMS:</strong> “{audiencePreview.sample_preview}”
              </div>
              {audiencePreview.excluded_preview.length > 0 && (
                <div className="text-amber-400">
                  <strong>Excluded Recipients:</strong>
                  <ul className="list-disc pl-4 mt-0.5">
                    {audiencePreview.excluded_preview.map((ex, i) => (
                      <li key={i}>
                        {ex.phone_number} — {ex.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* Test Send Modal */}
      <Modal
        open={Boolean(testSendCampaign)}
        onClose={() => setTestSendCampaign(null)}
        title={testSendCampaign ? `Test Send — ${testSendCampaign.name}` : "Test Send"}
        footer={
          <>
            <button type="button" onClick={() => setTestSendCampaign(null)} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!testSendCampaign) return;
                try {
                  const res = await api.post<{ status: string }>(`/campaigns/${testSendCampaign.id}/test-send/`, {
                    recipient_number: testRecipient,
                  });
                  toast.success("Test SMS Dispatched", `Status: ${res.status}`);
                  setTestSendCampaign(null);
                } catch (err) {
                  toast.error("Test send failed", err instanceof Error ? err.message : "Failed");
                }
              }}
              className="btn-primary"
            >
              Send Test Message
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Explicit Single Test Recipient Number
          </label>
          <input
            type="tel"
            value={testRecipient}
            onChange={(e) => setTestRecipient(e.target.value)}
            className="input-field font-mono"
          />
        </div>
      </Modal>

      {/* Recipients Inspector Modal */}
      <Modal
        open={Boolean(inspectCampaign)}
        onClose={() => setInspectCampaign(null)}
        title={inspectCampaign ? `Recipients — ${inspectCampaign.name}` : "Recipients"}
        maxWidthClass="max-w-2xl"
        footer={
          <button type="button" onClick={() => setInspectCampaign(null)} className="btn-secondary">
            Close
          </button>
        }
      >
        <div className="space-y-2 max-h-96 overflow-y-auto text-xs">
          {recipients.length === 0 ? (
            <p className="text-[var(--text-muted)]">No recipient records found.</p>
          ) : (
            recipients.map((r) => (
              <div key={r.id} className="surface-elevated p-2.5 flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-semibold">{r.phone_number}</span>{" "}
                  {r.recipient_name && <span>({r.recipient_name})</span>}
                  {r.exclusion_reason && <div className="text-amber-400">{r.exclusion_reason}</div>}
                  {r.error_detail && <div className="text-rose-400">{r.error_detail}</div>}
                </div>
                <span className="font-mono px-2 py-0.5 rounded bg-[var(--bg-surface)]">{r.status}</span>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Sender Identity Modal */}
      <Modal
        open={idModalOpen}
        onClose={() => setIdModalOpen(false)}
        title="Configure Sender Identity"
        footer={
          <>
            <button type="button" onClick={() => setIdModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="sender-id-form" className="btn-primary">
              Save Identity
            </button>
          </>
        }
      >
        <form id="sender-id-form" onSubmit={handleCreateSenderIdentity} className="space-y-3.5">
          <div>
            <label htmlFor="sid-label" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Friendly Label
            </label>
            <input
              id="sid-label"
              type="text"
              value={idLabel}
              onChange={(e) => setIdLabel(e.target.value)}
              placeholder="Primary Campus SIM 1"
              className="input-field"
              required
            />
          </div>
          <div>
            <label htmlFor="sid-type" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Identity Type
            </label>
            <select
              id="sid-type"
              value={idType}
              onChange={(e) => setIdType(e.target.value as "sim_slot" | "external_provider")}
              className="input-field"
            >
              <option value="sim_slot">Physical Android SIM Card (Carrier Phone Number Only)</option>
              <option value="external_provider">External SMS Provider (Registered Alphanumeric Sender ID)</option>
            </select>
          </div>
          {idType === "sim_slot" ? (
            <>
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-[var(--text-secondary)]">
                Physical SIM cards always transmit using the SIM’s carrier-assigned phone number. Alphanumeric sender ID
                spoofing is blocked.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">SIM Slot</label>
                  <select
                    value={idSimSlot}
                    onChange={(e) => setIdSimSlot(Number(e.target.value))}
                    className="input-field"
                  >
                    <option value={0}>SIM 1 (Slot 0)</option>
                    <option value={1}>SIM 2 (Slot 1)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">SIM Number Hint</label>
                  <input
                    type="text"
                    value={idSimHint}
                    onChange={(e) => setIdSimHint(e.target.value)}
                    className="input-field font-mono"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">Provider Name</label>
                  <input
                    type="text"
                    value={idProviderName}
                    onChange={(e) => setIdProviderName(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Registered Alphanumeric ID (1–11 chars)
                  </label>
                  <input
                    type="text"
                    maxLength={11}
                    value={idAlpha}
                    onChange={(e) => setIdAlpha(e.target.value)}
                    className="input-field font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">Provider HTTPS Endpoint</label>
                <input
                  type="url"
                  value={idProviderUrl}
                  onChange={(e) => setIdProviderUrl(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">Provider API Key</label>
                <input
                  type="password"
                  value={idApiKey}
                  onChange={(e) => setIdApiKey(e.target.value)}
                  placeholder="Encrypted at rest"
                  className="input-field font-mono"
                />
              </div>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}
