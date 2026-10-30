export type ThemeMode = "dark" | "light" | "system";

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  organization: string;
  timezone: string;
  default_country_code: string;
  theme_preference: ThemeMode;
  email_verified: boolean;
  onboarding_completed: boolean;
  global_automation_enabled: boolean;
  global_ai_enabled: boolean;
  default_execution_mode: "simulation" | "sim_gateway" | "external_provider" | string;
  message_retention_days: number;
  store_inbound_message_body: boolean;
  require_consent_for_campaigns: boolean;
  daily_real_sms_limit: number;
  mfa_enabled: boolean;
  created_at: string;
}

export interface AuthSessionResponse {
  user: UserProfile;
  access: string;
  refresh: string;
  session_id: string;
}

export interface UserSessionRecord {
  id: string;
  device_label: string;
  ip_address: string | null;
  user_agent: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  is_current: boolean;
}

export interface AnalyticsOverview {
  window_days: number;
  gateway_summary: {
    paired_devices: number;
    online_devices: number;
    sim_ready_devices: number;
  };
  message_summary: {
    real_outbound_submitted: number;
    real_outbound_delivered_confirmed: number;
    real_outbound_queued: number;
    real_outbound_failed: number;
    real_inbound_received: number;
    simulated_outbound: number;
    simulated_inbound: number;
    pending_human_approval: number;
  };
  contacts_summary: {
    total_contacts: number;
    opted_in_contacts: number;
    suppressed_or_opted_out: number;
    groups_count: number;
  };
  automation_summary: {
    global_automation_enabled: boolean;
    global_ai_enabled: boolean;
    active_mode: string;
    enabled_rules_count: number;
    total_rule_hits: number;
    auto_replies_sent: number;
    ai_calls_count: number;
    ai_errors_or_fallbacks: number;
  };
  campaigns_summary: {
    total_campaigns: number;
    running_campaigns: number;
    completed_campaigns: number;
    paused_or_scheduled: number;
  };
  webhooks_summary: {
    delivered: number;
    retrying: number;
    dead_letter: number;
  };
  status_breakdown: Array<{ status: string; is_simulation: boolean; count: number }>;
  direction_breakdown: Array<{ direction: string; is_simulation: boolean; count: number }>;
  timeseries: Array<{
    date: string;
    real_outbound: number;
    real_inbound: number;
    sim_outbound: number;
    sim_inbound: number;
  }>;
}

export interface SimSlotInfo {
  slot_index?: number;
  slot?: number;
  carrier_name?: string;
  phone_number?: string;
  country_iso?: string;
  is_active?: boolean;
}

