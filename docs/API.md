# EduSMS — Developer API & Webhook Reference (`/api/v1/`)

EduSMS exposes a versioned REST API under `/api/v1/` and a real-time WebSocket event stream at `/ws/events/`. Machine-readable OpenAPI 3 schemas are generated via `drf-spectacular`:

- **OpenAPI 3 YAML/JSON**: `GET /api/v1/schema/` (also committed at `backend/openapi.yaml`)
- **Swagger UI**: `GET /api/v1/docs/`
- **ReDoc**: `GET /api/v1/redoc/`
- **Health Check**: `GET /health/`

---

## 1. Authentication Schemes

EduSMS separates authentication into three explicit security principals:

| Principal | Header | Format | Primary Use |
| :--- | :--- | :--- | :--- |
| **Interactive User Session** | `Authorization` | `Bearer <jwt_access_token>` | Web Dashboard & Flutter Mobile App |
| **External Developer API Key** | `X-API-Key` | `edusms_live_<token>` or `edusms_sim_<token>` | Server-to-server programmatic SMS, campaigns, simulation & analytics |
| **Paired Android SIM Gateway** | `X-Gateway-Token` | `edugw_<token>` | Handset heartbeat, job polling, inbound sync & radio callbacks |

### Scoped Developer API Keys (`X-API-Key`)

API keys are hashed with SHA-256 at rest; the raw key is returned **only once** upon creation or rotation.

Supported scopes:
- `messages:read` — List and inspect messages and delivery timelines
- `messages:write` — Submit outbound SMS messages (`POST /api/v1/messages/`)
- `simulation:write` — Inject simulated inbound SMS (`POST /api/v1/simulation/inject-inbound/`)
- `contacts:read` / `contacts:write` — Read or manage contacts
- `campaigns:read` / `campaigns:write` — Read or trigger bulk campaigns
- `analytics:read` — Query `/api/v1/analytics/overview/`

> [!IMPORTANT]
> Keys created with `simulation_only: true` carry the `edusms_sim_` prefix and are cryptographically & server-side restricted to `transport_type: "simulation"`. Attempting to submit `sim_gateway` or `external_provider` messages with an `edusms_sim_` key returns `400 Bad Request`.

---

## 2. Idempotency & Rate Limiting

### Idempotent Mutations (`Idempotency-Key`)
`POST /api/v1/messages/` and `POST /api/v1/campaigns/` accept an optional `Idempotency-Key` HTTP header (up to 128 chars):
- Repeating an identical request with the same `Idempotency-Key` within 24 hours returns the original `201 Created` payload with header `X-Idempotent-Replay: true` and **never** queues a duplicate SMS.
- Reusing the same `Idempotency-Key` with a different request body returns `409 Conflict`.

### Per-Key Rate Limiting
Developer API keys enforce a configurable sliding-window limit (`rate_limit_per_minute`, default `60`). Exceeding the limit returns `429 Too Many Requests`.

---

## 3. Core Endpoint Reference

### 3.1 Authentication & Account (`/api/v1/auth/`)
- `POST /api/v1/auth/register/` — Create account & issue initial `{ user, access, refresh, session_id }`
- `POST /api/v1/auth/login/` — Authenticate with `{ email, password, mfa_code?, device_label? }`
- `POST /api/v1/auth/refresh/` — Rotate refresh token & blacklist prior token JTI
- `POST /api/v1/auth/logout/` — Revoke session & blacklist refresh token
- `GET / PATCH /api/v1/auth/me/` — Retrieve or update user profile, timezone, default country code (`TZ` / `+255`), theme, retention days, and inbound body redaction policy
- `POST /api/v1/auth/change-password/` — Update password (`current_password`, `new_password`)
- `POST /api/v1/auth/verify-email/` & `POST /api/v1/auth/resend-verification/` — Single-use email verification flow
- `POST /api/v1/auth/password-reset/` & `POST /api/v1/auth/password-reset/confirm/` — Single-use password reset (automatically revokes active sessions)
- `GET /api/v1/auth/sessions/` & `POST /api/v1/auth/sessions/<uuid>/revoke/` — Inspect & revoke active login sessions
- `POST /api/v1/auth/mfa/setup/`, `POST /api/v1/auth/mfa/verify/`, `POST /api/v1/auth/mfa/disable/` — TOTP Multi-Factor Authentication lifecycle with one-time recovery codes
- `GET /api/v1/auth/export/` — Export full JSON archive of account data
- `POST /api/v1/auth/delete-account/` — Permanently delete account (`password` + `confirmation: "DELETE"`)

