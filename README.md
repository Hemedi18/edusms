# EduSMS — Programmable Android SIM Gateway & Intelligent Messaging Automation Platform

EduSMS is a full-stack programmable SMS gateway, rule & AI auto-responder, bulk campaign engine, and developer messaging platform built for developers, students, researchers, startups, and engineering teams.

Connect an Android smartphone containing an active SIM card to your EduSMS server to send and receive real carrier SMS through your own SIM—or build, test, and prototype completely free in the isolated **Simulation Lab** before connecting hardware.

---

## Core Capabilities

1. **Physical Android SIM Gateway (`sim_gateway`)** — Genuine native Kotlin Android integration (`SmsManager`, `SubscriptionManager`, `SmsBroadcastReceiver`, `SmsStatusReceiver`, and visible foreground service `EduSmsGatewayService`) supporting multi-SIM selection, multipart SMS, offline inbound queueing, retry deduplication, and single-use code/QR pairing.
2. **Honest iOS Companion Mode** — Full dashboard, inbox, remote gateway dispatch, automation, contacts, campaigns, API keys, and Simulation Lab on iOS, without pretending iOS permits unrestricted background SIM access.
3. **Strict Transport & Delivery Status Honesty** — Database-enforced (`CheckConstraint`) separation between **Simulation Mode** (`simulated_sent`, `simulated_delivered`), **Android SIM Transmission** (`queued` -> `dispatched_to_device` -> `submitted` on `RESULT_OK` -> `delivered` **only** on carrier delivery PDU), and **External SMS Providers** (`external_provider`). Physical SIM slots never claim alphanumeric Sender ID spoofing.
4. **Intelligent Auto-Responder (Modes + Rules + AI)** — Six built-in modes (`Default`, `Meeting`, `Focus`, `Vacation`, `Sleeping`, `Custom`) plus custom modes, timezone-aware `ScheduleWindow`s (`Africa/Dar_es_Salaam` & IANA zones), keyword & regex rules (`exact`, `contains`, `starts_with`, `ends_with`, `whole_word`, `regex`), template variables, dry-run Rule Preview Tester, and encrypted AI adapters (`OpenAI-compatible`, `Google Gemini`, `Deterministic Mock`) with `<untrusted_inbound_sms>` prompt-injection isolation, fallbacks, and optional human-review approval queues.
5. **Contacts, Groups, `+255`/E.164 Normalization & Consent Precedence** — First-class Tanzanian (`07xx` -> `+2557xx`) and international E.164 normalization, authorized CSV import/export, Effective Policy inheritance inspector, automatic `STOP` opt-out / `START` opt-in handling, and shortcode/alphanumeric anti-loop protection.
6. **Throttled Bulk SMS Campaigns** — Audience preview with duplicate & opt-out exclusions, test send, scheduled & immediate execution, inter-message pacing, quiet hours, error-rate auto-pause, mid-flight pause/resume/cancel, and CSV recipient reports.
7. **Developer API & Signed Webhooks** — Scoped SHA-256 hashed API keys (`edusms_live_...`, `edusms_sim_...`), `Idempotency-Key` protection, per-key rate limiting, OpenAPI 3 / Swagger / ReDoc docs, and SSRF-protected outbound webhooks signed with `HMAC-SHA256` (`X-EduSMS-Signature`) + replay protection + exponential backoff & dead-letter retries.
8. **Premium Dark/Light/System SaaS Experience** — Responsive React 19 + TypeScript + Tailwind CSS v4 Web Dashboard and Material 3 Flutter Mobile App with live WebSocket (`/ws/events/`) updates.

---

## Repository Structure

```text
fullsmsgateway/
├── backend/                  # Python 3.13 + Django 5.2 + DRF + Channels + Celery + PostgreSQL + Pytest
│   ├── edusms/               # ASGI/WSGI, settings, Celery & root URL routing
│   ├── apps/
│   │   ├── core/             # HKDF-Fernet crypto, SSRF validator, Notifications, AuditEvents, WebSockets
│   │   ├── accounts/         # Auth, SimpleJWT rotation/revocation, TOTP MFA, sessions, export/delete
│   │   ├── devices/          # Single-use pairing (code + QR), X-Gateway-Token auth, heartbeat, poll/ack
│   │   ├── contacts/         # Contacts, Groups, +255/E.164 normalization, CSV, Effective Policy, Consent
│   │   ├── messaging/        # Messages, Attempts, DeliveryEvents, Transports, Sender Identities, Simulation
│   │   ├── automation/       # Modes, Rules, Timezone Schedules, AI Adapters & Prompt-Injection Guard
│   │   ├── campaigns/        # Bulk Campaigns, Audience Preview, Throttled Worker, CSV Reports
│   │   ├── developers/       # Scoped API Keys, Signed Webhooks, Delivery Attempts & Replay Guard
│   │   └── analytics/        # Account Overview & Time-Series Aggregations
│   ├── tests/                # End-to-End & QA Pytest Suites (Workflows A–E + 18 QA domains)
│   └── openapi.yaml          # Validated OpenAPI 3.0 specification
├── web/                      # React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + Vitest Web Dashboard
├── mobile/                   # Flutter 3 + Riverpod + GoRouter + Dio + Native Android Kotlin Telephony
│   ├── android/              # MainActivity, EduSmsGatewayService, SmsTransmitter, SmsBroadcastReceiver
│   ├── ios/                  # iOS Companion App configuration
│   ├── lib/                  # Layered Flutter architecture (core, data, ui)
│   └── test/                 # Flutter unit & widget tests with MethodChannel telephony mocks
├── docs/                     # Architecture, Build Plan, API, Security, Android Gateway & Testing guides
├── scripts/                  # Local PostgreSQL/Redis dev daemon & database backup/restore utilities
├── docker-compose.yml        # Full-stack containerized orchestration
├── Makefile                  # Developer workflow shortcuts
└── .env.example              # Environment configuration template
```

