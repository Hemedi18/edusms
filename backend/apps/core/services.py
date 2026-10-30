from __future__ import annotations

import hashlib
import json
from typing import Any
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import AuditEvent, IdempotencyRecord, Notification
from .realtime import broadcast_account_event


def get_client_ip(request) -> str | None:
    if request is None:
        return None
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def record_audit_event(
    *,
    user,
    event_type: str,
    summary: str,
    request=None,
    actor_type: str = AuditEvent.ActorType.USER,
    actor_identifier: str = "",
    target_type: str = "",
    target_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    ip_addr = get_client_ip(request)
    ua = (request.META.get("HTTP_USER_AGENT", "")[:255]) if request is not None else ""
    if not actor_identifier and user is not None:
        actor_identifier = getattr(user, "email", str(user.pk))
    return AuditEvent.objects.create(
        user=user,
        actor_type=actor_type,
        actor_identifier=actor_identifier,
        event_type=event_type,
        target_type=target_type,
        target_id=str(target_id) if target_id else "",
        ip_address=ip_addr,
        user_agent=ua,
        summary=summary[:255],
        metadata=metadata or {},
    )


def create_notification(
    *,
    user,
    title: str,
    body: str,
    category: str = Notification.Category.SYSTEM,
    level: str = Notification.Level.INFO,
    action_url: str = "",
    metadata: dict[str, Any] | None = None,
) -> Notification:
    notif = Notification.objects.create(
        user=user,
        category=category,
        level=level,
        title=title[:160],
        body=body,
        action_url=action_url[:255],
        metadata=metadata or {},
    )
    broadcast_account_event(
        user.id,
        "notification.created",
        {
            "id": str(notif.id),
            "category": notif.category,
            "level": notif.level,
            "title": notif.title,
            "body": notif.body,
            "action_url": notif.action_url,
            "created_at": notif.created_at.isoformat(),
        },
    )
    return notif


def extract_idempotency_key(request) -> str | None:
    header_key = request.headers.get("Idempotency-Key")
    if header_key:
        return header_key.strip()[:128]
    if isinstance(request.data, dict) and request.data.get("idempotency_key"):
        return str(request.data.get("idempotency_key")).strip()[:128]
    return None


def compute_payload_hash(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def check_idempotency(user, key: str | None, endpoint: str, payload: Any) -> Response | None:
    if not key:
        return None
    existing = IdempotencyRecord.objects.filter(user=user, key=key, endpoint=endpoint).first()
    if not existing:
        return None
    req_hash = compute_payload_hash(payload)
    if existing.request_hash != req_hash:
        raise ValidationError(
            {
                "idempotency_key": (
                    "This Idempotency-Key was already used with a different request payload on this endpoint."
                )
            }
        )
    resp = Response(existing.response_body, status=existing.response_status)
    resp["X-Idempotent-Replay"] = "true"
    return resp


def save_idempotency(
    user,
    key: str | None,
    endpoint: str,
    payload: Any,
    response_body: Any,
    response_status: int = status.HTTP_201_CREATED,
) -> None:
    if not key:
        return
    IdempotencyRecord.objects.update_or_create(
        user=user,
        key=key,
        endpoint=endpoint,
        defaults={
            "request_hash": compute_payload_hash(payload),
            "response_status": response_status,
            "response_body": json.loads(json.dumps(response_body, default=str)),
        },
    )
