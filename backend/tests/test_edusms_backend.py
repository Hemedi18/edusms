"""
Comprehensive Backend Automated Test Suite for EduSMS.
Covers authentication, multi-tenant isolation, PostgreSQL CheckConstraints, device pairing/revocation,
gateway heartbeats & callbacks, inbound deduplication, rule/schedule/timezone evaluation,
AI safety & fallback, contact/group overrides, opt-out enforcement, bulk campaigns & cancellation,
scoped API keys, idempotency, rate limits, SSRF defense, webhook HMAC signing & replay protection,
and End-to-End Workflows A, B, C, D, and E.
"""
from __future__ import annotations

from datetime import UTC, time, timedelta
import json
import httpx
import pyotp
import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ActionToken, User
from apps.automation.models import AICallLog, AIProviderConfig, AutoReplyRule, AutomationMode, ScheduleWindow
from apps.automation.services import is_schedule_active
from apps.contacts.models import Contact, ContactGroup, GroupMembership
from apps.contacts.phone_utils import normalize_phone_number
from apps.core.ssrf import SSRFBlockedError, validate_outbound_url
from apps.developers.models import WebhookEndpoint, WebhookEvent
from apps.developers.services import deliver_webhook_event, verify_and_guard_webhook_replay
from apps.messaging.models import Message, SenderIdentityConfig


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


