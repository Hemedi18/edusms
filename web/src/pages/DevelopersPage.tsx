import React, { useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  Webhook,
  ShieldCheck,
  Code2,
  Plus,
  Copy,
  RotateCw,
  Ban,
  Send,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type { APIKeyRecord, WebhookEndpointRecord, WebhookEventRecord } from "../types/api";
import { PageHeader, GlowCard, LoadingSkeleton, EmptyState, ErrorState } from "../components/States";
import { Modal } from "../components/Modal";
import { useToast } from "../contexts/ToastContext";

const DEFAULT_SCOPES = [
  "messages:read",
  "messages:write",
  "contacts:read",
  "contacts:write",
  "campaigns:read",
  "campaigns:write",
  "simulation:write",
  "analytics:read",
];

const DEFAULT_EVENTS = [
  "sms.received",
  "sms.queued",
  "sms.sent",
  "sms.delivered",
  "sms.failed",
  "sms.delivery_unknown",
  "auto_reply.triggered",
  "campaign.started",
  "campaign.completed",
  "device.connected",
];

export function DevelopersPage() {
  const toast = useToast();

  const [tab, setTab] = useState<"keys" | "webhooks" | "verifier" | "docs">("keys");
  const [apiKeys, setApiKeys] = useState<APIKeyRecord[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpointRecord[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookEventRecord[]>([]);
  const [supportedScopes, setSupportedScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [supportedEvents, setSupportedEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create API Key Modal & One-Time Raw Key Reveal Modal
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState("CI / Backend Integration");
  const [keyScopes, setKeyScopes] = useState<string[]>(["messages:read", "messages:write", "simulation:write"]);
  const [keySimOnly, setKeySimOnly] = useState(true);
  const [keyRateLimit, setKeyRateLimit] = useState(60);
  const [oneTimeSecretModal, setOneTimeSecretModal] = useState<{
    title: string;
    label: string;
    secret: string;
  } | null>(null);

  // Create Webhook Modal & Delivery Inspector
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false);
  const [whName, setWhName] = useState("Order Portal SMS Receiver");
  const [whUrl, setWhUrl] = useState("https://hooks.example.org/edusms/events");
  const [whEvents, setWhEvents] = useState<string[]>(["sms.received", "sms.delivered", "sms.failed"]);
  const [whIncludeSim, setWhIncludeSim] = useState(true);
  const [inspectDelivery, setInspectDelivery] = useState<WebhookEventRecord | null>(null);

  // HMAC Signature Verifier
  const [verifyEndpointId, setVerifyEndpointId] = useState("");
  const [verifySignature, setVerifySignature] = useState("t=1700000000,v1=0000");
  const [verifyUid, setVerifyUid] = useState("evt_sample_001");
  const [verifyPayload, setVerifyPayload] = useState('{"id":"evt_sample_001","type":"sms.received"}');
  const [verifyOutput, setVerifyOutput] = useState<{ verified: boolean; reason: string } | null>(null);

  // Docs Snippet Generator
  const [snippetLang, setSnippetLang] = useState<"curl" | "python" | "js">("curl");
  const [docRecipient, setDocRecipient] = useState("+255754100201");
  const [docTransport, setDocTransport] = useState<"simulation" | "sim_gateway">("simulation");

  const loadDeveloperData = useCallback(async () => {
    setError(null);
    try {
      const [kRes, wRes, dRes, capRes] = await Promise.all([
        api.get<APIKeyRecord[] | { results: APIKeyRecord[] }>("/developers/api-keys/"),
        api.get<WebhookEndpointRecord[] | { results: WebhookEndpointRecord[] }>("/developers/webhooks/"),
        api.get<WebhookEventRecord[] | { results: WebhookEventRecord[] }>("/developers/webhook-deliveries/"),
        api
          .get<{ supported_scopes: string[]; supported_webhook_events: string[] }>(
            "/developers/api-keys/capabilities/"
          )
          .catch(() => null),
      ]);
      setApiKeys(unwrapList<APIKeyRecord>(kRes as APIKeyRecord[]));
      const whs = unwrapList<WebhookEndpointRecord>(wRes as WebhookEndpointRecord[]);
      setWebhooks(whs);
      if (!verifyEndpointId && whs.length > 0) setVerifyEndpointId(whs[0].id);
      setDeliveries(unwrapList<WebhookEventRecord>(dRes as WebhookEventRecord[]));
      if (capRes?.supported_scopes) setSupportedScopes(capRes.supported_scopes);
      if (capRes?.supported_webhook_events) setSupportedEvents(capRes.supported_webhook_events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load developer settings.");
    } finally {
      setLoading(false);
    }
  }, [verifyEndpointId]);

  useEffect(() => {
    setLoading(true);
    void loadDeveloperData();
  }, [loadDeveloperData]);

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim() || keyScopes.length === 0) {
      toast.warning("Select Scopes", "Choose a name and at least one scope.");
      return;
    }
    try {
      const created = await api.post<APIKeyRecord>("/developers/api-keys/", {
        name: keyName.trim(),
        scopes: keyScopes,
        simulation_only: keySimOnly,
        rate_limit_per_minute: keyRateLimit,
      });
      setCreateKeyOpen(false);
      if (created.raw_key) {
        setOneTimeSecretModal({
          title: "Copy Your New API Key Now",
          label: `API Key (${created.name})`,
          secret: created.raw_key,
        });
      }
      await loadDeveloperData();
    } catch (err) {
      toast.error("Failed to create key", err instanceof Error ? err.message : "Request failed.");
    }
  };

  const handleRotateKey = async (key: APIKeyRecord) => {
    try {
      const rotated = await api.post<APIKeyRecord>(`/developers/api-keys/${key.id}/rotate/`);
      if (rotated.raw_key) {
        setOneTimeSecretModal({
          title: "Rotated API Key Secret",
          label: `Rotated Key (${rotated.name})`,
          secret: rotated.raw_key,
        });
      }
      await loadDeveloperData();
    } catch (err) {
      toast.error("Rotation failed", err instanceof Error ? err.message : "Could not rotate API key.");
    }
  };

  const handleRevokeKey = async (key: APIKeyRecord) => {
    try {
      await api.post(`/developers/api-keys/${key.id}/revoke/`);
      toast.info("API Key Revoked", key.name);
      await loadDeveloperData();
    } catch (err) {
      toast.error("Revoke failed", err instanceof Error ? err.message : "Could not revoke key.");
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whName.trim() || !whUrl.trim() || whEvents.length === 0) return;
    try {
      const created = await api.post<WebhookEndpointRecord>("/developers/webhooks/", {
        name: whName.trim(),
        url: whUrl.trim(),
        events: whEvents,
        include_simulation_events: whIncludeSim,
        is_active: true,
      });
      setCreateWebhookOpen(false);
      if (created.signing_secret) {
        setOneTimeSecretModal({
          title: "Copy Webhook HMAC Signing Secret",
          label: `Signing Secret (${created.name})`,
          secret: created.signing_secret,
        });
      }
      await loadDeveloperData();
    } catch (err) {
      toast.error("Webhook creation failed", err instanceof Error ? err.message : "Check HTTPS URL (SSRF guarded).");
    }
  };

  const handleRetryDelivery = async (ev: WebhookEventRecord) => {
    try {
      await api.post(`/developers/webhook-deliveries/${ev.id}/retry/`);
      toast.success("Webhook Delivery Retried", `Event ${ev.event_uid}`);
      await loadDeveloperData();
    } catch (err) {
      toast.error("Retry failed", err instanceof Error ? err.message : "Could not retry delivery.");
    }
  };

  const handleVerifySignature = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<{ verified: boolean; reason: string }>(
        "/developers/webhooks/verify-signature/",
        {
          endpoint_id: verifyEndpointId,
          signature: verifySignature,
          event_uid: verifyUid,
          payload: verifyPayload,
        }
      );
      setVerifyOutput(res);
    } catch (err) {
      setVerifyOutput({
        verified: false,
        reason: err instanceof Error ? err.message : "Signature verification failed.",
      });
    }
  };

  const copyText = async (txt: string) => {
    try {
      await navigator.clipboard?.writeText(txt);
      toast.success("Copied to clipboard");
    } catch {
      toast.info("Select and copy manually");
    }
  };

  const baseOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8000";
  const codeSample =
    snippetLang === "curl"
      ? `curl -X POST "${baseOrigin}/api/v1/messages/" \\
  -H "X-API-Key: edusms_sim_YOUR_KEY" \\
  -H "Idempotency-Key: msg-req-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "recipient_number": "${docRecipient}",
    "body": "Hello from EduSMS REST API!",
    "transport_type": "${docTransport}"
  }'`
      : snippetLang === "python"
        ? `import requests

resp = requests.post(
    "${baseOrigin}/api/v1/messages/",
    headers={
        "X-API-Key": "edusms_sim_YOUR_KEY",
        "Idempotency-Key": "msg-req-001",
    },
    json={
        "recipient_number": "${docRecipient}",
        "body": "Hello from EduSMS REST API!",
        "transport_type": "${docTransport}",
    },
    timeout=15,
)
print(resp.status_code, resp.json())`
        : `const response = await fetch("${baseOrigin}/api/v1/messages/", {
  method: "POST",
  headers: {
    "X-API-Key": "edusms_sim_YOUR_KEY",
    "Idempotency-Key": "msg-req-001",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    recipient_number: "${docRecipient}",
    body: "Hello from EduSMS REST API!",
    transport_type: "${docTransport}",
  }),
});
const data = await response.json();
console.log(data);`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer Platform, Webhooks & API Reference"
        subtitle="Scoped API keys, SSRF-protected HMAC webhooks with delivery retries, and interactive OpenAPI v1 documentation."
        actions={
          <div className="flex items-center gap-2">
            <a href="/api/v1/docs/" target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <span>Swagger UI</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a href="/api/v1/redoc/" target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <span>ReDoc</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        {(
          [
            { id: "keys", label: `Scoped API Keys (${apiKeys.length})`, Icon: KeyRound },
            { id: "webhooks", label: `Webhooks & Logs (${webhooks.length})`, Icon: Webhook },
            { id: "verifier", label: "HMAC Signature Verifier", Icon: ShieldCheck },
            { id: "docs", label: "Interactive API Docs", Icon: Code2 },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer ${
              tab === id
                ? "bg-violet-600 text-white border-violet-500"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} label="Loading developer platform" />
      ) : error ? (
        <ErrorState message={error} onRetry={loadDeveloperData} />
      ) : tab === "keys" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" onClick={() => setCreateKeyOpen(true)} className="btn-primary text-xs">
              <Plus className="w-3.5 h-3.5" />
              <span>Create API Key</span>
            </button>
          </div>
          {apiKeys.length === 0 ? (
            <EmptyState
              title="No API keys generated yet"
              description="Create a Simulation-only (`edusms_sim_...`) or Live (`edusms_live_...`) API key with fine-grained scopes."
              icon={KeyRound}
              action={
                <button type="button" onClick={() => setCreateKeyOpen(true)} className="btn-primary text-xs">
                  <span>Generate First API Key</span>
                </button>
              }
            />
          ) : (
            <div className="space-y-3">
              {apiKeys.map((k) => (
                <div key={k.id} className="surface-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{k.name}</span>
                      <code className="text-xs px-2 py-0.5 rounded bg-[var(--bg-elevated)] font-mono">
                        {k.key_prefix}…
                      </code>
                      {k.simulation_only && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/15 text-cyan-400">
                          Simulation Only
                        </span>
                      )}
                      {!k.is_active_key && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-rose-500/15 text-rose-400">Revoked</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((sc) => (
                        <span
                          key={sc}
                          className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-violet-500/12 text-violet-400"
                        >
                          {sc}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Rate Limit: {k.rate_limit_per_minute}/min · Created {new Date(k.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {k.is_active_key && (
                    <div className="inline-flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleRotateKey(k)}
                        className="btn-secondary text-xs py-1 px-2.5"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Rotate</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRevokeKey(k)}
                        className="btn-secondary text-xs py-1 px-2.5 text-rose-400"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Revoke</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === "webhooks" ? (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Webhook Endpoints (SSRF-Protected HTTPS)</h2>
              <button type="button" onClick={() => setCreateWebhookOpen(true)} className="btn-primary text-xs">
                <Plus className="w-3.5 h-3.5" />
                <span>Add Webhook Endpoint</span>
              </button>
            </div>
            {webhooks.length === 0 ? (
              <EmptyState
                title="No webhook endpoints configured"
                description="Receive real-time HMAC-SHA256 signed POST callbacks for inbound SMS, carrier DLRs, and campaign progress."
                icon={Webhook}
                action={
                  <button type="button" onClick={() => setCreateWebhookOpen(true)} className="btn-primary text-xs">
                    <span>Register Webhook</span>
                  </button>
                }
              />
            ) : (
              <div className="space-y-3">
                {webhooks.map((wh) => (
                  <div key={wh.id} className="surface-card p-4 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{wh.name}</div>
                        <div className="text-xs font-mono text-cyan-400 break-all">{wh.url}</div>
                        <div className="text-[11px] text-[var(--text-muted)] mt-1">
                          Signing Secret: <code>{wh.masked_signing_secret}</code> · Events: {wh.events.join(", ")}
                        </div>
                      </div>
                      <div className="inline-flex flex-wrap gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await api.post(`/developers/webhooks/${wh.id}/test/`);
                              toast.success("Test Webhook Dispatched");
                              void loadDeveloperData();
                            } catch (err) {
                              toast.error("Test ping failed", err instanceof Error ? err.message : "Error");
                            }
                          }}
                          className="btn-secondary text-xs py-1 px-2.5"
                        >
                          <Send className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Send Test Ping</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const rotated = await api.post<WebhookEndpointRecord>(
                              `/developers/webhooks/${wh.id}/rotate-secret/`
                            );
                            if (rotated.signing_secret) {
                              setOneTimeSecretModal({
                                title: "Rotated Webhook Signing Secret",
                                label: wh.name,
                                secret: rotated.signing_secret,
                              });
                            }
                            void loadDeveloperData();
                          }}
                          className="btn-secondary text-xs py-1 px-2.5"
                        >
                          Rotate Secret
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Webhook Delivery Event Logs */}
          <div className="surface-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Webhook Delivery Logs ({deliveries.length})</h3>
              <button type="button" onClick={loadDeveloperData} className="btn-secondary text-xs py-1 px-2.5">
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>
            {deliveries.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No webhook deliveries triggered yet.</p>
            ) : (
              <div className="space-y-2">
                {deliveries.map((ev) => (
                  <div
                    key={ev.id}
                    className="surface-elevated p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{ev.event_type}</span>
                        <span className="text-[var(--text-muted)]">({ev.event_uid})</span>
                        <span
                          className={`px-2 py-0.5 rounded font-mono ${
                            ev.status === "delivered"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-amber-500/15 text-amber-400"
                          }`}
                        >
                          {ev.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        Endpoint: {ev.endpoint_name} · Attempts: {ev.attempt_count}/{ev.max_attempts}
                        {ev.last_error && <span className="text-rose-400 ml-2">{ev.last_error}</span>}
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setInspectDelivery(ev)}
                        className="btn-secondary text-xs py-1 px-2.5"
                      >
                        Inspect
                      </button>
                      {ev.status !== "delivered" && (
                        <button
                          type="button"
                          onClick={() => void handleRetryDelivery(ev)}
                          className="btn-primary text-xs py-1 px-2.5"
                        >
                          Retry Delivery
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : tab === "verifier" ? (
        <GlowCard className="max-w-2xl space-y-4">
          <h2 className="text-sm font-semibold">HMAC-SHA256 Signature & Replay Guard Verifier</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Test `X-EduSMS-Signature` (`t=&lt;unix_ts&gt;,v1=&lt;hmac_hex&gt;`) and replay UID verification against an
            endpoint’s stored signing secret.
          </p>
          <form onSubmit={handleVerifySignature} className="space-y-3">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Webhook Endpoint</label>
              <select
                value={verifyEndpointId}
                onChange={(e) => setVerifyEndpointId(e.target.value)}
                className="input-field"
              >
                <option value="">Select webhook...</option>
                {webhooks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.url})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">X-EduSMS-Signature Header</label>
                <input
                  type="text"
                  value={verifySignature}
                  onChange={(e) => setVerifySignature(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">Event UID</label>
                <input
                  type="text"
                  value={verifyUid}
                  onChange={(e) => setVerifyUid(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Raw JSON Payload</label>
              <textarea
                rows={3}
                value={verifyPayload}
                onChange={(e) => setVerifyPayload(e.target.value)}
                className="input-field font-mono text-xs"
              />
            </div>
            <button type="submit" disabled={!verifyEndpointId} className="btn-primary text-xs">
              Verify Signature
            </button>
          </form>
          {verifyOutput && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                verifyOutput.verified
                  ? "bg-emerald-500/12 border-emerald-500/35 text-emerald-400"
                  : "bg-rose-500/12 border-rose-500/35 text-rose-400"
              }`}
            >
              <strong>{verifyOutput.verified ? "Verified:" : "Rejected:"}</strong> {verifyOutput.reason}
            </div>
          )}
        </GlowCard>
      ) : (
        /* Interactive API Docs */
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="surface-card p-4 space-y-1">
              <div className="font-semibold text-violet-400">1. User Session JWT</div>
              <code>Authorization: Bearer &lt;access&gt;</code>
              <p className="text-[var(--text-secondary)]">
                Used by Web Dashboard & Mobile App user management screens with short-lived access + rotating refresh
                tokens.
              </p>
            </div>
            <div className="surface-card p-4 space-y-1">
              <div className="font-semibold text-cyan-400">2. Developer API Keys</div>
              <code>X-API-Key: edusms_sim_...</code>
              <p className="text-[var(--text-secondary)]">
                SHA-256 hashed server-to-server keys with explicit scopes (`messages:write`, `campaigns:write`, etc.).
              </p>
            </div>
            <div className="surface-card p-4 space-y-1">
              <div className="font-semibold text-emerald-400">3. Gateway Device Token</div>
              <code>X-Gateway-Token: edugw_...</code>
              <p className="text-[var(--text-secondary)]">
                Dedicated credential bound to a paired Android handset for `/gateway/jobs/poll/` & inbound sync.
              </p>
            </div>
          </div>

          <GlowCard className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Interactive Code Generator — Send SMS (`POST /api/v1/messages/`)</h2>
              <div className="inline-flex rounded-lg bg-[var(--bg-elevated)] p-0.5">
                {(["curl", "python", "js"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setSnippetLang(lang)}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono cursor-pointer ${
                      snippetLang === lang ? "bg-violet-600 text-white" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">Recipient Number</label>
                <input
                  type="text"
                  value={docRecipient}
                  onChange={(e) => setDocRecipient(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">Transport</label>
                <select
                  value={docTransport}
                  onChange={(e) => setDocTransport(e.target.value as "simulation" | "sim_gateway")}
                  className="input-field text-xs"
                >
                  <option value="simulation">simulation (Sandbox — Free)</option>
                  <option value="sim_gateway">sim_gateway (Real Android SIM)</option>
                </select>
              </div>
            </div>

            <div className="relative">
              <pre className="p-4 rounded-xl bg-[#070B14] text-slate-100 border border-slate-800 text-xs font-mono overflow-x-auto">
                {codeSample}
              </pre>
              <button
                type="button"
                onClick={() => void copyText(codeSample)}
                className="absolute top-2.5 right-2.5 btn-secondary text-xs py-1 px-2"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </button>
            </div>
          </GlowCard>
        </div>
      )}

      {/* Create API Key Modal */}
      <Modal
        open={createKeyOpen}
        onClose={() => setCreateKeyOpen(false)}
        title="Generate Scoped API Key"
        footer={
          <>
            <button type="button" onClick={() => setCreateKeyOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="api-key-form" className="btn-primary">
              Generate Key
            </button>
          </>
        }
      >
        <form id="api-key-form" onSubmit={handleCreateApiKey} className="space-y-3.5">
          <div>
            <label htmlFor="apikey-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Key Name
            </label>
            <input
              id="apikey-name"
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Permitted Scopes</span>
            <div className="grid grid-cols-2 gap-2">
              {supportedScopes.map((sc) => {
                const checked = keyScopes.includes(sc);
                return (
                  <label key={sc} className="surface-elevated p-2 text-xs inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setKeyScopes((prev) =>
                          e.target.checked ? [...prev, sc] : prev.filter((item) => item !== sc)
                        )
                      }
                    />
                    <span className="font-mono">{sc}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="apikey-rate" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Rate Limit (req/min)
              </label>
              <input
                id="apikey-rate"
                type="number"
                min={5}
                value={keyRateLimit}
                onChange={(e) => setKeyRateLimit(Number(e.target.value))}
                className="input-field"
              />
            </div>
            <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer mt-5">
              <input type="checkbox" checked={keySimOnly} onChange={(e) => setKeySimOnly(e.target.checked)} />
              <span>Simulation Mode Only (`edusms_sim_`)</span>
            </label>
          </div>
        </form>
      </Modal>

      {/* Create Webhook Modal */}
      <Modal
        open={createWebhookOpen}
        onClose={() => setCreateWebhookOpen(false)}
        title="Register HTTPS Webhook Endpoint"
        footer={
          <>
            <button type="button" onClick={() => setCreateWebhookOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="webhook-form" className="btn-primary">
              Create Endpoint
            </button>
          </>
        }
      >
        <form id="webhook-form" onSubmit={handleCreateWebhook} className="space-y-3.5">
          <div>
            <label htmlFor="wh-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Endpoint Name
            </label>
            <input
              id="wh-name"
              type="text"
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <label htmlFor="wh-url" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Destination HTTPS URL (Private/Loopback/Metadata IPs Blocked)
            </label>
            <input
              id="wh-url"
              type="url"
              value={whUrl}
              onChange={(e) => setWhUrl(e.target.value)}
              className="input-field font-mono text-xs"
              required
            />
          </div>
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Subscribed Events</span>
            <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
              {supportedEvents.map((ev) => {
                const checked = whEvents.includes(ev);
                return (
                  <label key={ev} className="surface-elevated p-2 text-xs inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setWhEvents((prev) =>
                          e.target.checked ? [...prev, ev] : prev.filter((item) => item !== ev)
                        )
                      }
                    />
                    <span className="font-mono text-[11px]">{ev}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={whIncludeSim} onChange={(e) => setWhIncludeSim(e.target.checked)} />
            <span>Deliver Simulation Sandbox events (`simulation: true`)</span>
          </label>
        </form>
      </Modal>

      {/* One-Time Raw Secret Modal */}
      <Modal
        open={Boolean(oneTimeSecretModal)}
        onClose={() => setOneTimeSecretModal(null)}
        title={oneTimeSecretModal?.title || "One-Time Secret"}
        subtitle="Store this credential securely now — for security, the raw value is never stored in plaintext or shown again."
        footer={
          <button type="button" onClick={() => setOneTimeSecretModal(null)} className="btn-primary">
            <CheckCircle2 className="w-4 h-4" />
            <span>I Have Saved This Secret</span>
          </button>
        }
      >
        {oneTimeSecretModal && (
          <div className="space-y-3">
            <div className="text-xs font-medium text-[var(--text-secondary)]">{oneTimeSecretModal.label}</div>
            <div className="p-3.5 rounded-xl bg-[#070B14] text-emerald-300 border border-emerald-500/40 font-mono text-xs break-all flex items-center justify-between gap-3">
              <span data-testid="one-time-raw-secret">{oneTimeSecretModal.secret}</span>
              <button
                type="button"
                onClick={() => void copyText(oneTimeSecretModal.secret)}
                className="btn-secondary text-xs py-1 px-2.5 shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Webhook Delivery Attempt Inspector Modal */}
      <Modal
        open={Boolean(inspectDelivery)}
        onClose={() => setInspectDelivery(null)}
        title="Webhook Delivery Attempts"
        subtitle={inspectDelivery?.event_uid}
        maxWidthClass="max-w-2xl"
        footer={
          <button type="button" onClick={() => setInspectDelivery(null)} className="btn-secondary">
            Close
          </button>
        }
      >
        {inspectDelivery && (
          <div className="space-y-3 text-xs">
            <pre className="p-3 rounded-xl bg-[#070B14] text-slate-200 font-mono overflow-x-auto">
              {JSON.stringify(inspectDelivery.payload, null, 2)}
            </pre>
            <div className="font-semibold">Attempts ({inspectDelivery.attempts?.length || 0})</div>
            {(inspectDelivery.attempts || []).map((a) => (
              <div key={a.id} className="surface-elevated p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="font-semibold">
                    Attempt #{a.attempt_number} · HTTP {a.response_status_code ?? "ERR"}
                  </span>
                  <span className="font-mono">{a.latency_ms}ms</span>
                </div>
                {a.error_message && <div className="text-rose-400">{a.error_message}</div>}
                {a.response_body_preview && (
                  <code className="block text-[11px] text-[var(--text-muted)] truncate">{a.response_body_preview}</code>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
