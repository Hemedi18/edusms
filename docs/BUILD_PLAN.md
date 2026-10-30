# EduSMS — Master Build Plan

## 1. Executive Summary

**EduSMS** is an integrated, programmable SMS gateway and intelligent messaging automation platform built for developers, students, researchers, and startups. It enables users to connect a physical Android phone with an active SIM card as an authenticated SMS gateway—or develop and test completely free of carrier charges using an isolated **Simulation Mode**—while managing contacts, consent policies, rule-based and AI-powered auto-replies, automation modes, throttled bulk SMS campaigns, scoped developer APIs, and HMAC-signed webhooks through both a **Flutter mobile application** and a **React TypeScript web dashboard**.

---

## 2. Monorepo Structure & File Ownership

To ensure clean modularity and zero edit conflicts across components and subagents, the repository is organized with strict directory ownership:

```text
fullsmsgateway/
├── .env.example                 # Documented environment configuration template
├── .gitignore                   # Git ignore rules across Python, Node, Flutter, Android, Docker
├── docker-compose.yml           # Production-like local stack: PostgreSQL, Redis, Django/Daphne, Celery Worker, Celery Beat, Web
├── Makefile                     # Developer workflow shortcuts (setup, dev, migrate, seed, test, lint)
├── README.md                    # Complete setup, architecture, run, and troubleshooting guide
├── scripts/                     # Helper scripts for local PostgreSQL/Redis dev services and DB backup/restore
├── docs/                        # Comprehensive engineering documentation
│   ├── BUILD_PLAN.md            # Architecture, modules, API contracts, phases, QA strategy
│   ├── ARCHITECTURE.md          # Data flows, transport isolation, state machines, security boundaries
│   ├── API.md                   # REST API reference, authentication, scopes, webhooks, examples
│   ├── SECURITY.md              # Cryptography, SSRF protection, token lifecycle, consent & privacy
│   ├── ANDROID_GATEWAY.md       # Native Kotlin telephony architecture, permissions, Play policy notes, iOS boundaries
│   └── TESTING.md               # Unit, integration, E2E workflow tests, and real-device test matrix
├── backend/                     # Owner: Backend Team / Agent
│   ├── manage.py
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── Dockerfile
│   ├── edusms/                  # Settings, ASGI (Django + Channels), Celery, URLs
│   └── apps/
│       ├── core/                # Encryption, SSRF guard, audit, notifications, pagination, idempotency
│       ├── accounts/            # Auth, JWT rotation, sessions, TOTP MFA, verification, export/delete
│       ├── devices/             # Pairing (code/QR), heartbeats, SIM metadata, job polling/ack, gateway events
│       ├── contacts/            # Contacts, groups, +255/E.164 normalization, consent/suppression, policy inheritance
│       ├── messaging/           # Messages, attempts, delivery events, Transport adapters, Sender IDs, Simulation Lab
│       ├── automation/          # Modes, schedules, keyword/regex rules, templates, AI adapters, safety & human review
│       ├── campaigns/           # Bulk campaigns, audience resolver, Celery throttled dispatch, pause/cancel, reports
│       ├── developers/          # Scoped API keys (SHA-256), Webhooks (HMAC-SHA256, SSRF block, retries, replay guard)
│       └── analytics/           # Time-series metrics, gateway health, status breakdowns, rule/AI stats
├── web/                         # Owner: Web Frontend Team / Agent
│   ├── package.json
│   ├── vite.config.ts
│   ├── Dockerfile
│   └── src/                     # React 19 + TypeScript + Tailwind CSS v4 + WebSocket live sync + Vitest tests
└── mobile/                      # Owner: Mobile & Native Android Team / Agent
    ├── pubspec.yaml
    ├── lib/                     # Flutter + Material 3 + Riverpod + GoRouter + Dio + SecureStorage
    ├── android/                 # Native Kotlin SMS gateway (SmsManager, SubscriptionManager, BroadcastReceiver, ForegroundService)
    ├── ios/                     # Companion app configuration with explicit platform capability boundaries
    └── test/                    # Flutter unit & widget tests with mock adapters
```

---

## 3. Core Modules & Responsibilities

### 3.1 `apps.accounts` — Authentication, Sessions & Privacy
- Email + password registration and login using Argon2 / PBKDF2 password hashing.
- JWT access tokens (short-lived) + rotating SimpleJWT refresh tokens with server-side `UserSession` tracking and token blacklisting on logout/revocation.
- Email verification token issuance and verification endpoint.
- Password reset token issuance and confirmation endpoint.
- Optional TOTP Multi-Factor Authentication (`MFAConfig` with encrypted secret, provisioning URI, verification, and recovery codes).
- Full account data export (JSON archive of owned profile, contacts, messages, campaigns, rules) and GDPR-style account deletion.