def register_and_auth_client(email: str = "alice@edusms.test", password: str = "StrongPass!2026") -> tuple[APIClient, dict]:
    client = APIClient()
    resp = client.post(
        "/api/v1/auth/register/",
        {
            "email": email,
            "full_name": "Alice Developer",
            "organization": "Dar Tech Lab",
            "password": password,
            "timezone": "Africa/Dar_es_Salaam",
            "default_country_code": "TZ",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
    return client, resp.data


@pytest.mark.django_db
class TestAuthenticationSecurityAndPrivacy:
    def test_register_login_refresh_rotation_mfa_export_and_delete(self):
        client, reg = register_and_auth_client("authflow@edusms.test")
        refresh_1 = reg["refresh"]

        # Rotate refresh token
        rot = client.post("/api/v1/auth/refresh/", {"refresh": refresh_1}, format="json")
        assert rot.status_code == 200
        refresh_2 = rot.data["refresh"]
        assert refresh_2 != refresh_1

        # Old refresh token must be blacklisted after rotation
        reuse = client.post("/api/v1/auth/refresh/", {"refresh": refresh_1}, format="json")
        assert reuse.status_code == 401

        # Setup & verify TOTP MFA
        mfa_setup = client.post("/api/v1/auth/mfa/setup/")
        assert mfa_setup.status_code == 200
        secret = mfa_setup.data["secret"]
        code = pyotp.TOTP(secret).now()
        mfa_enable = client.post("/api/v1/auth/mfa/verify/", {"code": code}, format="json")
        assert mfa_enable.status_code == 200
        assert len(mfa_enable.data["recovery_codes"]) == 8

        # Login without MFA code must fail when MFA is enabled
        anon = APIClient()
        no_mfa = anon.post(
            "/api/v1/auth/login/",
            {"email": "authflow@edusms.test", "password": "StrongPass!2026"},
            format="json",
        )
        assert no_mfa.status_code == 400
        assert "mfa_required" in no_mfa.data

        # Login with valid TOTP code succeeds
        with_mfa = anon.post(
            "/api/v1/auth/login/",
            {"email": "authflow@edusms.test", "password": "StrongPass!2026", "mfa_code": pyotp.TOTP(secret).now()},
            format="json",
        )
        assert with_mfa.status_code == 200

        # Export account data
        exp = client.get("/api/v1/auth/export/")
        assert exp.status_code == 200
        assert exp.data["account"]["email"] == "authflow@edusms.test"

        # Delete account
        del_resp = client.post(
            "/api/v1/auth/delete-account/",
            {"password": "StrongPass!2026", "confirmation": "DELETE"},
            format="json",
        )
        assert del_resp.status_code == 200
        assert not User.objects.filter(email="authflow@edusms.test").exists()

    def test_multi_tenant_account_isolation(self):
        alice_client, _ = register_and_auth_client("alice_iso@edusms.test")
        bob_client, _ = register_and_auth_client("bob_iso@edusms.test")

        # Alice creates a contact, group, and rule
        c_resp = alice_client.post(
            "/api/v1/contacts/",
            {"name": "Secret Contact", "phone_number": "0754111222"},
            format="json",
        )
        assert c_resp.status_code == 201
        contact_id = c_resp.data["id"]

        # Bob cannot view, update, or delete Alice's contact
        assert bob_client.get(f"/api/v1/contacts/{contact_id}/").status_code == 404
        assert bob_client.delete(f"/api/v1/contacts/{contact_id}/").status_code == 404
        assert bob_client.get("/api/v1/contacts/").data["count"] == 0


@pytest.mark.django_db
class TestDatabaseTransportAndSenderConstraints:
    def test_postgresql_check_constraints_enforce_transport_separation(self):
        user = User.objects.create_user(email="constraints@edusms.test", password="StrongPass!2026", full_name="DB Tester")

        # Simulated message CANNOT carry real carrier `delivered` status
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Message.objects.create(
                    user=user,
                    direction="outbound",
                    transport_type="simulation",
                    is_simulation=True,
                    recipient_number="+255754000111",
                    body="Illegal status combo",
                    status=Message.Status.DELIVERED,
                )

        # Real SIM gateway message CANNOT carry `simulated_delivered` status
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Message.objects.create(
                    user=user,
                    direction="outbound",
                    transport_type="sim_gateway",
                    is_simulation=False,
                    recipient_number="+255754000111",
                    body="Illegal simulated status on real transport",
                    status=Message.Status.SIMULATED_DELIVERED,
                )

        # SIM slot sender identity CANNOT spoof an alphanumeric sender ID
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                SenderIdentityConfig.objects.create(
                    user=user,
                    label="Spoof Attempt",
                    identity_type="sim_slot",
                    alphanumeric_sender_id="SPOOFBRAND",
                )


@pytest.mark.django_db
class TestEndToEndWorkflows:
    def test_workflow_a_sim_gateway_pairing_polling_callbacks_dedup_and_revocation(self):
        """Workflow A — Complete physical SIM gateway lifecycle, status honesty, deduplication & revocation."""
        client, _ = register_and_auth_client("workflow_a@edusms.test")

        # 1. Initiate pairing session
        pair_init = client.post("/api/v1/devices/pair/init/", {"device_name": "Pixel 8 TZ SIM"}, format="json")
        assert pair_init.status_code == 201
        code = pair_init.data["pairing_code"]

        # 2. Confirm pairing with SIM metadata
        pair_confirm = client.post(
            "/api/v1/devices/pair/confirm/",
            {
                "pairing_code": code,
                "device_name": "Pixel 8 TZ SIM",
                "platform": "android",
                "manufacturer": "Google",
                "device_model": "Pixel 8",
                "os_version": "Android 15",
                "sim_available": True,
                "sim_slots": [
                    {"slot_index": 0, "subscription_id": 1, "carrier_name": "Vodacom TZ", "phone_number": "+255754999000"}
                ],
                "permissions_state": {"SEND_SMS": True, "RECEIVE_SMS": True, "READ_PHONE_STATE": True},
            },
            format="json",
        )
        assert pair_confirm.status_code == 201
        device_id = pair_confirm.data["device"]["id"]
        gw_token = pair_confirm.data["gateway_token"]

        # Single-use pairing code cannot be reused
        reuse = client.post("/api/v1/devices/pair/confirm/", {"pairing_code": code}, format="json")
        assert reuse.status_code == 400

        gw_client = APIClient()
        gw_client.credentials(HTTP_X_GATEWAY_TOKEN=gw_token)

        # 3. Gateway heartbeat
        hb = gw_client.post(
            "/api/v1/devices/gateway/heartbeat/",
            {"battery_level": 88, "network_type": "LTE", "sim_available": True},
            format="json",
        )
        assert hb.status_code == 200
        assert hb.data["status"] == "ok"

        # 4. Submit outbound real SIM SMS (normalized from Tanzanian national format 0713...)
        send_resp = client.post(
            "/api/v1/messages/",
            {
                "recipient_number": "0713555777",
                "body": "Habari! Real SIM test message.",
                "transport_type": "sim_gateway",
                "device_id": device_id,
            },
            format="json",
        )
        assert send_resp.status_code == 201
        msg_id = send_resp.data["id"]
        assert send_resp.data["recipient_number"] == "+255713555777"
        assert send_resp.data["status"] == "queued"
        assert send_resp.data["is_simulation"] is False

        # 5. Gateway polls & claims job; second poll must not duplicate-claim
        poll1 = gw_client.post("/api/v1/devices/gateway/jobs/poll/", {"limit": 5}, format="json")
        assert poll1.status_code == 200
        assert len(poll1.data["jobs"]) == 1
        attempt_id = poll1.data["jobs"][0]["attempt_id"]

        poll2 = gw_client.post("/api/v1/devices/gateway/jobs/poll/", {"limit": 5}, format="json")
        assert poll2.data["jobs"] == []

        # Acknowledge job
        ack = gw_client.post(f"/api/v1/devices/gateway/jobs/{attempt_id}/ack/")
        assert ack.status_code == 200

        # 6. Android SENT callback -> MUST transition to `submitted` (NOT `delivered`!)
        cb_sent = gw_client.post(
            "/api/v1/devices/gateway/status-callback/",
            {"attempt_id": attempt_id, "event": "sent", "android_result_code": "RESULT_OK"},
            format="json",
        )
        assert cb_sent.status_code == 200
        assert cb_sent.data["status"] == "submitted"

        # 7. Carrier DELIVERED PDU callback -> transitions to `delivered`
        cb_deliv = gw_client.post(
            "/api/v1/devices/gateway/status-callback/",
            {"attempt_id": attempt_id, "event": "delivered", "android_result_code": "DELIVERED_PDU_0"},
            format="json",
        )
        assert cb_deliv.status_code == 200
        assert cb_deliv.data["status"] == "delivered"

        # 8. Inbound SMS synchronization & retry deduplication
        in1 = gw_client.post(
            "/api/v1/devices/gateway/inbound/",
            {"sender": "+255713555777", "body": "Asante!", "external_message_id": "pdu_hash_001", "sim_slot": 0},
            format="json",
        )
        assert in1.status_code == 200
        assert in1.data["results"][0]["deduplicated"] is False

        in2 = gw_client.post(
            "/api/v1/devices/gateway/inbound/",
            {"sender": "+255713555777", "body": "Asante!", "external_message_id": "pdu_hash_001", "sim_slot": 0},
            format="json",
        )
        assert in2.status_code == 200
        assert in2.data["results"][0]["deduplicated"] is True

        # 9. Revoke device -> revoked gateway credential must be rejected immediately
        rev = client.post(f"/api/v1/devices/{device_id}/revoke/")
        assert rev.status_code == 200
        assert gw_client.post("/api/v1/devices/gateway/jobs/poll/").status_code == 403
        assert gw_client.post("/api/v1/devices/gateway/heartbeat/").status_code == 403

    def test_workflow_b_rule_based_replies_group_restriction_and_opt_out_precedence(self):
        """Workflow B — Keyword rules, group scoping, template variables, opt-out precedence, and zero real SMS in simulation."""
        client, _ = register_and_auth_client("workflow_b@edusms.test")

        grp = client.post("/api/v1/groups/", {"name": "VIP Students", "allow_auto_reply": True}, format="json")
        assert grp.status_code == 201
        group_id = grp.data["id"]

        contact = client.post(
            "/api/v1/contacts/",
            {"name": "Neema Mushi", "phone_number": "0754222333", "group_ids": [group_id], "opt_in_status": True},
            format="json",
        )
        assert contact.status_code == 201

        rule = client.post(
            "/api/v1/automation/rules/",
            {
                "name": "Opening Hours",
                "is_enabled": True,
                "match_mode": "contains",
                "keywords": ["opening hours"],
                "restricted_groups": [group_id],
                "response_template": "Hi {{first_name}}, our opening hours are Monday to Friday, 8:00 AM to 5:00 PM.",
                "priority": 100,
                "cooldown_minutes": 10,
            },
            format="json",
        )
        assert rule.status_code == 201

        # Inject simulated inbound SMS from group member
        sim_in = client.post(
            "/api/v1/simulation/inject-inbound/",
            {"sender_number": "+255754222333", "body": "Hello, what are your opening hours?"},
            format="json",
        )
        assert sim_in.status_code == 201
        assert sim_in.data["decision"] == "replied"
        assert sim_in.data["reply_body"] == "Hi Neema, our opening hours are Monday to Friday, 8:00 AM to 5:00 PM."
        assert sim_in.data["reply_status"] == "simulated_delivered"

        # Non-group sender must NOT trigger group-restricted rule
        outsider = client.post(
            "/api/v1/simulation/inject-inbound/",
            {"sender_number": "+255754888999", "body": "Hello, what are your opening hours?"},
            format="json",
        )
        assert outsider.status_code == 201
        assert outsider.data["decision"] == "no_match"

        # Verify ZERO real non-simulated messages exist
        assert Message.objects.filter(is_simulation=False).count() == 0

        # Inbound STOP keyword opts out contact and blocks subsequent auto-replies
        stop_in = client.post(
            "/api/v1/simulation/inject-inbound/",
            {"sender_number": "+255754222333", "body": "STOP"},
            format="json",
        )
        assert stop_in.data["decision"] == "opted_out"

        after_stop = client.post(
            "/api/v1/simulation/inject-inbound/",
            {"sender_number": "+255754222333", "body": "opening hours"},
            format="json",
        )
        assert after_stop.data["decision"] == "blocked_policy"

    def test_workflow_c_ai_replies_secret_masking_and_fallback_on_provider_failure(self):
        """Workflow C — Encrypted AI provider config, connection test, AI mode reply, and fallback on failure."""
        client, _ = register_and_auth_client("workflow_c@edusms.test")
        client.post(
            "/api/v1/automation/global-toggle/",
            {"global_automation_enabled": True, "global_ai_enabled": True},
            format="json",
        )

        # Create AI provider with secret key -> verify masked in API response
        prov = client.post(
            "/api/v1/automation/ai-providers/",
            {
                "name": "Campus Mock AI",
                "provider_type": "deterministic_mock",
                "api_key": "sk-super-secret-do-not-expose-9876",
                "model_name": "edusms-mock-v1",
                "fallback_message": "Fallback: Our AI assistant is temporarily offline; we received your SMS.",
            },
            format="json",
        )
        assert prov.status_code == 201
        provider_id = prov.data["id"]
        assert "api_key" not in prov.data
        assert "super-secret" not in prov.data["masked_api_key"]
        assert prov.data["masked_api_key"].endswith("9876")

        # Validate connectivity
        test_conn = client.post(f"/api/v1/automation/ai-providers/{provider_id}/test-connection/")
        assert test_conn.status_code == 200
        assert test_conn.data["test_result"]["ok"] is True

        # Configure Custom mode to use AI provider and activate it
        modes = client.get("/api/v1/automation/modes/").data["results"]
        custom_mode = next(m for m in modes if m["slug"] == "custom")
        client.patch(
            f"/api/v1/automation/modes/{custom_mode['id']}/",
            {
                "response_method": "rules_then_ai",
                "ai_provider": provider_id,
                "cooldown_minutes": 0,
            },
            format="json",
        )
        client.post(f"/api/v1/automation/modes/{custom_mode['id']}/activate/")

        # Inject incoming SMS -> AI replies
        msg1 = client.post(
            "/api/v1/simulation/inject-inbound/",
            {"sender_number": "+255754301301", "body": "When is our next lab lecture?"},
            format="json",
        )
        assert msg1.status_code == 201
        assert msg1.data["decision"] == "ai_replied"
        assert "classes and lab sessions" in msg1.data["reply_body"].lower()

        # Simulate AI provider failure -> verify deterministic fallback is sent and logged
        client.patch(
            f"/api/v1/automation/ai-providers/{provider_id}/",
            {"simulate_failure": True},
            format="json",
        )
        msg2 = client.post(
            "/api/v1/simulation/inject-inbound/",
            {"sender_number": "+255754302302", "body": "Can you help me with enrollment?"},
            format="json",
        )
        assert msg2.status_code == 201
        assert msg2.data["decision"] == "replied"
        assert msg2.data["reply_body"].startswith("Fallback:")
        assert AICallLog.objects.filter(provider_id=provider_id, status=AICallLog.Status.FALLBACK_USED).exists()

    def test_workflow_d_bulk_campaigns_preview_throttled_batch_cancel_and_reports(self):
        """Workflow D — CSV import, audience deduplication/exclusion, simulation batch run, mid-flight cancel, and report accuracy."""
        client, _ = register_and_auth_client("workflow_d@edusms.test")

        csv_payload = (
            "name,phone_number\n"
            "Student One,0754100001\n"
            "Student Two,0754100002\n"
            "Student Three,0754100003\n"
            "Student Four,0754100004\n"
            "Duplicate One,+255754100001\n"
            "Invalid Row,not-a-number\n"
        )
        imp = client.post(
            "/api/v1/contacts/import-csv/",
            {"csv_text": csv_payload, "consent_confirmed": True, "mark_opted_in": True, "is_virtual": True},
            format="json",
        )
        assert imp.status_code == 200
        assert imp.data["created_count"] == 4
        assert imp.data["duplicate_in_file_count"] == 1
        assert imp.data["invalid_count"] == 1

        # Opt out Student Four
        s4 = Contact.objects.get(phone_number="+255754100004")
        client.post(f"/api/v1/contacts/{s4.id}/opt-out/")

        all_ids = [str(c.id) for c in Contact.objects.filter(phone_number__startswith="+25575410000")]

        # Preview audience -> 3 eligible, 1 excluded (opted out)
        prev = client.post(
            "/api/v1/campaigns/preview-audience/",
            {
                "message_template": "Reminder for {{contact_name}}: Midterm tomorrow at 9 AM.",
                "contact_ids": all_ids,
                "transport_type": "simulation",
            },
            format="json",
        )
        assert prev.status_code == 200
        assert prev.data["eligible_count"] == 3
        assert prev.data["excluded_count"] == 1

        # Create campaign
        camp_resp = client.post(
            "/api/v1/campaigns/",
            {
                "name": "Midterm Exam Reminder",
                "message_template": "Reminder for {{contact_name}}: Midterm tomorrow at 9 AM.",
                "transport_type": "simulation",
                "contact_ids": all_ids,
            },
            format="json",
        )
        assert camp_resp.status_code == 201
        camp_id = camp_resp.data["id"]

        # Start campaign processing ONLY first batch of 2 recipients so 1 remains pending
        started = client.post(f"/api/v1/campaigns/{camp_id}/start/", {"batch_size": 2}, format="json")
        assert started.status_code == 200
        assert started.data["stats"]["simulated_delivered_messages"] == 2
        assert started.data["stats"]["pending_messages"] == 1

        # Cancel remaining jobs mid-campaign
        canceled = client.post(f"/api/v1/campaigns/{camp_id}/cancel/")
        assert canceled.status_code == 200
        assert canceled.data["status"] == "canceled"
        stats = canceled.data["stats"]
        assert stats["total_recipients"] == 4
        assert stats["eligible_recipients"] == 3
        assert stats["excluded_recipients"] == 1
        assert stats["simulated_delivered_messages"] == 2
        assert stats["canceled_messages"] == 1
        assert stats["pending_messages"] == 0

        # Export CSV report
        csv_rep = client.get(f"/api/v1/campaigns/{camp_id}/export-csv/")
        assert csv_rep.status_code == 200
        assert "simulated_delivered" in csv_rep.content.decode("utf-8")

    def test_workflow_e_scoped_api_keys_idempotency_webhooks_ssrf_and_replay_guard(self):
        """Workflow E — Scoped API key enforcement, idempotency, signed webhook delivery, SSRF rejection, and replay guard."""
        client, _ = register_and_auth_client("workflow_e@edusms.test")

        # 1. SSRF guard must reject loopback, private RFC1918, and cloud metadata webhook URLs
        for forbidden_url in [
            "http://127.0.0.1:8080/hook",
            "https://169.254.169.254/latest/meta-data/",
            "https://10.10.1.5/internal",
            "https://localhost/webhook",
        ]:
            bad_wh = client.post(
                "/api/v1/developers/webhooks/",
                {"name": "Bad SSRF", "url": forbidden_url, "events": ["sms.delivered"]},
                format="json",
            )
            assert bad_wh.status_code == 400, f"Expected SSRF rejection for {forbidden_url}"

        # 2. Create legitimate HTTPS webhook endpoint -> signing secret returned once
        wh_resp = client.post(
            "/api/v1/developers/webhooks/",
            {
                "name": "Production Event Receiver",
                "url": "https://hooks.example.org/edusms",
                "events": ["sms.delivered", "sms.sent"],
                "include_simulation_events": True,
            },
            format="json",
        )
        assert wh_resp.status_code == 201
        wh_id = wh_resp.data["id"]
        signing_secret = wh_resp.data["signing_secret"]
        assert signing_secret.startswith("whsec_")
        # Subsequent GET must mask signing secret
        wh_get = client.get(f"/api/v1/developers/webhooks/{wh_id}/")
        assert "signing_secret" not in wh_get.data
        assert "••••" in wh_get.data["masked_signing_secret"]

        # 3. Create scoped simulation API key (`messages:write` + `messages:read` only, rate_limit=4/min)
        key_resp = client.post(
            "/api/v1/developers/api-keys/",
            {
                "name": "CI Integration Key",
                "scopes": ["messages:read", "messages:write"],
                "simulation_only": True,
                "rate_limit_per_minute": 4,
            },
            format="json",
        )
        assert key_resp.status_code == 201
        raw_api_key = key_resp.data["raw_key"]
        assert "raw_key" not in client.get("/api/v1/developers/api-keys/").data["results"][0]

        ext_client = APIClient()
        ext_client.credentials(HTTP_X_API_KEY=raw_api_key)

        # Out-of-scope endpoint (`campaigns`) must be rejected with 403
        assert ext_client.get("/api/v1/campaigns/").status_code == 403

        # 4. Submit message via API key with Idempotency-Key
        m1 = ext_client.post(
            "/api/v1/messages/",
            {"recipient_number": "+255754777888", "body": "API key test SMS", "transport_type": "simulation"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="idem-order-1001",
        )
        assert m1.status_code == 201

        # Replay with identical Idempotency-Key returns exact same message without creating a duplicate
        m1_replay = ext_client.post(
            "/api/v1/messages/",
            {"recipient_number": "+255754777888", "body": "API key test SMS", "transport_type": "simulation"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="idem-order-1001",
        )
        assert m1_replay.status_code == 201
        assert m1_replay.data["id"] == m1.data["id"]
        assert m1_replay["X-Idempotent-Replay"] == "true"

        # 5. Deliver queued webhook event via mock HTTP transport & verify HMAC-SHA256 signature + anti-replay
        wh_event = WebhookEvent.objects.filter(endpoint_id=wh_id).first()
        assert wh_event is not None

        captured: dict = {}

        def _mock_handler(request: httpx.Request) -> httpx.Response:
            captured["headers"] = dict(request.headers)
            captured["body"] = request.content
            return httpx.Response(200, json={"received": True})

        delivery = deliver_webhook_event(str(wh_event.id), custom_transport=httpx.MockTransport(_mock_handler))
        assert delivery["ok"] is True
        wh_event.refresh_from_db()
        assert wh_event.status == WebhookEvent.Status.DELIVERED

        sig_header = captured["headers"]["x-edusms-signature"]
        ev_uid = captured["headers"]["x-edusms-event-id"]
        ok1, _ = verify_and_guard_webhook_replay(
            secret_value=signing_secret,
            signature_header=sig_header,
            event_uid=ev_uid,
            raw_body=captured["body"],
        )
        assert ok1 is True

        # Replaying the exact same signed delivery must be rejected!
        ok2, reason2 = verify_and_guard_webhook_replay(
            secret_value=signing_secret,
            signature_header=sig_header,
            event_uid=ev_uid,
            raw_body=captured["body"],
        )
        assert ok2 is False
        assert "Replay detected" in reason2

        # 6. Exceed per-key rate limit (3/min: 2 calls used above, 3rd succeeds, 4th gets 429)
        assert ext_client.get("/api/v1/messages/").status_code == 200
        assert ext_client.get("/api/v1/messages/").status_code == 429


@pytest.mark.django_db
def test_timezone_schedule_evaluation_and_phone_normalization():
    assert normalize_phone_number("0754 123 456", "TZ") == "+255754123456"
    assert normalize_phone_number("255655987654", "TZ") == "+255655987654"
    assert normalize_phone_number("+1 415 555 2671", "TZ") == "+14155552671"

    user = User.objects.create_user(email="sched@edusms.test", password="StrongPass!2026", full_name="Sched")
    sched = ScheduleWindow.objects.create(
        user=user,
        name="Business Hours EAT",
        timezone="Africa/Dar_es_Salaam",
        days_of_week=[0, 1, 2, 3, 4],  # Mon-Fri
        start_time=time(8, 0),
        end_time=time(17, 0),
    )
    # 2026-10-30 is a Friday; 10:00 EAT == 07:00 UTC (inside window), 21:00 EAT == 18:00 UTC (outside window)
    friday_10am_eat = timezone.datetime(2026, 10, 30, 7, 0, tzinfo=UTC)
    friday_9pm_eat = timezone.datetime(2026, 10, 30, 18, 0, tzinfo=UTC)
    assert is_schedule_active(sched, at_time=friday_10am_eat)[0] is True
    assert is_schedule_active(sched, at_time=friday_9pm_eat)[0] is False

    with pytest.raises(SSRFBlockedError):
        validate_outbound_url("http://169.254.169.254/latest/meta-data/", require_https=False)