---

## Quickstart

### Option A — Docker Compose (Recommended Full Stack)

1. Copy the environment template and set your secrets:
   ```bash
   cp .env.example .env
   ```
2. Launch PostgreSQL, Redis, Django ASGI (`daphne`), Celery Worker, Celery Beat, and the React Web Dashboard:
   ```bash
   docker compose up --build -d
   ```
3. Seed the optional developer demo workspace:
   ```bash
   docker compose exec backend python manage.py seed_demo
   ```
4. Open:
   - **Web Dashboard**: http://localhost:5173
   - **Swagger API Docs**: http://localhost:8000/api/v1/docs/
   - **ReDoc**: http://localhost:8000/api/v1/redoc/

### Option B — Local Native Development

1. Start local PostgreSQL and Redis:
   ```bash
   cp .env.example .env
   bash scripts/dev_services.sh daemon
   ```
2. Run migrations, seed demo data, and start the Django ASGI server (`daphne`):
   ```bash
   backend/.venv/bin/python backend/manage.py migrate
   backend/.venv/bin/python backend/manage.py seed_demo
   backend/.venv/bin/daphne -b 0.0.0.0 -p 8000 --chdir backend edusms.asgi:application
   ```
3. (Optional) Start Celery worker & scheduler in separate terminals:
   ```bash
   backend/.venv/bin/celery --workdir backend -A edusms worker -l info
   backend/.venv/bin/celery --workdir backend -A edusms beat -l info
   ```
4. Start the React Web Dashboard dev server:
   ```bash
   npm --prefix web run dev
   ```
5. Run the Flutter Mobile App (Android device/emulator or iOS simulator):
   ```bash
   cd mobile
   flutter run
   ```

### Seeded Demo Account (Local Development Only)
`manage.py seed_demo` refuses to run when `DJANGO_ENV=production` and never uses hardcoded default passwords:
- **Email**: `dev@edusms.local` (customizable via `--email`)
- **Password**: Generated once via `secrets.token_urlsafe(12)` and printed to standard output on first run (re-generate anytime with `python manage.py seed_demo --reset-password`).

---

## Key Environment Variables (`.env.example`)

| Variable | Description | Default (Dev) |
| :--- | :--- | :--- |
| `DJANGO_ENV` | `development` or `production` | `development` |
| `DJANGO_DEBUG` | Enable debug diagnostics (must be `False` in production) | `True` |
| `DJANGO_SECRET_KEY` | Primary signing key for JWTs and Django crypto | Dev placeholder |
| `EDUSMS_ENCRYPTION_KEY` | Master key for HKDF-Fernet encryption of AI/TOTP/Webhook secrets | Dev placeholder |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_HOST` | PostgreSQL connection parameters | `edusms` / `127.0.0.1` |
| `REDIS_URL` / `CELERY_BROKER_URL` | Redis Channels & Celery broker URLs | `redis://127.0.0.1:6379/0` |
| `PUBLIC_API_URL` / `PUBLIC_WEB_URL` | Base URLs embedded in pairing QR payloads & action emails | `http://127.0.0.1:8000` |
| `DEFAULT_PHONE_REGION` | Default ISO region for national phone inputs (`07xx` -> `+2557xx`) | `TZ` |
| `WEBHOOK_REQUIRE_HTTPS` | Enforce `https://` on all webhook subscriptions | `True` |

---

## Running Automated Tests & Static Analysis

```bash
# 1. Backend Pytest Suite (PostgreSQL + Redis + Channels WebSockets)
backend/.venv/bin/pytest backend/tests/

# 2. OpenAPI 3 Schema Validation
backend/.venv/bin/python backend/manage.py spectacular --file backend/openapi.yaml --validate

# 3. Web Frontend Vitest Suite & Production Build
npm --prefix web run test
npm --prefix web run build

# 4. Flutter Mobile Static Analysis & Widget/Unit Tests
flutter analyze mobile
flutter test mobile
```

---

## Database Backup & Restore

```bash
# Create compressed PostgreSQL custom-format backup in ./backups/
bash scripts/backup_restore.sh backup

# Restore from a backup archive
bash scripts/backup_restore.sh restore backups/edusms_YYYYMMDD_HHMMSS.dump
```

---

## Detailed Documentation

- [Build Plan & Module Roadmap](docs/BUILD_PLAN.md)
- [System Architecture, State Machines & Data Flows](docs/ARCHITECTURE.md)
- [REST API, Scoped Keys, Webhooks & WebSocket Reference](docs/API.md)
- [Security Model, Encryption, SSRF & Prompt-Injection Defenses](docs/SECURITY.md)
- [Android SIM Gateway Native Kotlin Architecture & Permissions](docs/ANDROID_GATEWAY.md)
- [Testing Strategy & Physical Handset Verification Guide](docs/TESTING.md)