### 3.2 `apps.devices` — Secure Gateway Pairing & Health
- `PairingSession`: cryptographically random 6-character alphanumeric pairing code + compact JSON QR payload (`pairing_id`, `code`, `server_url`, `expires_at`), single-use, 10-minute TTL, rate-limited.
- `Device`: issued a dedicated scoped gateway token (hashed at rest) upon pairing confirmation; stores device name, platform (`android` / `ios`), model, OS version, app version, SIM slot inventory (`sim_slots` JSON), network type, default-SMS-handler status, permission diagnostics, `is_enabled`, `is_paused`, `revoked_at`, and `last_heartbeat_at`.
- `GatewaySession`: tracks connection/heartbeat sessions and IP/transport metadata.
- Gateway endpoints strictly verify active, non-revoked device credentials; revoking a device immediately blocks job polling and event submission (`403 Forbidden`).

### 3.3 `apps.contacts` — Contacts, Groups, Consent & Effective Policy Engine
- Phone normalization into canonical E.164 format with first-class support for Tanzania local formats (`07XXXXXXXX`, `06XXXXXXXX`, `2557XXXXXXXX` -> `+2557XXXXXXXX`) alongside international `+` prefixes.
- `Contact`, `ContactGroup`, `GroupMembership` (many-to-many with timestamps).
- `ConsentRecord` (explicit opt-in / opt-out audit trail with source: manual, CSV, inbound `STOP`/`UNSUBSCRIBE` keyword) and `SuppressionRecord` (account-scoped hard block list).
- Per-contact and per-group settings: `allow_outgoing`, `allow_auto_reply`, `allow_ai_reply`, `automation_mode`, `quiet_hours_start`, `quiet_hours_end`, `cooldown_minutes`, `opt_in_status`, `opt_out_status`, `tags`, `notes`.
- Deterministic `resolve_effective_contact_policy(contact)` endpoint and service showing exact inherited vs overridden settings and blocking reasons.

### 3.4 `apps.messaging` — Transport Isolation, Sender Identity & Simulation Lab
- **Three Strictly Isolated Transports**:
  1. `SimGatewayTransport`: Enqueues outbound jobs for a paired, online (or queued-with-expiry) Android gateway. Never marks a message `submitted` until the handset reports `SmsManager` acceptance, and never marks `delivered` unless an actual carrier delivery PDU arrives.
  2. `ExternalProviderTransport`: Clean interface for registered external SMS providers supporting verified alphanumeric Sender IDs where country regulations permit; includes a clearly labelled development adapter when live third-party provider credentials are not configured.
  3. `SimulationTransport`: Completely isolated sandbox transport. Never creates `SimGatewayTransport` jobs, never touches real carrier channels, and exclusively uses `simulated_sent`, `simulated_delivered`, `simulated_received`, or simulated `failed`/`delivery_unknown` outcomes.
- `SenderIdentityConfig`: Explicitly distinguishes physical SIM slot identity (carrier-assigned MSISDN, non-spoofable) from external provider Sender ID registrations with country compliance disclosures.
- **Simulation Lab**: Virtual recipient creation, sample inbound SMS injection (triggering real rule/mode/AI evaluation safely in simulation mode), configurable outbound outcome simulation (`simulated_delivered`, `failed`, `delivery_unknown`, delayed), demo dataset seeding, and one-click simulation data reset.

### 3.5 `apps.automation` — Modes, Deterministic Rules & Safe AI Engine
- **Built-in Modes** (auto-provisioned per user and fully editable): `Default`, `Meeting`, `Focus`, `Vacation`, `Sleeping`, and `Custom`.
- `ScheduleWindow`: timezone-aware (`zoneinfo`) day-of-week, start/end time, and optional effective date range evaluation.
- `AutoReplyRule`: `exact`, `contains`, `starts_with`, `ends_with`, `whole_word`, and `regex` (with catastrophic-backtracking timeout/length guard), case sensitivity toggle, sender/contact/group filters, priority, per-sender cooldown, max responses per hour/day, expiration, and safe `{{contact_name}}`, `{{phone_number}}`, `{{current_time}}`, `{{current_date}}`, `{{mode_name}}` template rendering.
- **AI Provider Engine**:
  - `AIProviderConfig` with Fernet-encrypted API key at rest (masked in all responses, e.g. `sk-...9f2a`).
  - Supports `openai_compatible` (OpenAI, Ollama, Groq, Together, OpenRouter with SSRF-validated base URL), `gemini`, and `deterministic_mock` (for offline/free testing).
  - Prompt-injection isolation: wraps inbound SMS inside untrusted delimiters, strips control sequences, enforces strict system instructions, enforces `max_output_chars` (default 320 chars), never exposes tools/DB/keys, prevents replies to outbound/automated numbers (shortcode & loop detection), and supports `require_human_approval` mode (`pending_approval` queue).