### 3.2 Messaging, Sender Identities & Simulation Lab (`/api/v1/`)
- `GET /api/v1/messages/` — Paginated message history (`direction`, `status`, `transport_type`, `is_simulation`, `is_auto_reply`, `search`, `date_from`, `date_to`)
- `POST /api/v1/messages/` — Submit outbound SMS:
  ```json
  {
    "recipient_number": "+255713555777",
    "body": "Habari! Your verification code is 482910.",
    "transport_type": "sim_gateway",
    "device_id": "2c8e18fb-7b5e-4e92-88d7-84c6b532f110",
    "sim_slot": 0,
    "ttl_minutes": 120
  }
  ```
- `GET /api/v1/messages/<uuid>/` — Full message record with `attempts` and `delivery_events`
- `GET /api/v1/messages/<uuid>/status/` — Concise delivery state & human-readable explanation distinguishing `submitted` vs `delivered` vs `simulated_delivered`
- `POST /api/v1/messages/<uuid>/cancel/` — Cancel a `queued` or `pending_approval` message prior to handset transmission
- `POST /api/v1/messages/<uuid>/approve-reply/` — Approve a held `pending_approval` AI/rule auto-reply
- `GET / POST / PATCH / DELETE /api/v1/sender-identities/` — Manage SIM slot labels vs registered External Provider alphanumeric Sender IDs
- `POST /api/v1/simulation/inject-inbound/` — Inject virtual inbound SMS (`{ "sender_number": "+255754222333", "body": "opening hours" }`) and evaluate real rules/modes/AI strictly inside `SimulationTransport`
- `POST /api/v1/simulation/seed-demo/` & `POST /api/v1/simulation/reset/` — Seed or wipe Simulation Mode records without affecting real SMS history

### 3.3 Devices & Android SIM Gateway Protocol (`/api/v1/devices/`)
- `POST /api/v1/devices/pair/init/` — Generate short-lived single-use 6-char pairing code & bootstrap QR JSON payload
- `POST /api/v1/devices/pair/confirm/` — Authenticated handset confirmation returning one-time `gateway_token` (`edugw_...`)
- `GET / PATCH / DELETE /api/v1/devices/` — List/configure paired devices (`selected_sim_slot`, `is_enabled`, `name`)
- `POST /api/v1/devices/<uuid>/pause/`, `resume/`, `revoke/` — Gateway lifecycle controls
- **Handset Endpoints (`X-Gateway-Token`)**:
  - `POST /api/v1/devices/gateway/heartbeat/` — Report battery, SIM slots, carrier, network type, permissions & default SMS role
  - `POST /api/v1/devices/gateway/jobs/poll/` — Atomically claim `queued` jobs (`SELECT ... FOR UPDATE SKIP LOCKED`)
  - `POST /api/v1/devices/gateway/jobs/<attempt_id>/ack/` — Confirm handset job receipt
  - `POST /api/v1/devices/gateway/inbound/` — Batch or single inbound SMS synchronization with `external_message_id` deduplication
  - `POST /api/v1/devices/gateway/status-callback/` — Report `sent` (`RESULT_OK` -> `submitted`), `delivered` (carrier PDU -> `delivered`), `delivery_unknown`, or `failed` (`RESULT_ERROR_*`)

### 3.4 Contacts, Groups & Consent (`/api/v1/`)
- `GET / POST / PATCH / DELETE /api/v1/contacts/`
- `GET /api/v1/contacts/<uuid>/effective-policy/` — Inspect inherited policy trace (`can_send_outgoing`, `can_auto_reply`, `can_ai_reply`, `effective_cooldown_minutes`, `effective_mode_name`, `blocking_reasons`)
- `POST /api/v1/contacts/<uuid>/opt-in/` & `opt-out/`
- `POST /api/v1/contacts/import-csv/` — Requires `consent_confirmed: true`
- `GET /api/v1/contacts/export-csv/`
- `POST /api/v1/contacts/normalize-preview/` — Preview `+255` & international E.164 normalization
- `GET / POST / PATCH / DELETE /api/v1/groups/` & `POST /api/v1/groups/<uuid>/members/`
- `GET / POST / DELETE /api/v1/suppressions/`

