# EduSMS — Quality Assurance & Testing Guide

EduSMS includes automated test suites across all three tiers (**Django Backend**, **React Web Dashboard**, and **Flutter Mobile & Native Gateway Bridge**), plus an interactive **Simulation Lab** for zero-cost testing without transmitting carrier SMS.

---

## 1. Running the Automated Test Suites

### 1.1 Prerequisite Local Services (PostgreSQL & Redis)
If not running inside Docker Compose, start the local PostgreSQL and Redis daemon:
```bash
bash scripts/dev_services.sh daemon
```

### 1.2 Backend Test Suite (`pytest`)
Executes 20 integration & end-to-end test suites against real PostgreSQL and Redis Channels:
```bash
backend/.venv/bin/pytest backend/tests/
```
Covered areas in `backend/tests/test_edusms_backend.py` and `backend/tests/test_comprehensive_qa.py`:
- Registration, Login, Refresh Token Rotation & Blacklisting, TOTP MFA + Recovery Codes, Session Revocation, Data Export & Account Deletion
- Email Verification & Password Reset single-use tokens + automatic session invalidation
- Strict Multi-Tenant Object Isolation across accounts
- PostgreSQL `CheckConstraint`s enforcing Simulation vs. Real status isolation and blocking SIM Sender ID spoofing
- **Workflow A**: Device Pairing (`pair/init/` -> `pair/confirm/`), single-use/expired code rejection, `X-Gateway-Token` heartbeat, atomic `jobs/poll/`, `SENT` -> `submitted` vs. carrier `DELIVERED` -> `delivered`, inbound SMS deduplication, and immediate revocation (`403`)
- **Workflow B**: Contact Groups, Keyword & Regex rules, template rendering (`{{first_name}}`), `STOP` opt-out & `START` opt-in precedence, shortcode/alphanumeric anti-loop guard (`15001`), and zero real SMS leak in Simulation Mode
- **Workflow C**: Encrypted AI Provider configuration, secret masking, connectivity check, `<untrusted_inbound_sms>` prompt-injection tag escaping, secret scrubbing, and deterministic fallback on simulated AI outage
- **Workflow D**: Authorized CSV import, `+255` Tanzania & international E.164 normalization, duplicate & opt-out audience exclusions, throttled batch execution, error-rate auto-pause, mid-flight campaign cancellation, and CSV report export
- **Workflow E**: Scoped Developer API Keys (`edusms_sim_` / `edusms_live_`), `Idempotency-Key` replay safety, per-key rate limiting (`429`), SSRF blocking (`127.0.0.1`, `169.254.169.254`, `10.x.x.x`), HMAC-SHA256 webhook signatures, anti-replay guard, dead-letter retries, and secret rotation
- Timezone & overnight `ScheduleWindow` evaluation (`Africa/Dar_es_Salaam`), Human-Approval Queue (`pending_approval` -> `approve-reply`), OpenAPI 3 schema validation, and live ASGI WebSocket JWT authentication (`/ws/events/`)

### 1.3 Web Frontend Test Suite (`vitest`) & Production Build
```bash
npm --prefix web run test
npm --prefix web run build
```
Covers theme switching (`dark`, `light`, `system` + `matchMedia` listener), auth & protected routes, dashboard metrics & honest status badges, contacts/CSV consent gate/effective policy preview, automation rule builder & dry-run tester, campaign audience preview, developer API key one-time modal & webhook retry, and loading/empty/error states.

### 1.4 Flutter Mobile Static Analysis & Widget/Unit Tests
```bash
flutter analyze mobile
flutter test mobile
```
Covers Material 3 theme modes, `GoRouter` navigation, auth validation, mocked `MethodChannel("com.edusms.gateway/methods")` Android telephony bridge (`getDiagnostics`, `configureGateway`, `startGatewayService`, `pauseGatewayService`), iOS Companion Mode capability detection (`PlatformCapabilities`), pairing confirmation, contacts/automation/campaigns screens, and transport status honesty.

---

## 2. Testing Without a Physical SIM Card (Simulation Lab)

Every feature in EduSMS can be tested safely at zero carrier cost in **Simulation Mode**:
1. Sign in to the Web Dashboard or Flutter App (either register a new workspace, click **Launch Demo Workspace** in local dev, or run `backend/.venv/bin/python backend/manage.py seed_demo --reset-password` to print a fresh one-time password for `dev@edusms.local`).
2. Open **Simulation Lab** and click **Seed Demo Dataset** to populate sample Tanzanian (`+255`) and international virtual contacts, groups, keyword rules, and mock AI provider.
3. Inject a virtual incoming SMS (e.g., Sender `+255754100201`, Body `"What are your opening hours?"` or `"When is our next lab lecture?"`) and inspect the instant rule/mode/AI evaluation trace and simulated auto-reply.
4. Test `STOP` opt-out, shortcode loop blocking (`15001`), simulated failure outcomes (`simulated_outcome: "failed"` or `"delivery_unknown"`), and click **Reset Simulation Data** when finished — real contacts and real SIM messages are never touched.

---

## 3. Physical Android Handset & Carrier Verification Checklist

Automated CI environments cannot radiate physical GSM/LTE RF signals or receive live operator delivery report PDUs. To verify real carrier transmission end-to-end on a physical Android phone:

1. **Prerequisites**:
   - An Android 8.0+ physical smartphone with an active SIM card and SMS plan/bundle.
   - Phone and EduSMS backend reachable over HTTPS (or LAN IP on local Wi-Fi during development).
2. **Step-by-Step Verification**:
   - Install the Flutter Android APK (`flutter run` or `flutter build apk`) on the handset.
   - Sign in on the mobile app, set the Backend URL to your server's reachable address, and complete the Android SMS Permissions onboarding (`SEND_SMS`, `RECEIVE_SMS`, `READ_PHONE_STATE`, `POST_NOTIFICATIONS`).
   - In the Web Dashboard (**Devices -> Pair New Gateway**), generate a 6-character pairing code / QR payload and confirm pairing on the Android phone.
   - Start the **EduSMS SIM Gateway** service on the phone and verify the persistent foreground notification appears and the Web Dashboard shows **Online** with the detected carrier & SIM slot(s).
   - Compose a single real SMS (`transport_type: "sim_gateway"`) to a second test handset you own:
     - Confirm status moves `queued` -> `dispatched_to_device` -> `submitted` upon radio transmission, and to `delivered` if your mobile operator returns SMS-STATUS-REPORT PDUs.
   - Send a reply SMS from the second handset to the gateway SIM number:
     - Confirm `SmsBroadcastReceiver` syncs the inbound SMS to the Web Dashboard Inbox in real time and triggers any enabled auto-reply rule.