### 3.6 `apps.campaigns` — Consent-Aware Bulk SMS Campaigns
- `BulkCampaign` & `CampaignRecipient`: builds audiences from individual contacts, multiple groups, and permitted CSV rows; deduplicates by canonical E.164 phone; automatically excludes suppressed/opted-out/disallowed/invalid contacts with transparent exclusion reasons.
- Celery orchestration: respects `scheduled_at`, timezone `operating_window_start`/`end`, `quiet_hours`, `inter_message_interval_ms`, `max_volume`, `recipient_cooldown_minutes`, `expires_at`, and `error_pause_threshold_pct`.
- Concurrency-safe `select_for_update(skip_locked=True)` batch claiming, idempotent recipient dispatch, instant `pause`, `resume`, `cancel` (immediately halting all remaining `pending`/`queued` recipients), and CSV report export.

### 3.7 `apps.developers` & `apps.analytics` — API Keys, Webhooks & Telemetry
- `APIKey`: prefixed (`edusms_live_...` / `edusms_sim_...`), raw key returned **once** at creation, stored as SHA-256 digest + key prefix, scoped (`messages:read`, `messages:write`, `contacts:read`, `contacts:write`, `campaigns:read`, `campaigns:write`, `simulation:write`, `analytics:read`), per-minute rate limit, `last_used_at`, revocation, and rotation.
- `WebhookEndpoint`, `WebhookEvent`, `WebhookDeliveryAttempt`:
  - SSRF protection blocking loopback (`127.0.0.0/8`, `::1`), RFC1918 private networks, link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`), multicast, and DNS rebinding/redirects on custom URLs.
  - Signs payloads with `X-EduSMS-Signature: t=<unix_ts>,v1=<hmac_sha256>` and `X-EduSMS-Event-Id` for replay protection.
  - Exponential backoff Celery retries (max 5 attempts) transitioning permanently failing events to `dead_letter`, plus manual retry and secret rotation.

---

## 4. Shared `/api/v1/` Contract Conventions

- **Base URL**: `/api/v1/`
- **Authentication**:
  - User JWT: `Authorization: Bearer <access_token>`
  - External Developer API Key: `X-API-Key: edusms_...` (or `Authorization: Api-Key edusms_...`)
  - Paired Android Gateway Token: `X-Gateway-Token: edugw_...`
- **Idempotency**: Mutating message and campaign creation endpoints accept `Idempotency-Key: <string>` header (or `idempotency_key` body field) scoped per user.
- **Pagination**: `{ "count": 42, "next": "...", "previous": "...", "results": [...] }`
- **Error Envelope**:
  ```json
  {
    "error": {
      "code": "validation_error",
      "message": "Human-readable summary",
      "details": { "field": ["Specific issue"] }
    }
  }
  ```
- **Realtime WebSocket**: `/ws/events/?token=<jwt_access_token>` broadcasts account-scoped JSON events (`device.status`, `message.updated`, `campaign.progress`, `automation.mode_changed`, `notification.created`) with automatic REST polling fallback if disconnected.

### Endpoint Summary
| Group | Base Path | Key Operations |
|---|---|---|
| Auth & Accounts | `/api/v1/auth/` | `register/`, `login/`, `refresh/`, `logout/`, `verify-email/`, `password-reset/`, `password-reset/confirm/`, `me/`, `sessions/`, `mfa/setup/`, `mfa/verify/`, `export/`, `delete-account/` |
| Devices & Gateway | `/api/v1/devices/` | `""` (list), `pair/init/`, `pair/confirm/`, `<id>/`, `<id>/pause/`, `<id>/resume/`, `<id>/revoke/`, `gateway/heartbeat/`, `gateway/jobs/poll/`, `gateway/jobs/<job_id>/ack/`, `gateway/inbound/`, `gateway/status-callback/` |
| Contacts & Groups | `/api/v1/contacts/`, `/api/v1/groups/` | CRUD, `import-csv/`, `export-csv/`, `<id>/effective-policy/`, `<id>/opt-in/`, `<id>/opt-out/`, `duplicates/`, `groups/<id>/members/`, `suppressions/` |
| Messages & Simulation | `/api/v1/messages/`, `/api/v1/simulation/` | `""` (list/send), `<id>/`, `<id>/cancel/`, `<id>/approve-reply/`, `<id>/reject-reply/`, `sender-identities/`, `simulation/inject-inbound/`, `simulation/send/`, `simulation/seed-demo/`, `simulation/reset/` |
| Automation & AI | `/api/v1/automation/` | `modes/`, `modes/<id>/activate/`, `rules/`, `rules/<id>/duplicate/`, `rules/test/`, `schedules/validate/`, `ai-providers/`, `ai-providers/<id>/test-connection/`, `ai-providers/<id>/test-prompt/`, `ai-logs/`, `global-toggle/` |
| Bulk Campaigns | `/api/v1/campaigns/` | `""` (list/create), `preview-audience/`, `<id>/`, `<id>/validate/`, `<id>/start/`, `<id>/pause/`, `<id>/resume/`, `<id>/cancel/`, `<id>/recipients/`, `<id>/export-csv/` |
| Developer Platform | `/api/v1/developers/` | `api-keys/`, `api-keys/<id>/rotate/`, `api-keys/<id>/revoke/`, `webhooks/`, `webhooks/<id>/test/`, `webhooks/<id>/rotate-secret/`, `webhook-deliveries/`, `webhook-deliveries/<id>/retry/` |
| Analytics & System | `/api/v1/analytics/`, `/api/v1/notifications/` | `analytics/overview/`, `analytics/timeseries/`, `notifications/`, `notifications/mark-all-read/`, `audit-events/`, `schema/`, `docs/` |

---

## 5. Implementation Phases

1. **Phase 1 — Foundation**: Workspace setup, documentation (`BUILD_PLAN.md`, `ARCHITECTURE.md`), Docker Compose, `.env.example`, Makefile, local PostgreSQL 18 + Redis 8 setup, Python `.venv`.
2. **Phase 2 — Authentication & Database**: Normalized Django models across all 25+ entities, database constraints/indexes, migrations on PostgreSQL, JWT auth + session rotation + MFA + privacy export/deletion, OpenAPI schema.
3. **Phase 3 — Device Gateway & Simulation Isolation**: Pairing codes/QR, hashed gateway credentials, heartbeats, SIM metadata, job polling/ack, inbound sync & deduplication, outbound status callbacks, and isolated Simulation Lab.
4. **Phase 4 — Core Messaging & Contacts**: `+255`/E.164 normalization, contacts/groups CRUD, CSV import/export, consent/suppression enforcement, effective policy resolver, inbox & outbound composer.
5. **Phase 5 — Intelligent Automation**: Built-in & custom modes, timezone schedules, keyword/regex rules, template variables, priority conflict resolver, encrypted AI provider adapters, prompt-injection safety, and human approval queue.
6. **Phase 6 — Bulk SMS Campaigns**: Audience preview, duplicate/opt-out filtering, Celery throttled dispatch, operating windows, error threshold auto-pause, pause/resume/cancel, CSV reporting.
7. **Phase 7 — Developer Integrations & Analytics**: Scoped hashed API keys, SSRF-hardened HMAC-SHA256 webhooks with retries & replay protection, analytics endpoints, Channels WebSockets.
8. **Phase 8 — Premium Web Dashboard (`web/`)**: React + TypeScript + Tailwind design system (dark/light/system themes, subtle electric violet/cyan/blue gradient glows, animations) implementing every required screen and workflow.
9. **Phase 9 — Flutter Mobile App & Native Android Gateway (`mobile/`)**: Material 3 + Riverpod + GoRouter + Dio + SecureStorage app across all 8 sections, native Kotlin `SmsManager`/`BroadcastReceiver`/`ForegroundService` integration, and honest iOS companion mode.
10. **Phase 10 — Quality Assurance & Delivery**: Pytest suite (including Workflows A–E), Web Vitest suite & build, Flutter analyzer & widget/unit tests, Kotlin/Gradle verification, complete docs (`API.md`, `SECURITY.md`, `ANDROID_GATEWAY.md`, `TESTING.md`, `README.md`).

---

## 6. Testing & Verification Strategy

- **Backend (`pytest` + `pytest-django`)**: Real PostgreSQL database constraint tests, account isolation boundaries, pairing expiry & revocation, inbound deduplication, rule & timezone schedule evaluation, AI fallback & injection sanitization, campaign opt-out & mid-flight cancellation, SSRF rejection on private/loopback/metadata IPs, HMAC signature & replay validation, API key scope & rate-limit checks, transport separation invariants, and complete end-to-end **Workflows A, B, C, D, and E**.
- **Web (`vitest` + `@testing-library/react` + `tsc -b` + `vite build`)**: Auth flows, theme persistence, responsive navigation, contact/group policy UI, automation rule & mode editors, campaign builder, API key one-time reveal, webhook management, simulation lab, loading/empty/error states.
- **Flutter & Android (`flutter analyze` + `flutter test`)**: Navigation shell, auth & validation, theme switching, device pairing & gateway status controls, automation controls, contact/group policies, campaign builder, offline/permission-denied states, with mock Dio and mock `MethodChannel` telephony adapters; clear documentation of physical SIM/carrier verification steps.
