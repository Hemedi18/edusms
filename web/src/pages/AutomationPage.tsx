import React, { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Sparkles,
  Plus,
  Copy,
  Trash2,
  Play,
  CalendarClock,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Edit3,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type {
  AICallLogRecord,
  AIProviderRecord,
  AutomationModeRecord,
  AutoReplyRuleRecord,
  RuleDryRunResult,
  ScheduleWindow,
} from "../types/api";
import { PageHeader, GlowCard, LoadingSkeleton, EmptyState, ErrorState } from "../components/States";
import { Modal } from "../components/Modal";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AutomationPage() {
  const { user, refreshProfile } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<"rules" | "modes" | "schedules" | "ai">("rules");
  const [modes, setModes] = useState<AutomationModeRecord[]>([]);
  const [rules, setRules] = useState<AutoReplyRuleRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleWindow[]>([]);
  const [providers, setProviders] = useState<AIProviderRecord[]>([]);
  const [aiLogs, setAiLogs] = useState<AICallLogRecord[]>([]);
  const [supportedModels, setSupportedModels] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rule Builder Modal
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoReplyRuleRecord | null>(null);
  const [rName, setRName] = useState("");
  const [rMatchMode, setRMatchMode] = useState<AutoReplyRuleRecord["match_mode"]>("contains");
  const [rKeywords, setRKeywords] = useState("opening hours, office hours");
  const [rTemplate, setRTemplate] = useState(
    "Hello {{contact_name}}, our office hours are Mon–Fri 08:00–17:00."
  );
  const [rPriority, setRPriority] = useState(80);
  const [rCooldown, setRCooldown] = useState(10);
  const [rHumanApproval, setRHumanApproval] = useState(false);
  const [rScheduleId, setRScheduleId] = useState("");

  // Dry-Run Rule Tester
  const [testSender, setTestSender] = useState("+255754100201");
  const [testBody, setTestBody] = useState("Hello, what are your opening hours?");
  const [dryRunResult, setDryRunResult] = useState<RuleDryRunResult | null>(null);
  const [testingRule, setTestingRule] = useState(false);

  // Mode Modal
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<AutomationModeRecord | null>(null);
  const [mName, setMName] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mMethod, setMMethod] = useState<AutomationModeRecord["response_method"]>("rules_only");
  const [mTemplate, setMTemplate] = useState("");
  const [mScheduleId, setMScheduleId] = useState("");
  const [mAiProviderId, setMAiProviderId] = useState("");
  const [mHumanApproval, setMHumanApproval] = useState(false);

  // Schedule Modal & Validation
  const [schedModalOpen, setSchedModalOpen] = useState(false);
  const [sName, setSName] = useState("After Hours Window");
  const [sTz, setSTz] = useState("Africa/Dar_es_Salaam");
  const [sDays, setSDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [sStart, setSStart] = useState("17:30");
  const [sEnd, setSEnd] = useState("07:30");
  const [schedEvalMsg, setSchedEvalMsg] = useState<string | null>(null);

  // AI Provider Modal & Live Prompt Tester
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProviderRecord | null>(null);
  const [pName, setPName] = useState("Campus AI Assistant");
  const [pType, setPType] = useState<AIProviderRecord["provider_type"]>("deterministic_mock");
  const [pBaseUrl, setPBaseUrl] = useState("https://api.openai.com/v1");
  const [pApiKey, setPApiKey] = useState("");
  const [pModel, setPModel] = useState("edusms-mock-v1");
  const [pSimFailure, setPSimFailure] = useState(false);
  const [pSystemInst, setPSystemInst] = useState(
    "Reply concisely and helpfully to student SMS questions in <= 160 characters."
  );
  const [pFallback, setPFallback] = useState(
    "Thank you for your message. A coordinator will follow up shortly."
  );

  const [promptProviderId, setPromptProviderId] = useState("");
  const [promptInput, setPromptInput] = useState("Where is Computer Lab B located?");
  const [promptOutput, setPromptOutput] = useState<Record<string, unknown> | null>(null);

  const loadAutomation = useCallback(async () => {
    setError(null);
    try {
      const [mRes, rRes, sRes, pRes, lRes, modelsRes] = await Promise.all([
        api.get<AutomationModeRecord[] | { results: AutomationModeRecord[] }>("/automation/modes/"),
        api.get<AutoReplyRuleRecord[] | { results: AutoReplyRuleRecord[] }>("/automation/rules/"),
        api.get<ScheduleWindow[] | { results: ScheduleWindow[] }>("/automation/schedules/"),
        api.get<AIProviderRecord[] | { results: AIProviderRecord[] }>("/automation/ai-providers/"),
        api.get<AICallLogRecord[] | { results: AICallLogRecord[] }>("/automation/ai-logs/").catch(() => []),
        api.get<Record<string, string[]>>("/automation/ai-providers/supported-models/").catch(() => ({})),
      ]);
      setModes(unwrapList<AutomationModeRecord>(mRes as AutomationModeRecord[]));
      setRules(unwrapList<AutoReplyRuleRecord>(rRes as AutoReplyRuleRecord[]));
      setSchedules(unwrapList<ScheduleWindow>(sRes as ScheduleWindow[]));
      const provs = unwrapList<AIProviderRecord>(pRes as AIProviderRecord[]);
      setProviders(provs);
      if (!promptProviderId && provs.length > 0) setPromptProviderId(provs[0].id);
      setAiLogs(unwrapList<AICallLogRecord>(lRes as AICallLogRecord[]));
      setSupportedModels(modelsRes || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automation settings.");
    } finally {
      setLoading(false);
    }
  }, [promptProviderId]);

  useEffect(() => {
    setLoading(true);
    void loadAutomation();
  }, [loadAutomation]);

  const handleGlobalToggle = async (field: "global_automation_enabled" | "global_ai_enabled", nextVal: boolean) => {
    try {
      await api.post("/automation/global-toggle/", { [field]: nextVal });
      await refreshProfile();
      toast.success("Master Switch Updated", `${field === "global_automation_enabled" ? "Global Automation" : "Global AI"} ${nextVal ? "enabled" : "disabled"}.`);
    } catch (err) {
      toast.error("Toggle failed", err instanceof Error ? err.message : "Could not update toggle.");
    }
  };

  // Rules handlers
  const openRuleModal = (rule?: AutoReplyRuleRecord) => {
    if (rule) {
      setEditingRule(rule);
      setRName(rule.name);
      setRMatchMode(rule.match_mode);
      setRKeywords(rule.keywords.join(", "));
      setRTemplate(rule.response_template);
      setRPriority(rule.priority);
      setRCooldown(rule.cooldown_minutes);
      setRHumanApproval(rule.require_human_approval);
      setRScheduleId(rule.schedule || "");
    } else {
      setEditingRule(null);
      setRName("");
      setRMatchMode("contains");
      setRKeywords("");
      setRTemplate("Hello {{contact_name}}, thanks for your message.");
      setRPriority(50);
      setRCooldown(10);
      setRHumanApproval(false);
      setRScheduleId("");
    }
    setRuleModalOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = rKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (!rName.trim() || keywords.length === 0 || !rTemplate.trim()) {
      toast.warning("Missing fields", "Provide rule name, at least one keyword/pattern, and response template.");
      return;
    }
    try {
      const payload = {
        name: rName.trim(),
        match_mode: rMatchMode,
        keywords,
        response_template: rTemplate,
        priority: rPriority,
        cooldown_minutes: rCooldown,
        require_human_approval: rHumanApproval,
        schedule: rScheduleId || null,
        is_enabled: editingRule ? editingRule.is_enabled : true,
      };
      if (editingRule) {
        await api.patch(`/automation/rules/${editingRule.id}/`, payload);
        toast.success("Rule Updated", rName);
      } else {
        await api.post("/automation/rules/", payload);
        toast.success("Rule Created", rName);
      }
      setRuleModalOpen(false);
      await loadAutomation();
    } catch (err) {
      toast.error("Rule save failed", err instanceof Error ? err.message : "Check pattern syntax.");
    }
  };

  const handleRunDryTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testBody.trim()) return;
    setTestingRule(true);
    try {
      const res = await api.post<RuleDryRunResult>("/automation/rules/test/", {
        sender_number: testSender.trim(),
        body: testBody.trim(),
      });
      setDryRunResult(res);
    } catch (err) {
      toast.error("Dry-run failed", err instanceof Error ? err.message : "Could not evaluate sample SMS.");
    } finally {
      setTestingRule(false);
    }
  };

  // Mode handlers
  const openModeModal = (mode?: AutomationModeRecord) => {
    if (mode) {
      setEditingMode(mode);
      setMName(mode.name);
      setMDesc(mode.description);
      setMMethod(mode.response_method);
      setMTemplate(mode.response_template);
      setMScheduleId(mode.schedule || "");
      setMAiProviderId(mode.ai_provider || "");
      setMHumanApproval(mode.require_human_approval);
    } else {
      setEditingMode(null);
      setMName("");
      setMDesc("");
      setMMethod("rules_then_template");
      setMTemplate("Hi {{contact_name}}, I am currently unavailable and will respond soon.");
      setMScheduleId("");
      setMAiProviderId("");
      setMHumanApproval(false);
    }
    setModeModalOpen(true);
  };

  const handleSaveMode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mName.trim()) return;
    try {
      const payload = {
        name: mName.trim(),
        description: mDesc.trim(),
        response_method: mMethod,
        response_template: mTemplate,
        schedule: mScheduleId || null,
        ai_provider: mAiProviderId || null,
        require_human_approval: mHumanApproval,
      };
      if (editingMode) {
        await api.patch(`/automation/modes/${editingMode.id}/`, payload);
        toast.success("Mode Updated", mName);
      } else {
        await api.post("/automation/modes/", payload);
        toast.success("Custom Mode Created", mName);
      }
      setModeModalOpen(false);
      await loadAutomation();
    } catch (err) {
      toast.error("Mode save failed", err instanceof Error ? err.message : "Could not save mode.");
    }
  };

  // Schedule handlers
  const handleValidateSchedule = async () => {
    try {
      const res = await api.post<{ currently_active: boolean; evaluation_summary: string }>(
        "/automation/schedules/validate/",
        {
          name: sName,
          timezone: sTz,
          days_of_week: sDays,
          start_time: sStart,
          end_time: sEnd,
        }
      );
      setSchedEvalMsg(`${res.currently_active ? "Currently ACTIVE" : "Currently INACTIVE"} — ${res.evaluation_summary}`);
    } catch (err) {
      toast.error("Validation error", err instanceof Error ? err.message : "Invalid schedule parameters.");
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/automation/schedules/", {
        name: sName.trim(),
        timezone: sTz,
        days_of_week: sDays,
        start_time: sStart,
        end_time: sEnd,
      });
      toast.success("Schedule Window Saved", sName);
      setSchedModalOpen(false);
      await loadAutomation();
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Invalid schedule.");
    }
  };

  // AI Provider handlers
  const openProviderModal = (p?: AIProviderRecord) => {
    if (p) {
      setEditingProvider(p);
      setPName(p.name);
      setPType(p.provider_type);
      setPBaseUrl(p.api_base_url);
      setPApiKey(""); // Never populate raw secret; blank keeps existing encrypted key
      setPModel(p.model_name);
      setPSimFailure(p.simulate_failure);
      setPSystemInst(p.system_instructions);
      setPFallback(p.fallback_message);
    } else {
      setEditingProvider(null);
      setPName("Deterministic Lab Mock AI");
      setPType("deterministic_mock");
      setPBaseUrl("https://api.openai.com/v1");
      setPApiKey("");
      setPModel("edusms-mock-v1");
      setPSimFailure(false);
      setPSystemInst("Reply concisely and helpfully to student SMS questions in <= 160 characters.");
      setPFallback("Thank you for your message. A coordinator will follow up shortly.");
    }
    setAiModalOpen(true);
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Record<string, unknown> = {
        name: pName.trim(),
        provider_type: pType,
        api_base_url: pBaseUrl.trim(),
        model_name: pModel.trim(),
        simulate_failure: pSimFailure,
        system_instructions: pSystemInst,
        fallback_message: pFallback,
        is_enabled: true,
      };
      if (pApiKey.trim()) {
        payload.api_key = pApiKey.trim();
      }
      if (editingProvider) {
        await api.patch(`/automation/ai-providers/${editingProvider.id}/`, payload);
        toast.success("AI Provider Updated", pName);
      } else {
        await api.post("/automation/ai-providers/", payload);
        toast.success("AI Provider Configured", pName);
      }
      setAiModalOpen(false);
      setPApiKey("");
      await loadAutomation();
    } catch (err) {
      toast.error("AI Provider save failed", err instanceof Error ? err.message : "Check configuration.");
    }
  };

  const handleTestPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptProviderId || !promptInput.trim()) return;
    try {
      const res = await api.post<Record<string, unknown>>(
        `/automation/ai-providers/${promptProviderId}/test-prompt/`,
        {
          prompt: promptInput.trim(),
          sender_name: "Amina (Student)",
        }
      );
      setPromptOutput(res);
      await loadAutomation();
    } catch (err) {
      toast.error("Prompt test failed", err instanceof Error ? err.message : "Could not generate AI reply.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automation Hub & AI Auto-Responder"
        subtitle="Configure modes, keyword & regex rules, active schedule windows, dry-run evaluation, and AI providers."
      />

      {/* Global Master Switches */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlowCard active={Boolean(user?.global_automation_enabled)}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Global Automation Master Switch
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Controls all automatic keyword rules and mode templates across both Simulation and Real SIM gateways.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                aria-label="Global Automation Master Switch"
                checked={user?.global_automation_enabled ?? true}
                onChange={(e) => void handleGlobalToggle("global_automation_enabled", e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-xs font-semibold">
                {user?.global_automation_enabled ?? true ? "Enabled" : "Paused"}
              </span>
            </label>
          </div>
        </GlowCard>

        <GlowCard active={Boolean(user?.global_ai_enabled)}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">Global AI Responder Switch</div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Permits configured AI providers (with deterministic fallback) when enabled on active modes and contacts.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                aria-label="Global AI Responder Switch"
                checked={user?.global_ai_enabled ?? false}
                onChange={(e) => void handleGlobalToggle("global_ai_enabled", e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-xs font-semibold">{user?.global_ai_enabled ? "Enabled" : "Off"}</span>
            </label>
          </div>
        </GlowCard>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        {(
          [
            { id: "rules", label: `Rules & Dry-Run Tester (${rules.length})` },
            { id: "modes", label: `Automation Modes (${modes.length})` },
            { id: "schedules", label: `Schedule Windows (${schedules.length})` },
            { id: "ai", label: `AI Providers & Logs (${providers.length})` },
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

      {loading ? (
        <LoadingSkeleton rows={4} label="Loading automation configuration" />
      ) : error ? (
        <ErrorState message={error} onRetry={loadAutomation} />
      ) : tab === "rules" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Rules List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Keyword & Regex Auto-Reply Rules
              </h2>
              <button type="button" onClick={() => openRuleModal()} className="btn-primary text-xs">
                <Plus className="w-3.5 h-3.5" />
                <span>New Rule</span>
              </button>
            </div>

            {rules.length === 0 ? (
              <EmptyState
                title="No auto-reply rules defined"
                description="Create keyword, exact, or regular expression rules with cooldowns and template variables."
                icon={Bot}
                action={
                  <button type="button" onClick={() => openRuleModal()} className="btn-primary text-xs">
                    <span>Create First Rule</span>
                  </button>
                }
              />
            ) : (
              <div className="space-y-3">
                {rules.map((r) => (
                  <div key={r.id} className="surface-card p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{r.name}</span>
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-violet-500/15 text-violet-400">
                            {r.match_mode}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)]">Priority {r.priority}</span>
                          {r.require_human_approval && (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400">
                              Human Review
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.keywords.map((kw, idx) => (
                            <code
                              key={idx}
                              className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-cyan-500 dark:text-cyan-300"
                            >
                              {kw}
                            </code>
                          ))}
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={r.is_enabled}
                          onChange={async (e) => {
                            await api.patch(`/automation/rules/${r.id}/`, { is_enabled: e.target.checked });
                            void loadAutomation();
                          }}
                        />
                        <span>{r.is_enabled ? "On" : "Off"}</span>
                      </label>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] surface-elevated p-2.5">
                      {r.response_template}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1">
                      <span>
                        Hits: {r.hit_count} · Cooldown: {r.cooldown_minutes}m
                      </span>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await api.post(`/automation/rules/${r.id}/duplicate/`);
                            toast.success("Rule Duplicated");
                            void loadAutomation();
                          }}
                          className="btn-secondary text-xs py-1 px-2"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Duplicate</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openRuleModal(r)}
                          className="btn-secondary text-xs py-1 px-2"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.delete(`/automation/rules/${r.id}/`);
                            toast.info("Rule Deleted");
                            void loadAutomation();
                          }}
                          className="btn-secondary text-xs py-1 px-2 text-rose-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Dry-Run Tester */}
          <GlowCard active className="h-fit space-y-3.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Play className="w-4 h-4 text-cyan-400" />
              <span>Live Rule & Policy Dry-Run Tester</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Evaluates rules, active mode, schedule windows, and contact policies without sending any SMS.
            </p>
            <form onSubmit={handleRunDryTest} className="space-y-3">
              <div>
                <label htmlFor="dry-sender" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Sample Sender Number
                </label>
                <input
                  id="dry-sender"
                  type="text"
                  value={testSender}
                  onChange={(e) => setTestSender(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label htmlFor="dry-body" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Sample Incoming SMS Body
                </label>
                <textarea
                  id="dry-body"
                  rows={3}
                  value={testBody}
                  onChange={(e) => setTestBody(e.target.value)}
                  className="input-field text-xs"
                  required
                />
              </div>
              <button type="submit" disabled={testingRule} className="btn-primary w-full text-xs">
                {testingRule ? "Evaluating..." : "Run Dry-Run Evaluation"}
              </button>
            </form>

            {dryRunResult && (
              <div role="region" aria-label="Dry-run evaluation output" className="surface-elevated p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {dryRunResult.would_reply ? "Would Auto-Reply" : "No Reply Sent"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono">
                    {dryRunResult.decision}
                  </span>
                </div>
                {dryRunResult.matched_rule_name && (
                  <div>
                    <strong>Matched Rule:</strong> {dryRunResult.matched_rule_name} (
                    <code>{dryRunResult.matched_pattern}</code>)
                  </div>
                )}
                {dryRunResult.response_preview && (
                  <div className="p-2.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <div className="text-[10px] uppercase text-[var(--text-muted)] mb-0.5">Rendered Reply</div>
                    <div>{dryRunResult.response_preview}</div>
                  </div>
                )}
                {dryRunResult.diagnostics?.length > 0 && (
                  <ul className="text-[11px] font-mono text-[var(--text-secondary)] space-y-0.5">
                    {dryRunResult.diagnostics.map((d, i) => (
                      <li key={i}>• {d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </GlowCard>
        </div>
      ) : tab === "modes" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" onClick={() => openModeModal()} className="btn-primary text-xs">
              <Plus className="w-3.5 h-3.5" />
              <span>Create Custom Mode</span>
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modes.map((m) => (
              <GlowCard key={m.id} active={m.is_active} className="flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{m.name}</h3>
                    {m.is_active ? (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/35">
                        Active Now
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {m.is_builtin ? "Built-in" : "Custom"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    {m.description || `Method: ${m.response_method}`}
                  </p>
                  <div className="mt-2.5 text-[11px] text-[var(--text-muted)] space-y-1">
                    <div>Strategy: <code>{m.response_method}</code></div>
                    {m.response_template && <div className="truncate">Template: “{m.response_template}”</div>}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  {!m.is_active ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.post(`/automation/modes/${m.id}/activate/`);
                        toast.success("Mode Activated", m.name);
                        void loadAutomation();
                      }}
                      className="btn-primary text-xs py-1 px-3"
                    >
                      Activate
                    </button>
                  ) : (
                    <span className="text-xs text-emerald-400 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Running
                    </span>
                  )}
                  <div className="inline-flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => openModeModal(m)}
                      className="btn-secondary text-xs py-1 px-2.5"
                    >
                      Configure
                    </button>
                    {!m.is_builtin && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.delete(`/automation/modes/${m.id}/`);
                          void loadAutomation();
                        }}
                        className="btn-secondary text-xs py-1 px-2 text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </GlowCard>
            ))}
          </div>
        </div>
      ) : tab === "schedules" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setSchedEvalMsg(null);
                setSchedModalOpen(true);
              }}
              className="btn-primary text-xs"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>New Schedule Window</span>
            </button>
          </div>
          {schedules.length === 0 ? (
            <EmptyState
              title="No schedule windows yet"
              description="Define recurring weekday/time windows in IANA timezones (including overnight spans like 22:00–06:30)."
              icon={CalendarClock}
              action={
                <button type="button" onClick={() => setSchedModalOpen(true)} className="btn-primary text-xs">
                  <span>Add Schedule Window</span>
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {schedules.map((s) => (
                <div key={s.id} className="surface-card p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          s.is_currently_active
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-slate-500/15 text-[var(--text-muted)]"
                        }`}
                      >
                        {s.is_currently_active ? "Active Now" : "Outside Window"}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
                      {s.start_time} – {s.end_time} ({s.timezone})
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Days: {s.days_of_week.map((d) => WEEKDAYS[d]).join(", ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.delete(`/automation/schedules/${s.id}/`);
                      void loadAutomation();
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
      ) : (
        /* AI Providers & Prompt Lab */
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Configured AI Providers</h2>
                <button type="button" onClick={() => openProviderModal()} className="btn-primary text-xs">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Add AI Provider</span>
                </button>
              </div>
              {providers.length === 0 ? (
                <EmptyState
                  title="No AI providers configured"
                  description="Add OpenAI-compatible, Google Gemini, or the zero-key Deterministic Local Mock adapter."
                  icon={Cpu}
                  action={
                    <button type="button" onClick={() => openProviderModal()} className="btn-primary text-xs">
                      <span>Configure AI Adapter</span>
                    </button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {providers.map((p) => (
                    <div key={p.id} className="surface-card p-4 space-y-2.5">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{p.name}</span>
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-500/15 text-cyan-400">
                              {p.provider_type} · {p.model_name}
                            </span>
                            {p.simulate_failure && (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300">
                                Simulate Outage On
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] mt-1">
                            API Key:{" "}
                            <code className="font-mono">
                              {p.has_api_key ? p.masked_api_key : "None (Mock / Unset)"}
                            </code>{" "}
                            · Status: {p.last_test_status}
                          </div>
                        </div>
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await api.post<{ test_result: { ok?: boolean; detail?: string } }>(
                                `/automation/ai-providers/${p.id}/test-connection/`
                              );
                              toast.info("Connectivity Tested", res.test_result?.detail || "Completed");
                              void loadAutomation();
                            }}
                            className="btn-secondary text-xs py-1 px-2.5"
                          >
                            Test Connection
                          </button>
                          <button
                            type="button"
                            onClick={() => openProviderModal(p)}
                            className="btn-secondary text-xs py-1 px-2.5"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                      {p.last_error && (
                        <div className="text-xs text-rose-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>{p.last_error}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live AI Prompt Tester */}
            <GlowCard active className="space-y-3.5 h-fit">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span>Live AI Prompt & Fallback Tester</span>
              </h2>
              <form onSubmit={handleTestPrompt} className="space-y-3">
                <div>
                  <label htmlFor="ai-test-provider" className="block text-xs text-[var(--text-secondary)] mb-1">
                    Provider
                  </label>
                  <select
                    id="ai-test-provider"
                    value={promptProviderId}
                    onChange={(e) => setPromptProviderId(e.target.value)}
                    className="input-field text-xs"
                  >
                    <option value="">Select provider...</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.model_name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ai-test-prompt" className="block text-xs text-[var(--text-secondary)] mb-1">
                    Sample Student Question
                  </label>
                  <textarea
                    id="ai-test-prompt"
                    rows={3}
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    className="input-field text-xs"
                  />
                </div>
                <button type="submit" disabled={!promptProviderId} className="btn-primary w-full text-xs">
                  Generate Test Reply
                </button>
              </form>
              {promptOutput && (
                <div className="surface-elevated p-3 text-xs space-y-1.5">
                  <div className="flex justify-between text-[11px] text-[var(--text-muted)]">
                    <span>Latency: {String(promptOutput.latency_ms ?? 0)}ms</span>
                    <span>{promptOutput.used_fallback ? "Deterministic Fallback Used" : "AI Generated"}</span>
                  </div>
                  <div className="text-[var(--text-primary)] font-medium">
                    {String(promptOutput.reply_text || "")}
                  </div>
                </div>
              )}
            </GlowCard>
          </div>

          {/* AI Call Logs */}
          <div className="surface-card p-5">
            <h3 className="text-sm font-semibold mb-3">Recent AI Call & Fallback Logs ({aiLogs.length})</h3>
            {aiLogs.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No AI invocations logged yet.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {aiLogs.slice(0, 20).map((log) => (
                  <div key={log.id} className="surface-elevated p-2.5 text-xs flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-semibold">{log.provider_name || log.model_name}</span> ·{" "}
                      <span className="text-[var(--text-secondary)] truncate">{log.response_preview || log.error_message}</span>
                    </div>
                    <span className="font-mono text-[11px] shrink-0">
                      {log.status} ({log.latency_ms}ms)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rule Modal */}
      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title={editingRule ? "Edit Auto-Reply Rule" : "Create Auto-Reply Rule"}
        footer={
          <>
            <button type="button" onClick={() => setRuleModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="rule-builder-form" className="btn-primary">
              Save Rule
            </button>
          </>
        }
      >
        <form id="rule-builder-form" onSubmit={handleSaveRule} className="space-y-3.5">
          <div>
            <label htmlFor="rule-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Rule Name
            </label>
            <input
              id="rule-name"
              type="text"
              value={rName}
              onChange={(e) => setRName(e.target.value)}
              placeholder="Exam Timetable Inquiry"
              className="input-field"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rule-match-mode" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Match Strategy
              </label>
              <select
                id="rule-match-mode"
                value={rMatchMode}
                onChange={(e) => setRMatchMode(e.target.value as AutoReplyRuleRecord["match_mode"])}
                className="input-field"
              >
                <option value="contains">Contains Substring</option>
                <option value="exact">Exact Match</option>
                <option value="starts_with">Starts With</option>
                <option value="ends_with">Ends With</option>
                <option value="whole_word">Whole Word</option>
                <option value="regex">Regular Expression (Regex)</option>
              </select>
            </div>
            <div>
              <label htmlFor="rule-priority" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Priority (higher runs first)
              </label>
              <input
                id="rule-priority"
                type="number"
                value={rPriority}
                onChange={(e) => setRPriority(Number(e.target.value))}
                className="input-field"
              />
            </div>
          </div>
          <div>
            <label htmlFor="rule-keywords" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Keywords or Regex Patterns (comma-separated)
            </label>
            <input
              id="rule-keywords"
              type="text"
              value={rKeywords}
              onChange={(e) => setRKeywords(e.target.value)}
              placeholder="opening hours, office hours"
              className="input-field font-mono"
              required
            />
          </div>
          <div>
            <label htmlFor="rule-template" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Response Template (supports {"{{contact_name}}"}, {"{{sender_number}}"}, {"{{mode_name}}"})
            </label>
            <textarea
              id="rule-template"
              rows={3}
              value={rTemplate}
              onChange={(e) => setRTemplate(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rule-cooldown" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Sender Cooldown (minutes)
              </label>
              <input
                id="rule-cooldown"
                type="number"
                min={0}
                value={rCooldown}
                onChange={(e) => setRCooldown(Number(e.target.value))}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="rule-schedule" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Schedule Window (Optional)
              </label>
              <select
                id="rule-schedule"
                value={rScheduleId}
                onChange={(e) => setRScheduleId(e.target.value)}
                className="input-field"
              >
                <option value="">24/7 Always Active</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={rHumanApproval}
              onChange={(e) => setRHumanApproval(e.target.checked)}
            />
            <span>Hold reply in Human Approval Queue before sending</span>
          </label>
        </form>
      </Modal>

      {/* Mode Modal */}
      <Modal
        open={modeModalOpen}
        onClose={() => setModeModalOpen(false)}
        title={editingMode ? `Configure Mode — ${editingMode.name}` : "Create Custom Mode"}
        footer={
          <>
            <button type="button" onClick={() => setModeModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="mode-form" className="btn-primary">
              Save Mode
            </button>
          </>
        }
      >
        <form id="mode-form" onSubmit={handleSaveMode} className="space-y-3.5">
          <div>
            <label htmlFor="mode-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Mode Name
            </label>
            <input
              id="mode-name"
              type="text"
              value={mName}
              onChange={(e) => setMName(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <label htmlFor="mode-method" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Response Method
            </label>
            <select
              id="mode-method"
              value={mMethod}
              onChange={(e) => setMMethod(e.target.value as AutomationModeRecord["response_method"])}
              className="input-field"
            >
              <option value="rules_only">Keyword & Regex Rules Only</option>
              <option value="rules_then_template">Rules First, Then Mode Template</option>
              <option value="template_only">Mode Template Auto-Reply Only</option>
              <option value="rules_then_ai">Rules First, Then AI Responder</option>
              <option value="ai_only">AI-Generated Response Only</option>
            </select>
          </div>
          <div>
            <label htmlFor="mode-template" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Mode Auto-Reply Template
            </label>
            <textarea
              id="mode-template"
              rows={3}
              value={mTemplate}
              onChange={(e) => setMTemplate(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Schedule Window</label>
              <select
                value={mScheduleId}
                onChange={(e) => setMScheduleId(e.target.value)}
                className="input-field text-xs"
              >
                <option value="">Always Active When Selected</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">AI Provider</label>
              <select
                value={mAiProviderId}
                onChange={(e) => setMAiProviderId(e.target.value)}
                className="input-field text-xs"
              >
                <option value="">Default Enabled Provider</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={mHumanApproval}
              onChange={(e) => setMHumanApproval(e.target.checked)}
            />
            <span>Require Human Approval before transmitting replies in this mode</span>
          </label>
        </form>
      </Modal>

      {/* Schedule Modal */}
      <Modal
        open={schedModalOpen}
        onClose={() => setSchedModalOpen(false)}
        title="Create Schedule Window"
        footer={
          <>
            <button type="button" onClick={handleValidateSchedule} className="btn-secondary text-xs">
              Validate Active State Now
            </button>
            <button type="submit" form="schedule-form" className="btn-primary text-xs">
              Save Schedule
            </button>
          </>
        }
      >
        <form id="schedule-form" onSubmit={handleSaveSchedule} className="space-y-3.5">
          <div>
            <label htmlFor="sched-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Window Name
            </label>
            <input
              id="sched-name"
              type="text"
              value={sName}
              onChange={(e) => setSName(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Active Weekdays</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day, idx) => {
                const active = sDays.includes(idx);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      setSDays((prev) => (active ? prev.filter((d) => d !== idx) : [...prev, idx].sort()))
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                      active ? "bg-violet-600 text-white" : "surface-elevated text-[var(--text-secondary)]"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Start Time</label>
              <input
                type="time"
                value={sStart}
                onChange={(e) => setSStart(e.target.value)}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">End Time</label>
              <input
                type="time"
                value={sEnd}
                onChange={(e) => setSEnd(e.target.value)}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Timezone</label>
              <input type="text" value={sTz} onChange={(e) => setSTz(e.target.value)} className="input-field" />
            </div>
          </div>
          {schedEvalMsg && <div className="surface-elevated p-2.5 text-xs text-cyan-400">{schedEvalMsg}</div>}
        </form>
      </Modal>

      {/* AI Provider Modal */}
      <Modal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        title={editingProvider ? `Edit AI Provider — ${editingProvider.name}` : "Add AI Provider"}
        footer={
          <>
            <button type="button" onClick={() => setAiModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="ai-provider-form" className="btn-primary">
              Save AI Provider
            </button>
          </>
        }
      >
        <form id="ai-provider-form" onSubmit={handleSaveProvider} className="space-y-3.5">
          <div>
            <label htmlFor="ai-prov-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Provider Display Name
            </label>
            <input
              id="ai-prov-name"
              type="text"
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ai-prov-type" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Adapter Type
              </label>
              <select
                id="ai-prov-type"
                value={pType}
                onChange={(e) => {
                  const next = e.target.value as AIProviderRecord["provider_type"];
                  setPType(next);
                  const defaults = supportedModels[next];
                  if (defaults && defaults.length > 0) setPModel(defaults[0]);
                }}
                className="input-field"
              >
                <option value="deterministic_mock">Deterministic Local Mock (No Key)</option>
                <option value="openai_compatible">OpenAI-Compatible API</option>
                <option value="gemini">Google Gemini API</option>
              </select>
            </div>
            <div>
              <label htmlFor="ai-prov-model" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Model Name
              </label>
              <input
                id="ai-prov-model"
                type="text"
                value={pModel}
                onChange={(e) => setPModel(e.target.value)}
                className="input-field font-mono"
                required
              />
            </div>
          </div>

          {pType !== "deterministic_mock" && (
            <>
              <div>
                <label htmlFor="ai-prov-url" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  API Base URL
                </label>
                <input
                  id="ai-prov-url"
                  type="url"
                  value={pBaseUrl}
                  onChange={(e) => setPBaseUrl(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label htmlFor="ai-prov-key" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  API Key{" "}
                  {editingProvider?.has_api_key && (
                    <span className="text-emerald-400">
                      (Saved: {editingProvider.masked_api_key} — leave blank to keep existing secret)
                    </span>
                  )}
                </label>
                <input
                  id="ai-prov-key"
                  type="password"
                  value={pApiKey}
                  onChange={(e) => setPApiKey(e.target.value)}
                  placeholder={editingProvider?.has_api_key ? "Leave blank to keep stored key" : "sk-..."}
                  className="input-field font-mono"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="ai-prov-inst" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              System Instructions (SMS Conciseness Guardrail)
            </label>
            <textarea
              id="ai-prov-inst"
              rows={2}
              value={pSystemInst}
              onChange={(e) => setPSystemInst(e.target.value)}
              className="input-field text-xs"
            />
          </div>
          <div>
            <label htmlFor="ai-prov-fallback" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Deterministic Fallback Message (used if provider errors or times out)
            </label>
            <textarea
              id="ai-prov-fallback"
              rows={2}
              value={pFallback}
              onChange={(e) => setPFallback(e.target.value)}
              className="input-field text-xs"
            />
          </div>
          <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={pSimFailure} onChange={(e) => setPSimFailure(e.target.checked)} />
            <span>Simulate provider outage (verify deterministic fallback behavior)</span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
