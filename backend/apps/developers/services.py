"""
Outbound Webhook Event Emission, HMAC-SHA256 Signing, SSRF Validation,
Exponential Backoff Retries, Dead-Letter Handling, and Replay Guard.
"""
from __future__ import annotations

import json
import time
from datetime import timedelta
import httpx
from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.core.crypto import generate_prefixed_token, sign_webhook_payload, verify_webhook_signature
from apps.core.ssrf import SSRFBlockedError, validate_outbound_url
from .models import WebhookDeliveryAttempt, WebhookEndpoint, WebhookEvent


def generate_webhook_signing_secret() -> str:
    return generate_prefixed_token("whsec", 24)


def emit_webhook_event(
    *,
    user,
    event_type: str,
    data: dict,
    is_simulation: bool = False,
    deliver_synchronously: bool = False,
) -> list[WebhookEvent]:
    endpoints = WebhookEndpoint.objects.filter(user=user, is_active=True)
    created_events: list[WebhookEvent] = []

    for endpoint in endpoints:
        if is_simulation and not endpoint.include_simulation_events:
            continue
        subscribed = endpoint.events or []
        if "*" not in subscribed and event_type not in subscribed:
            continue

        uid = WebhookEvent.generate_uid()
        envelope = {
            "id": uid,
            "type": event_type,
            "created_at": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "simulation": is_simulation,
            "data": {**data, "simulation": is_simulation},
        }
        ev = WebhookEvent.objects.create(
            user=user,
            endpoint=endpoint,
            event_uid=uid,
            event_type=event_type,
            is_simulation=is_simulation,
            payload=envelope,
        )
        created_events.append(ev)
        if deliver_synchronously or settings.CELERY_TASK_ALWAYS_EAGER:
            deliver_webhook_event(str(ev.id))
        else:
            try:
                deliver_webhook_event_task.delay(str(ev.id))
            except Exception:
                deliver_webhook_event(str(ev.id))

    return created_events


@shared_task(name="apps.developers.services.deliver_webhook_event_task")
def deliver_webhook_event_task(webhook_event_id: str) -> dict:
    return deliver_webhook_event(webhook_event_id)


def deliver_webhook_event(
    webhook_event_id: str,
    *,
    custom_transport: httpx.BaseTransport | None = None,
) -> dict:
    ev = WebhookEvent.objects.select_related("endpoint").filter(id=webhook_event_id).first()
    if not ev:
        return {"ok": False, "error": "WebhookEvent not found"}
    if ev.status == WebhookEvent.Status.DELIVERED:
        return {"ok": True, "already_delivered": True}

    endpoint = ev.endpoint
    now_ts = int(time.time())
    raw_body = json.dumps(ev.payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    secret = endpoint.get_signing_secret()
    signature = sign_webhook_payload(secret, now_ts, raw_body)

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "EduSMS-Webhooks/1.0",
        "X-EduSMS-Event-Id": ev.event_uid,
        "X-EduSMS-Event-Type": ev.event_type,
        "X-EduSMS-Signature": signature,
        "X-EduSMS-Simulation": "true" if ev.is_simulation else "false",
    }

    ev.attempt_count += 1
    start = time.monotonic()

    try:
        # Pre-flight SSRF check on every delivery attempt (prevents DNS rebinding after endpoint creation!)
        validate_outbound_url(
            endpoint.url,
            require_https=settings.WEBHOOK_REQUIRE_HTTPS,
            resolve_dns=(custom_transport is None),
        )
        client_kwargs = {
            "timeout": float(endpoint.timeout_seconds or 8),
            "follow_redirects": False,  # Never follow redirects to internal/metadata targets!
        }
        if custom_transport is not None:
            client_kwargs["transport"] = custom_transport

        with httpx.Client(**client_kwargs) as client:
            resp = client.post(endpoint.url, content=raw_body, headers=headers)

        latency_ms = int((time.monotonic() - start) * 1000)
        succeeded = 200 <= resp.status_code < 300
        WebhookDeliveryAttempt.objects.create(
            webhook_event=ev,
            attempt_number=ev.attempt_count,
            request_headers=headers,
            response_status_code=resp.status_code,
            response_body_preview=(resp.text or "")[:500],
            latency_ms=latency_ms,
            succeeded=succeeded,
            error_message="" if succeeded else f"Remote endpoint returned HTTP {resp.status_code}",
        )

        if succeeded:
            ev.status = WebhookEvent.Status.DELIVERED
            ev.delivered_at = timezone.now()
            ev.next_retry_at = None
            ev.last_error = ""
            ev.save(update_fields=["attempt_count", "status", "delivered_at", "next_retry_at", "last_error", "updated_at"])
            return {"ok": True, "status_code": resp.status_code, "signature": signature}

        error_msg = f"HTTP {resp.status_code}"
    except SSRFBlockedError as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        error_msg = f"SSRF blocked: {exc}"
        WebhookDeliveryAttempt.objects.create(
            webhook_event=ev,
            attempt_number=ev.attempt_count,
            request_headers=headers,
            latency_ms=latency_ms,
            succeeded=False,
            error_message=error_msg[:255],
        )
        # Permanent security failure — do not retry SSRF destinations
        ev.status = WebhookEvent.Status.DEAD_LETTER
        ev.last_error = error_msg[:255]
        ev.save(update_fields=["attempt_count", "status", "last_error", "updated_at"])
        return {"ok": False, "error": error_msg}
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        error_msg = str(exc)[:255]
        WebhookDeliveryAttempt.objects.create(
            webhook_event=ev,
            attempt_number=ev.attempt_count,
            request_headers=headers,
            latency_ms=latency_ms,
            succeeded=False,
            error_message=error_msg,
        )

    # Exponential backoff retry or dead-letter transition
    if ev.attempt_count >= ev.max_attempts:
        ev.status = WebhookEvent.Status.DEAD_LETTER
        ev.next_retry_at = None
    else:
        backoff_seconds = min(3600, 15 * (2 ** (ev.attempt_count - 1)))
        ev.status = WebhookEvent.Status.RETRYING
        ev.next_retry_at = timezone.now() + timedelta(seconds=backoff_seconds)
        try:
            deliver_webhook_event_task.apply_async(args=[str(ev.id)], countdown=backoff_seconds)
        except Exception:
            pass

    ev.last_error = error_msg[:255]
    ev.save(update_fields=["attempt_count", "status", "next_retry_at", "last_error", "updated_at"])
    return {"ok": False, "error": error_msg, "status": ev.status}


def verify_and_guard_webhook_replay(
    *,
    secret_value: str,
    signature_header: str,
    event_uid: str,
    raw_body: bytes,
    now_timestamp: int | None = None,
) -> tuple[bool, str]:
    now_ts = now_timestamp if now_timestamp is not None else int(time.time())
    tolerance = getattr(settings, "WEBHOOK_SIGNATURE_TOLERANCE_SECONDS", 300)
    if not verify_webhook_signature(
        secret_value=secret_value,
        signature_header=signature_header,
        raw_body=raw_body,
        now_timestamp=now_ts,
        tolerance_seconds=tolerance,
    ):
        return False, "Invalid signature or timestamp outside tolerance window."

    replay_key = f"wh_replay:{event_uid}:{signature_header}"
    if cache.get(replay_key):
        return False, "Replay detected: this signed event delivery has already been processed."
    cache.set(replay_key, "1", timeout=tolerance * 2)
    return True, "Verified"