### 3.5 Intelligent Automation (`/api/v1/automation/`)
- `POST /api/v1/automation/global-toggle/` — Toggle `global_automation_enabled` & `global_ai_enabled`
- `GET / POST / PATCH / DELETE /api/v1/automation/modes/` & `POST /api/v1/automation/modes/<uuid>/activate/`
- `GET / POST / PATCH / DELETE /api/v1/automation/rules/`, `POST .../duplicate/`, `POST /api/v1/automation/rules/test/`
- `GET / POST / PATCH / DELETE /api/v1/automation/schedules/` & `POST /api/v1/automation/schedules/validate/`
- `GET / POST / PATCH / DELETE /api/v1/automation/ai-providers/`, `POST .../test-connection/`, `POST .../test-prompt/`, `GET /api/v1/automation/ai-logs/`

### 3.6 Bulk SMS Campaigns (`/api/v1/campaigns/`)
- `GET / POST / DELETE /api/v1/campaigns/`
- `POST /api/v1/campaigns/preview-audience/` — Deduplicates numbers and previews opt-out/suppression exclusions + rendered templates
- `POST /api/v1/campaigns/<uuid>/validate/`, `test-send/`, `start/`, `process-batch/`, `pause/`, `resume/`, `cancel/`
- `GET /api/v1/campaigns/<uuid>/recipients/` & `GET /api/v1/campaigns/<uuid>/export-csv/`

### 3.7 Developer Keys, Webhooks & Analytics
- `GET / POST / DELETE /api/v1/developers/api-keys/`, `POST .../revoke/`, `POST .../rotate/`, `GET .../capabilities/`
- `GET / POST / PATCH / DELETE /api/v1/developers/webhooks/`, `POST .../rotate-secret/`, `POST .../test/`
- `GET /api/v1/developers/webhook-deliveries/` & `POST .../retry/`
- `POST /api/v1/developers/webhooks/verify-signature/`
- `GET /api/v1/analytics/overview/?days=14`

---

## 4. Code Examples

### cURL — Send Simulated SMS with Idempotency
```bash
curl -X POST http://127.0.0.1:8000/api/v1/messages/ \
  -H "X-API-Key: edusms_sim_your_key_here" \
  -H "Idempotency-Key: order-99412-otp" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient_number": "0754123456",
    "body": "Welcome to EduSMS! Reply HELP for options or STOP to opt out.",
    "transport_type": "simulation",
    "simulated_outcome": "simulated_delivered"
  }'
```

### Python — Verify Outbound Webhook HMAC-SHA256 Signature
Every EduSMS webhook request carries:
- `X-EduSMS-Event`: Event type (e.g. `sms.received`, `sms.sent`, `sms.delivered`, `sms.failed`, `device.connected`, `campaign.started`)
- `X-EduSMS-Event-Id`: Unique event ID (`evt_...`) for idempotency / replay deduplication
- `X-EduSMS-Signature`: `t=<unix_timestamp>,v1=<hex_hmac_sha256>`

```python
import hashlib
import hmac
import time

def verify_edusms_webhook(raw_body: bytes, sig_header: str, secret: str, tolerance_sec: int = 300) -> bool:
    parts = dict(item.split("=", 1) for item in sig_header.split(",") if "=" in item)
    timestamp = int(parts["t"])
    if abs(time.time() - timestamp) > tolerance_sec:
        return False
    signed_payload = f"{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

---

## 5. Realtime WebSocket Protocol (`/ws/events/`)

Connect using an active JWT access token:
```text
ws://127.0.0.1:8000/ws/events/?token=<jwt_access_token>
```
- Unauthenticated or expired tokens close immediately with WebSocket code `4401`.
- Client keepalive: send `{"type": "ping"}` -> server replies `{"type": "pong"}`.
- Server push frames:
  ```json
  {
    "type": "message.updated",
    "timestamp": "2026-10-30T07:15:00Z",
    "data": {
      "message_id": "88f4c13a-...",
      "status": "submitted",
      "is_simulation": false
    }
  }
  ```