export interface DeviceRecord {
  id: string;
  name: string;
  device_identity: string;
  platform: "android" | "ios" | string;
  manufacturer: string;
  device_model: string;
  os_version: string;
  app_version: string;
  gateway_token_prefix: string;
  is_enabled: boolean;
  is_paused: boolean;
  connection_status: "online" | "offline" | "paused" | "revoked" | string;
  is_online: boolean;
  can_transmit_real_sms: boolean;
  sim_available: boolean;
  sim_slots: SimSlotInfo[];
  selected_sim_slot: number;
  network_type: string;
  carrier_name: string;
  battery_level: number | null;
  is_charging: boolean;
  is_default_sms_app: boolean;
  permissions_state: Record<string, boolean>;
  incoming_message_count: number;
  outgoing_message_count: number;
  failed_transmission_count: number;
  pending_jobs_count: number;
  recent_events: Array<{ timestamp?: string; type?: string; message?: string; summary?: string }>;
  last_error: string;
  recommended_action: string;
  last_heartbeat_at: string | null;
  last_synced_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PairingInitResponse {
  pairing_id: string;
  pairing_code: string;
  qr_payload: string;
  device_name_hint: string;
  expires_at: string;
  ttl_seconds: number;
}

export type TransportType = "simulation" | "sim_gateway" | "external_provider";

export type MessageStatus =
  | "pending_approval"
  | "queued"
  | "dispatched_to_device"
  | "submitted"
  | "delivered"
  | "delivery_unknown"
  | "simulated_sent"
  | "simulated_delivered"
  | "simulated_received"
  | "received"
  | "failed"
  | "expired"
  | "canceled";

export interface MessageDeliveryEvent {
  id: string;
  event_type: string;
  raw_status_code: string;
  description: string;
  is_simulation: boolean;
  occurred_at: string;
}

export interface MessageAttempt {
  id: string;
  attempt_number: number;
  device: string | null;
  transport_type: TransportType;
  sim_slot: number | null;
  status: string;
  claimed_at: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  android_result_code: string;
  error_detail: string;
}

export interface MessageRecord {
  id: string;
  direction: "inbound" | "outbound";
  transport_type: TransportType;
  is_simulation: boolean;
  sender_number: string;
  recipient_number: string;
  contact: string | null;
  contact_name: string;
  device: string | null;
  device_name: string;
  sender_identity: string | null;
  campaign: string | null;
  triggered_by_rule: string | null;
  triggered_by_mode: string | null;
  in_reply_to: string | null;
  sim_slot: number | null;
  body: string;
  body_redacted: boolean;
  status: MessageStatus;
  matched_policy_summary: string;
  is_auto_reply: boolean;
  ai_generated: boolean;
  failure_code: string;
  failure_reason: string;
  scheduled_for: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  created_at: string;
  attempts: MessageAttempt[];
  delivery_events: MessageDeliveryEvent[];
}

export interface SenderIdentityConfig {
  id: string;
  label: string;
  identity_type: "sim_slot" | "external_provider";
  device: string | null;
  sim_slot: number;
  sim_phone_number_hint: string;
  provider_name: string;
  provider_base_url: string;
  alphanumeric_sender_id: string;
  country_code: string;
  registration_status: "sim_native" | "pending_registration" | "verified_active" | "dev_adapter";
  masked_provider_api_key: string;
  is_enabled: boolean;
  created_at: string;
}

export interface ContactGroupSummary {
  id: string;
  name: string;
  color: string;
}

export interface ContactRecord {
  id: string;
  name: string;
  phone_number: string;
  raw_phone_input: string;
  email: string;
  is_virtual: boolean;
  allow_outgoing: boolean;
  allow_auto_reply: boolean | null;
  allow_ai_reply: boolean | null;
  automation_mode: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  cooldown_minutes: number | null;
  opt_in_status: boolean;
  opt_in_at: string | null;
  opt_out_status: boolean;
  opt_out_at: string | null;
  tags: string[];
  notes: string;
  groups: ContactGroupSummary[];
  created_at: string;
  updated_at: string;
}

export interface EffectiveContactPolicy {
  phone_number: string;
  contact_id: string | null;
  contact_name: string;
  is_suppressed: boolean;
  is_opted_out: boolean;
  opt_in_status: boolean;
  can_send_outgoing: boolean;
  can_auto_reply: boolean;
  can_ai_reply: boolean;
  in_quiet_hours: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_source: string;
  effective_cooldown_minutes: number;
  cooldown_source: string;
  effective_mode_id: string | null;
  effective_mode_name: string;
  effective_mode_source: string;
  groups: Array<{ id: string; name: string }>;
  blocking_reasons: string[];
  inheritance_trace: string[];
}

export interface ContactGroupRecord {
  id: string;
  name: string;
  description: string;
  color: string;
  allow_outgoing: boolean;
  allow_auto_reply: boolean;
  allow_ai_reply: boolean;
  automation_mode: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  cooldown_minutes: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface SuppressionRecord {
  id: string;
  phone_number: string;
  reason: "opt_out" | "manual_block" | "invalid_number" | "carrier_bounce";
  notes: string;
  created_at: string;
}

export interface ScheduleWindow {
  id: string;
  name: string;
  timezone: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  effective_from: string | null;
  effective_until: string | null;
  is_currently_active: boolean;
  created_at: string;
}

export interface AutomationModeRecord {
  id: string;
  name: string;
  slug: string;
  is_builtin: boolean;
  description: string;
  icon: string;
  is_enabled: boolean;
  is_active: boolean;
  priority: number;
  response_method: "rules_only" | "template_only" | "ai_only" | "rules_then_ai" | "rules_then_template";
  response_template: string;
  ai_provider: string | null;
  ai_override_instructions: string;
  schedule: string | null;
  schedule_details?: ScheduleWindow | null;
  selected_groups: string[];
  allowed_contacts: string[];
  blocked_contacts: string[];
  cooldown_minutes: number;
  max_replies_per_sender_per_day: number;
  require_human_approval: boolean;
  fallback_behavior: "send_fallback" | "no_reply";
  fallback_text: string;
  created_at: string;
  updated_at: string;
}

export interface AutoReplyRuleRecord {
  id: string;
  name: string;
  is_enabled: boolean;
  match_mode: "exact" | "contains" | "starts_with" | "ends_with" | "whole_word" | "regex";
  keywords: string[];
  case_sensitive: boolean;
  allowed_senders: string[];
  restricted_contacts: string[];
  restricted_groups: string[];
  apply_in_modes: string[];
  schedule: string | null;
  schedule_details?: ScheduleWindow | null;
  response_template: string;
  custom_variables: Record<string, string>;
  priority: number;
  cooldown_minutes: number;
  max_responses_per_day: number;
  require_human_approval: boolean;
  expires_at: string | null;
  hit_count: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuleDryRunResult {
  would_reply: boolean;
  decision: string;
  reason?: string;
  matched_rule_id?: string | null;
  matched_rule_name?: string;
  matched_pattern?: string;
  matched_mode_name?: string;
  require_human_approval?: boolean;
  response_preview: string | null;
  effective_policy?: EffectiveContactPolicy;
  diagnostics: string[];
}

export interface AIProviderRecord {
  id: string;
  name: string;
  provider_type: "openai_compatible" | "gemini" | "deterministic_mock";
  api_base_url: string;
  masked_api_key: string;
  has_api_key: boolean;
  model_name: string;
  temperature: number;
  max_output_tokens: number;
  max_response_chars: number;
  timeout_seconds: number;
  max_retries: number;
  is_enabled: boolean;
  simulate_failure: boolean;
  system_instructions: string;
  fallback_message: string;
  last_tested_at: string | null;
  last_test_status: "untested" | "ok" | "error";
  last_error: string;
  created_at: string;
}

export interface AICallLogRecord {
  id: string;
  provider: string | null;
  provider_name: string;
  inbound_message: string | null;
  model_name: string;
  status: "success" | "fallback_used" | "error" | "timeout" | "blocked_safety";
  latency_ms: number;
  prompt_chars: number;
  response_chars: number;
  response_preview: string;
  error_message: string;
  is_test: boolean;
  created_at: string;
}

export interface CampaignStats {
  total_input_recipients: number;
  duplicates_removed: number;
  total_recipients: number;
  eligible_recipients: number;
  excluded_recipients: number;
  pending_messages: number;
  queued_messages: number;
  transmission_attempts: number;
  submitted_messages: number;
  delivery_confirmed_messages: number;
  simulated_sent_messages: number;
  simulated_delivered_messages: number;
  unknown_delivery_messages: number;
  failed_messages: number;
  canceled_messages: number;
  expired_messages: number;
}

export interface BulkCampaignRecord {
  id: string;
  name: string;
  message_template: string;
  transport_type: TransportType;
  is_simulation: boolean;
  device: string | null;
  sender_identity: string | null;
  sim_slot: number | null;
  status: "draft" | "scheduled" | "running" | "paused" | "completed" | "canceled" | "failed";
  timezone: string;
  scheduled_at: string | null;
  expires_at: string | null;
  inter_message_interval_ms: number;
  max_volume: number;
  recipient_cooldown_minutes: number;
  operating_window_start: string | null;
  operating_window_end: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  max_retries: number;
  error_pause_threshold_pct: number;
  simulated_outcome: string;
  pause_reason: string;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  created_at: string;
  stats: CampaignStats;
}

export interface AudiencePreviewResponse {
  total_input_count: number;
  duplicate_removed_count: number;
  eligible_count: number;
  excluded_count: number;
  sample_preview: string;
  excluded_preview: Array<{ phone_number: string; name: string; reason: string }>;
  eligible_preview: Array<{ phone_number: string; name: string; rendered_body: string }>;
}

export interface CampaignRecipientRecord {
  id: string;
  contact: string | null;
  message: string | null;
  phone_number: string;
  recipient_name: string;
  rendered_body: string;
  status: string;
  exclusion_reason: string;
  error_detail: string;
  attempts_count: number;
  processed_at: string | null;
  delivered_at: string | null;
}

export interface APIKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  simulation_only: boolean;
  rate_limit_per_minute: number;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  is_active_key: boolean;
  created_at: string;
  raw_key?: string;
}

export interface WebhookEndpointRecord {
  id: string;
  name: string;
  url: string;
  events: string[];
  include_simulation_events: boolean;
  timeout_seconds: number;
  is_active: boolean;
  masked_signing_secret: string;
  secret_rotated_at: string | null;
  created_at: string;
  signing_secret?: string;
}

export interface WebhookDeliveryAttempt {
  id: string;
  attempt_number: number;
  request_headers: Record<string, string>;
  response_status_code: number | null;
  response_body_preview: string;
  latency_ms: number;
  succeeded: boolean;
  error_message: string;
  created_at: string;
}

export interface WebhookEventRecord {
  id: string;
  endpoint: string;
  endpoint_name: string;
  endpoint_url: string;
  event_uid: string;
  event_type: string;
  is_simulation: boolean;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "retrying" | "dead_letter";
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  last_error: string;
  created_at: string;
  attempts: WebhookDeliveryAttempt[];
}

export interface NotificationRecord {
  id: string;
  category: string;
  level: "info" | "success" | "warning" | "error" | string;
  title: string;
  body: string;
  action_url: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface AuditEventRecord {
  id: string;
  actor_type: string;
  actor_identifier: string;
  event_type: string;
  target_type: string;
  target_id: string;
  ip_address: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
