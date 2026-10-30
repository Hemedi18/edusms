"""
Core messaging orchestration, strictly separated transports (SIM Gateway, External Provider, Simulation),
gateway job claiming, status callback reconciliation, and Simulation Lab operations.
"""
from __future__ import annotations

from datetime import timedelta
import httpx
from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.contacts.models import ConsentRecord, Contact, ContactGroup, GroupMembership
from apps.contacts.phone_utils import (
    InvalidPhoneNumberError,
    is_shortcode_or_alphanumeric_sender,
    normalize_phone_number,
)
from apps.contacts.services import (
    OPT_IN_KEYWORDS,
    OPT_OUT_KEYWORDS,
    record_opt_in,
    record_opt_out,
    resolve_effective_contact_policy,
)
from apps.core.realtime import broadcast_account_event
from apps.core.ssrf import SSRFBlockedError, validate_outbound_url
from apps.devices.models import Device
from .models import Message, MessageAttempt, MessageDeliveryEvent, SenderIdentityConfig


def _log_delivery_event(
    message: Message,
    event_type: str,
    description: str,
    *,
    attempt: MessageAttempt | None = None,
    raw_status_code: str = "",
) -> MessageDeliveryEvent:
    return MessageDeliveryEvent.objects.create(
        message=message,
        attempt=attempt,
        event_type=event_type,
        raw_status_code=raw_status_code[:64],
        description=description[:255],
        is_simulation=message.is_simulation,
    )


def _broadcast_message_update(message: Message) -> None:
    broadcast_account_event(
        message.user_id,
        "message.updated",
        {
            "id": str(message.id),
            "direction": message.direction,
            "transport_type": message.transport_type,
            "is_simulation": message.is_simulation,
            "sender_number": message.sender_number,
            "recipient_number": message.recipient_number,
            "status": message.status,
            "body_preview": message.body[:100],
            "created_at": message.created_at.isoformat(),
        },
    )


@transaction.atomic
def submit_outbound_message(
    *,
    user,
    recipient_number: str,
    body: str,
    transport_type: str = Message.TransportType.SIMULATION,
    device_id: str | None = None,
    sim_slot: int | None = None,
    sender_identity_id: str | None = None,
    simulated_outcome: str = "simulated_delivered",
    campaign=None,
    in_reply_to: Message | None = None,
    triggered_by_rule=None,
    triggered_by_mode=None,
    matched_policy_summary: str = "",
    is_auto_reply: bool = False,
    ai_generated: bool = False,
    require_approval: bool = False,
    ttl_minutes: int = 120,
    bypass_opt_out_check: bool = False,
) -> Message:
    if not body or not body.strip():
        raise ValidationError({"body": "Message body cannot be empty."})
    if len(body) > 1600:
        raise ValidationError({"body": "Message body exceeds maximum concatenated SMS length (1600 chars)."})

    try:
        normalized_recipient = normalize_phone_number(recipient_number, user.default_country_code)
    except InvalidPhoneNumberError as exc:
        raise ValidationError({"recipient_number": str(exc)}) from exc

    contact = Contact.objects.filter(user=user, phone_number=normalized_recipient).first()
    if not bypass_opt_out_check:
        policy = resolve_effective_contact_policy(user, contact=contact, phone_number=normalized_recipient)
        if not policy["can_send_outgoing"]:
            reasons = "; ".join(policy["blocking_reasons"]) or "Recipient blocked by consent/suppression policy"
            raise ValidationError({"recipient_number": f"Cannot send outbound SMS to {normalized_recipient}: {reasons}."})

    is_simulation = transport_type == Message.TransportType.SIMULATION

    # Enforce daily real SMS safety limit
    if not is_simulation:
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        sent_today = Message.objects.filter(
            user=user,
            direction=Message.Direction.OUTBOUND,
            is_simulation=False,
            created_at__gte=today_start,
        ).exclude(status__in=[Message.Status.CANCELED, Message.Status.FAILED]).count()
        if sent_today >= user.daily_real_sms_limit:
            raise ValidationError(
                {
                    "detail": (
                        f"Daily real SMS safety limit ({user.daily_real_sms_limit}) reached. "
                        "Use Simulation Mode for development testing or adjust your account safety limit."
                    )
                }
            )

    device: Device | None = None
    sender_identity: SenderIdentityConfig | None = None
    sender_number = ""

    if sender_identity_id:
        sender_identity = SenderIdentityConfig.objects.filter(user=user, id=sender_identity_id, is_enabled=True).first()
        if not sender_identity:
            raise ValidationError({"sender_identity_id": "Selected sender identity is invalid or disabled."})

    if transport_type == Message.TransportType.SIM_GATEWAY:
        if device_id:
            device = Device.objects.filter(user=user, id=device_id, revoked_at__isnull=True).first()
        elif sender_identity and sender_identity.device_id:
            device = sender_identity.device
        else:
            device = (
                Device.objects.filter(
                    user=user,
                    platform=Device.Platform.ANDROID,
                    revoked_at__isnull=True,
                    is_enabled=True,
                )
                .order_by("-last_heartbeat_at")
                .first()
            )
        if not device:
            raise ValidationError(
                {
                    "device_id": (
                        "Real SIM Gateway mode requires an authorized paired Android device. "
                        "Pair a phone first or select Simulation Mode—EduSMS never falls back silently to simulation."
                    )
                }
            )
        if device.platform != Device.Platform.ANDROID:
            raise ValidationError({"device_id": "iOS companion devices cannot act as physical SIM SMS gateways."})
        if not device.is_enabled:
            raise ValidationError({"device_id": f"Gateway device '{device.name}' is disabled."})

        resolved_slot = sim_slot if sim_slot is not None else (
            sender_identity.sim_slot if sender_identity else device.selected_sim_slot
        )
        sim_slot = resolved_slot
        for slot_meta in (device.sim_slots or []):
            if int(slot_meta.get("slot_index", 0)) == resolved_slot and slot_meta.get("phone_number"):
                sender_number = str(slot_meta["phone_number"])
                break
        if not sender_number:
            sender_number = f"SIM#{resolved_slot + 1} ({device.name})"

    elif transport_type == Message.TransportType.EXTERNAL_PROVIDER:
        if not sender_identity or sender_identity.identity_type != SenderIdentityConfig.IdentityType.EXTERNAL_PROVIDER:
            raise ValidationError(
                {
                    "sender_identity_id": (
                        "External provider transport requires an External Provider Sender Identity configuration."
                    )
                }
            )
        sender_number = sender_identity.alphanumeric_sender_id or sender_identity.label

    elif transport_type == Message.TransportType.SIMULATION:
        sender_number = "SIMULATOR (+255700000000)"
    else:
        raise ValidationError({"transport_type": f"Unsupported transport_type '{transport_type}'."})

    now = timezone.now()
    expires_at = now + timedelta(minutes=ttl_minutes)

    if require_approval:
        initial_status = Message.Status.PENDING_APPROVAL
    elif is_simulation:
        initial_status = Message.Status.SIMULATED_SENT
    else:
        initial_status = Message.Status.QUEUED

    msg = Message.objects.create(
        user=user,
        contact=contact,
        device=device,
        sender_identity=sender_identity,
        campaign=campaign,
        triggered_by_rule=triggered_by_rule,
        triggered_by_mode=triggered_by_mode,
        in_reply_to=in_reply_to,
        direction=Message.Direction.OUTBOUND,
        transport_type=transport_type,
        is_simulation=is_simulation,
        sender_number=sender_number,
        recipient_number=normalized_recipient,
        sim_slot=sim_slot,
        body=body.strip(),
        status=initial_status,
        matched_policy_summary=matched_policy_summary[:255],
        is_auto_reply=is_auto_reply,
        ai_generated=ai_generated,
        expires_at=expires_at,
        submitted_at=now if is_simulation and not require_approval else None,
    )

    if require_approval:
        _log_delivery_event(msg, "pending_approval", "Held in human-review approval queue before transmission.")
        _broadcast_message_update(msg)
        return msg

    if is_simulation:
        _execute_simulation_transport(msg, simulated_outcome=simulated_outcome)
    elif transport_type == Message.TransportType.SIM_GATEWAY:
        offline_note = (
            "Queued for Android SIM gateway (device currently offline; will transmit before expiry once online)."
            if not device.is_online
            else "Queued for connected Android SIM gateway; awaiting handset poll and SmsManager confirmation."
        )
        _log_delivery_event(msg, "queued", offline_note)
        from apps.developers.services import emit_webhook_event

        emit_webhook_event(
            user=user,
            event_type="sms.queued",
            data={
                "message_id": str(msg.id),
                "recipient": msg.recipient_number,
                "gateway_id": str(device.id),
                "gateway_online": device.is_online,
                "expires_at": expires_at.isoformat(),
                "simulation": False,
            },
        )
    elif transport_type == Message.TransportType.EXTERNAL_PROVIDER:
        _execute_external_provider_transport(msg, sender_identity)

    _broadcast_message_update(msg)
    return msg


def _execute_simulation_transport(msg: Message, simulated_outcome: str = "simulated_delivered") -> None:
    now = timezone.now()
    attempt = MessageAttempt.objects.create(
        message=msg,
        attempt_number=1,
        transport_type=Message.TransportType.SIMULATION,
        status=MessageAttempt.AttemptStatus.SIMULATED,
        claimed_at=now,
        acknowledged_at=now,
        completed_at=now,
    )
    _log_delivery_event(
        msg,
        "simulated_sent",
        "Processed by isolated Simulation Transport (no real carrier SMS transmitted).",
        attempt=attempt,
    )

    from apps.developers.services import emit_webhook_event

    if simulated_outcome == "failed":
        msg.status = Message.Status.FAILED
        msg.failure_code = "SIMULATED_CARRIER_REJECT"
        msg.failure_reason = "Simulated transmission failure configured by developer."
        msg.save(update_fields=["status", "failure_code", "failure_reason", "updated_at"])
        _log_delivery_event(msg, "failed", msg.failure_reason, attempt=attempt, raw_status_code=msg.failure_code)
        emit_webhook_event(
            user=msg.user,
            event_type="sms.failed",
            data={
                "message_id": str(msg.id),
                "recipient": msg.recipient_number,
                "reason": msg.failure_reason,
                "simulation": True,
            },
            is_simulation=True,
        )
    elif simulated_outcome == "delivery_unknown":
        msg.status = Message.Status.DELIVERY_UNKNOWN
        msg.save(update_fields=["status", "updated_fields"] if False else ["status", "updated_at"])
        _log_delivery_event(
            msg,
            "delivery_unknown",
            "Simulated carrier omission of delivery report.",
            attempt=attempt,
        )
        emit_webhook_event(
            user=msg.user,
            event_type="sms.delivery_unknown",
            data={"message_id": str(msg.id), "recipient": msg.recipient_number, "simulation": True},
            is_simulation=True,
        )
    elif simulated_outcome == "simulated_sent":
        msg.status = Message.Status.SIMULATED_SENT
        msg.save(update_fields=["status", "updated_at"])
        emit_webhook_event(
            user=msg.user,
            event_type="sms.sent",
            data={"message_id": str(msg.id), "recipient": msg.recipient_number, "simulation": True},
            is_simulation=True,
        )
    else:
        msg.status = Message.Status.SIMULATED_DELIVERED
        msg.delivered_at = now
        msg.save(update_fields=["status", "delivered_at", "updated_at"])
        _log_delivery_event(
            msg,
            "simulated_delivered",
            "Simulated delivery outcome recorded (distinct from real carrier DLR).",
            attempt=attempt,
        )
        emit_webhook_event(
            user=msg.user,
            event_type="sms.delivered",
            data={"message_id": str(msg.id), "recipient": msg.recipient_number, "simulation": True},
            is_simulation=True,
        )


def _execute_external_provider_transport(msg: Message, sender_identity: SenderIdentityConfig) -> None:
    """
    Executes registered external HTTP SMS provider adapter when configured.
    Never fakes carrier delivery when credentials or provider URL are unconfigured.
    """
    api_key = sender_identity.get_provider_api_key()
    base_url = sender_identity.provider_base_url
    now = timezone.now()
    attempt = MessageAttempt.objects.create(
        message=msg,
        attempt_number=1,
        transport_type=Message.TransportType.EXTERNAL_PROVIDER,
        status=MessageAttempt.AttemptStatus.CLAIMED,
        claimed_at=now,
    )
    if not api_key or not base_url:
        attempt.status = MessageAttempt.AttemptStatus.FAILED
        attempt.completed_at = now
        attempt.error_detail = "External SMS provider credentials/endpoint not configured (Dev Adapter placeholder)."
        attempt.save()
        msg.status = Message.Status.FAILED
        msg.failure_code = "PROVIDER_NOT_CONFIGURED"
        msg.failure_reason = attempt.error_detail
        msg.save(update_fields=["status", "failure_code", "failure_reason", "updated_at"])
        _log_delivery_event(msg, "failed", attempt.error_detail, attempt=attempt, raw_status_code="PROVIDER_NOT_CONFIGURED")
        return

    try:
        validate_outbound_url(base_url, require_https=settings.WEBHOOK_REQUIRE_HTTPS)
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            resp = client.post(
                base_url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "to": msg.recipient_number,
                    "from": sender_identity.alphanumeric_sender_id or sender_identity.label,
                    "text": msg.body,
                },
            )
        if 200 <= resp.status_code < 300:
            attempt.status = MessageAttempt.AttemptStatus.SUBMITTED
            attempt.completed_at = timezone.now()
            attempt.save()
            msg.status = Message.Status.SUBMITTED
            msg.submitted_at = timezone.now()
            msg.save(update_fields=["status", "submitted_at", "updated_at"])
            _log_delivery_event(msg, "submitted", "Accepted by external SMS provider API; awaiting DLR.", attempt=attempt)
        else:
            raise RuntimeError(f"Provider returned HTTP {resp.status_code}")
    except (SSRFBlockedError, Exception) as exc:
        attempt.status = MessageAttempt.AttemptStatus.FAILED
        attempt.completed_at = timezone.now()
        attempt.error_detail = str(exc)[:255]
        attempt.save()
        msg.status = Message.Status.FAILED
        msg.failure_code = "PROVIDER_ERROR"
        msg.failure_reason = str(exc)[:255]
        msg.save(update_fields=["status", "failure_code", "failure_reason", "updated_at"])
        _log_delivery_event(msg, "failed", msg.failure_reason, attempt=attempt, raw_status_code="PROVIDER_ERROR")


@transaction.atomic
def claim_outbound_jobs_for_device(*, device: Device, limit: int = 10) -> list[dict]:
    now = timezone.now()
    # First expire any stale queued jobs for this device so offline expired jobs are never transmitted late!
    expired_qs = Message.objects.filter(
        device=device,
        is_simulation=False,
        status=Message.Status.QUEUED,
        expires_at__lte=now,
    )
    for exp_msg in expired_qs:
        exp_msg.status = Message.Status.EXPIRED
        exp_msg.failure_code = "JOB_EXPIRED"
        exp_msg.failure_reason = "Message expired while gateway device was offline."
        exp_msg.save(update_fields=["status", "failure_code", "failure_reason", "updated_at"])
        _log_delivery_event(exp_msg, "expired", exp_msg.failure_reason, raw_status_code="JOB_EXPIRED")

    due_messages = list(
        Message.objects.select_for_update(skip_locked=True)
        .filter(
            device=device,
            is_simulation=False,
            transport_type=Message.TransportType.SIM_GATEWAY,
            direction=Message.Direction.OUTBOUND,
            status=Message.Status.QUEUED,
        )
        .filter(models_due_q(now))
        .order_by("created_at")[:limit]
    )

    jobs: list[dict] = []
    for msg in due_messages:
        next_num = msg.attempts.count() + 1
        attempt = MessageAttempt.objects.create(
            message=msg,
            device=device,
            attempt_number=next_num,
            transport_type=Message.TransportType.SIM_GATEWAY,
            sim_slot=msg.sim_slot if msg.sim_slot is not None else device.selected_sim_slot,
            status=MessageAttempt.AttemptStatus.CLAIMED,
            claimed_at=now,
        )
        msg.status = Message.Status.DISPATCHED_TO_DEVICE
        msg.save(update_fields=["status", "updated_at"])
        _log_delivery_event(
            msg,
            "claimed",
            f"Claimed by Android gateway '{device.name}' (attempt #{next_num}).",
            attempt=attempt,
        )
        _broadcast_message_update(msg)
        jobs.append(
            {
                "attempt_id": str(attempt.id),
                "message_id": str(msg.id),
                "recipient_number": msg.recipient_number,
                "body": msg.body,
                "sim_slot": attempt.sim_slot,
                "expires_at": msg.expires_at.isoformat() if msg.expires_at else None,
            }
        )
    return jobs


def models_due_q(now):
    from django.db.models import Q

    return (Q(scheduled_for__isnull=True) | Q(scheduled_for__lte=now)) & (
        Q(expires_at__isnull=True) | Q(expires_at__gt=now)
    )


@transaction.atomic
def process_gateway_status_callback(*, device: Device, payload: dict) -> dict:
    """
    Processes authentic Android SmsManager callbacks:
    - `event`: `sent` (`RESULT_OK` -> `submitted`, NOT `delivered`!), `send_failed`, `delivered`, `delivery_failed`, `delivery_unknown`
    """
    attempt_id = payload.get("attempt_id")
    message_id = payload.get("message_id")
    event = (payload.get("event") or "").strip().lower()
    raw_code = str(payload.get("android_result_code") or payload.get("status_code") or "")
    detail = str(payload.get("detail") or "")

    attempt = None
    if attempt_id:
        attempt = (
            MessageAttempt.objects.select_for_update()
            .select_related("message")
            .filter(id=attempt_id, device=device, message__is_simulation=False)
            .first()
        )
        msg = attempt.message if attempt else None
    elif message_id:
        msg = Message.objects.select_for_update().filter(id=message_id, device=device, is_simulation=False).first()
    else:
        raise ValidationError({"detail": "Either attempt_id or message_id is required."})

    if not msg:
        raise ValidationError({"detail": "Matching gateway message job not found for this device."})

    now = timezone.now()
    from apps.developers.services import emit_webhook_event

    if event == "sent":
        # SmsManager accepted PDU for radio transmission -> SUBMITTED (never DELIVERED!)
        if msg.status != Message.Status.DELIVERED:
            msg.status = Message.Status.SUBMITTED
        msg.submitted_at = msg.submitted_at or now
        msg.save(update_fields=["status", "submitted_at", "updated_at"])
        if attempt:
            attempt.status = MessageAttempt.AttemptStatus.SUBMITTED
            attempt.android_result_code = raw_code or "RESULT_OK"
            attempt.completed_at = now
            attempt.save()
        Device.objects.filter(pk=device.pk).update(outgoing_message_count=F("outgoing_message_count") + 1)
        _log_delivery_event(
            msg,
            "submitted",
            detail or "Android SmsManager accepted SMS for radio transmission (awaiting carrier delivery report).",
            attempt=attempt,
            raw_status_code=raw_code or "RESULT_OK",
        )
        emit_webhook_event(
            user=msg.user,
            event_type="sms.sent",
            data={
                "message_id": str(msg.id),
                "recipient": msg.recipient_number,
                "gateway_id": str(device.id),
                "simulation": False,
            },
        )
    elif event == "delivered":
        msg.status = Message.Status.DELIVERED
        msg.delivered_at = now
        msg.save(update_fields=["status", "delivered_at", "updated_at"])
        _log_delivery_event(
            msg,
            "delivered",
            detail or "Carrier delivery report PDU confirmed delivery to recipient handset.",
            attempt=attempt,
            raw_status_code=raw_code or "DELIVERED_OK",
        )
        emit_webhook_event(
            user=msg.user,
            event_type="sms.delivered",
            data={
                "message_id": str(msg.id),
                "recipient": msg.recipient_number,
                "gateway_id": str(device.id),
                "simulation": False,
            },
        )
    elif event == "delivery_unknown":
        if msg.status != Message.Status.DELIVERED:
            msg.status = Message.Status.DELIVERY_UNKNOWN
            msg.save(update_fields=["status", "updated_at"])
        _log_delivery_event(
            msg,
            "delivery_unknown",
            detail or "SMS submitted, but carrier did not return a delivery confirmation PDU.",
            attempt=attempt,
            raw_status_code=raw_code,
        )
        emit_webhook_event(
            user=msg.user,
            event_type="sms.delivery_unknown",
            data={"message_id": str(msg.id), "recipient": msg.recipient_number, "gateway_id": str(device.id), "simulation": False},
        )
    elif event in {"send_failed", "failed", "delivery_failed"}:
        msg.status = Message.Status.FAILED
        msg.failure_code = raw_code[:64] or "ANDROID_SMS_ERROR"
        msg.failure_reason = detail[:255] or "Android SmsManager reported transmission error."
        msg.save(update_fields=["status", "failure_code", "failure_reason", "updated_at"])
        if attempt:
            attempt.status = MessageAttempt.AttemptStatus.FAILED
            attempt.android_result_code = msg.failure_code
            attempt.error_detail = msg.failure_reason
            attempt.completed_at = now
            attempt.save()
        Device.objects.filter(pk=device.pk).update(
            failed_transmission_count=F("failed_transmission_count") + 1,
            last_error=msg.failure_reason,
        )
        _log_delivery_event(msg, "failed", msg.failure_reason, attempt=attempt, raw_status_code=msg.failure_code)
        emit_webhook_event(
            user=msg.user,
            event_type="sms.failed",
            data={
                "message_id": str(msg.id),
                "recipient": msg.recipient_number,
                "gateway_id": str(device.id),
                "error_code": msg.failure_code,
                "reason": msg.failure_reason,
                "simulation": False,
            },
        )
    else:
        raise ValidationError({"event": f"Unsupported status callback event '{event}'."})

    # Reconcile campaign recipient row if part of a bulk campaign
    if msg.campaign_id:
        from apps.campaigns.services import sync_campaign_recipient_from_message

        sync_campaign_recipient_from_message(msg)

    _broadcast_message_update(msg)
    return {"message_id": str(msg.id), "status": msg.status}


@transaction.atomic
def ingest_gateway_inbound_sms(*, device: Device, payload: dict) -> dict:
    """
    Synchronizes an incoming SMS from the paired Android SIM gateway with deduplication,
    privacy retention settings, STOP/START consent handling, and auto-responder evaluation.
    """
    user = device.user
    raw_sender = str(payload.get("sender") or payload.get("sender_number") or "").strip()
    raw_body = str(payload.get("body") or payload.get("text") or "")
    ext_id = str(payload.get("external_message_id") or payload.get("client_event_id") or "").strip()[:128]
    sim_slot = payload.get("sim_slot")

    if not raw_sender:
        raise ValidationError({"sender": "Sender phone number or identifier is required."})
    if not ext_id:
        raise ValidationError({"external_message_id": "Unique external_message_id is required for deduplication."})

    # Deduplication check
    existing = Message.objects.filter(user=user, device=device, external_message_id=ext_id).first()
    if existing:
        return {"message_id": str(existing.id), "deduplicated": True, "auto_reply_id": None}

    try:
        sender_norm = normalize_phone_number(raw_sender, user.default_country_code)
    except InvalidPhoneNumberError:
        sender_norm = raw_sender[:32]

    contact = Contact.objects.filter(user=user, phone_number=sender_norm).first()
    stored_body = raw_body if user.store_inbound_message_body else "[Redacted per account privacy policy]"

    msg = Message.objects.create(
        user=user,
        contact=contact,
        device=device,
        direction=Message.Direction.INBOUND,
        transport_type=Message.TransportType.SIM_GATEWAY,
        is_simulation=False,
        sender_number=sender_norm,
        recipient_number=f"SIM#{int(sim_slot) + 1}" if sim_slot is not None else device.name,
        sim_slot=int(sim_slot) if sim_slot is not None else None,
        body=stored_body,
        body_redacted=not user.store_inbound_message_body,
        status=Message.Status.RECEIVED,
        external_message_id=ext_id,
        received_at=timezone.now(),
    )
    Device.objects.filter(pk=device.pk).update(
        incoming_message_count=F("incoming_message_count") + 1,
        last_synced_at=timezone.now(),
    )
    _log_delivery_event(msg, "received", f"Synchronized inbound SMS from {sender_norm} via '{device.name}'.")

    from apps.developers.services import emit_webhook_event

    emit_webhook_event(
        user=user,
        event_type="sms.received",
        data={
            "message_id": str(msg.id),
            "sender": sender_norm,
            "text": stored_body,
            "gateway_id": str(device.id),
            "simulation": False,
        },
    )

    # Consent keyword handling (STOP / START)
    upper_word = raw_body.strip().upper()
    if upper_word in OPT_OUT_KEYWORDS:
        try:
            record_opt_out(
                user=user,
                phone_number=sender_norm,
                source=ConsentRecord.Source.INBOUND_KEYWORD,
                note=f"Inbound keyword '{upper_word}'",
            )
            msg.matched_policy_summary = f"Processed opt-out keyword '{upper_word}'; sender suppressed."
            msg.save(update_fields=["matched_policy_summary", "updated_at"])
        except InvalidPhoneNumberError:
            pass
        _broadcast_message_update(msg)
        return {"message_id": str(msg.id), "deduplicated": False, "opted_out": True, "auto_reply_id": None}

    if upper_word in OPT_IN_KEYWORDS:
        try:
            record_opt_in(
                user=user,
                phone_number=sender_norm,
                source=ConsentRecord.Source.INBOUND_KEYWORD,
                note=f"Inbound keyword '{upper_word}'",
            )
        except InvalidPhoneNumberError:
            pass

    # Evaluate intelligent auto-responder using real SIM transport
    from apps.automation.services import evaluate_and_respond_to_inbound

    eval_result = evaluate_and_respond_to_inbound(
        inbound_message=msg,
        raw_unredacted_body=raw_body,
        is_simulation=False,
        device=device,
    )
    _broadcast_message_update(msg)
    return {
        "message_id": str(msg.id),
        "deduplicated": False,
        "auto_reply_id": eval_result.get("reply_message_id"),
        "decision": eval_result.get("decision"),
    }


@transaction.atomic
def inject_simulated_inbound_sms(*, user, sender_number: str, body: str) -> dict:
    """
    Injects a virtual incoming SMS strictly in Simulation Mode.
    Evaluates real keyword rules, automation modes, schedules, and AI providers,
    while guaranteeing that any generated reply uses `SimulationTransport` ONLY.
    """
    try:
        sender_norm = normalize_phone_number(sender_number, user.default_country_code)
    except InvalidPhoneNumberError as exc:
        if is_shortcode_or_alphanumeric_sender(sender_number):
            sender_norm = sender_number.strip()[:32]
        else:
            raise ValidationError({"sender_number": str(exc)}) from exc

    contact = Contact.objects.filter(user=user, phone_number=sender_norm).first()
    msg = Message.objects.create(
        user=user,
        contact=contact,
        direction=Message.Direction.INBOUND,
        transport_type=Message.TransportType.SIMULATION,
        is_simulation=True,
        sender_number=sender_norm,
        recipient_number="SIMULATOR (+255700000000)",
        body=body.strip(),
        status=Message.Status.SIMULATED_RECEIVED,
        received_at=timezone.now(),
    )
    _log_delivery_event(msg, "simulated_received", "Injected sample inbound SMS in Simulation Mode.")

    from apps.developers.services import emit_webhook_event

    emit_webhook_event(
        user=user,
        event_type="sms.received",
        data={
            "message_id": str(msg.id),
            "sender": sender_norm,
            "text": msg.body,
            "gateway_id": "simulation",
            "simulation": True,
        },
        is_simulation=True,
    )

    upper_word = body.strip().upper()
    if upper_word in OPT_OUT_KEYWORDS:
        record_opt_out(
            user=user,
            phone_number=sender_norm,
            source=ConsentRecord.Source.INBOUND_KEYWORD,
            note=f"Simulated inbound keyword '{upper_word}'",
        )
        msg.matched_policy_summary = f"Processed opt-out keyword '{upper_word}'; sender opted out."
        msg.save(update_fields=["matched_policy_summary", "updated_at"])
        _broadcast_message_update(msg)
        return {
            "inbound_message_id": str(msg.id),
            "decision": "opted_out",
            "summary": msg.matched_policy_summary,
            "reply_message": None,
        }

    if upper_word in OPT_IN_KEYWORDS:
        record_opt_in(
            user=user,
            phone_number=sender_norm,
            source=ConsentRecord.Source.INBOUND_KEYWORD,
            note=f"Simulated inbound keyword '{upper_word}'",
        )
        msg.matched_policy_summary = f"Processed opt-in keyword '{upper_word}'; sender re-opted in."
        msg.save(update_fields=["matched_policy_summary", "updated_at"])
        _broadcast_message_update(msg)
        return {
            "inbound_message_id": str(msg.id),
            "decision": "opted_in",
            "summary": msg.matched_policy_summary,
            "reply_message": None,
        }

    from apps.automation.services import evaluate_and_respond_to_inbound

    eval_result = evaluate_and_respond_to_inbound(
        inbound_message=msg,
        raw_unredacted_body=body,
        is_simulation=True,
        device=None,
    )
    _broadcast_message_update(msg)
    return {
        "inbound_message_id": str(msg.id),
        **eval_result,
    }


@transaction.atomic
def seed_simulation_demo_dataset(user) -> dict:
    """Creates a realistic developer demonstration dataset in Simulation Mode."""
    from apps.automation.models import AIProviderConfig, AutoReplyRule
    from apps.automation.services import ensure_builtin_modes_for_user

    ensure_builtin_modes_for_user(user)
    students_group, _ = ContactGroup.objects.get_or_create(
        user=user,
        name="CS101 Students",
        defaults={"description": "Computer Science lab notifications & Q&A", "color": "#06B6D4", "allow_ai_reply": True},
    )
    staff_group, _ = ContactGroup.objects.get_or_create(
        user=user,
        name="Faculty & TAs",
        defaults={"description": "Department staff & teaching assistants", "color": "#8B5CF6", "allow_ai_reply": True},
    )

    sample_contacts = [
        ("Amina Mwakasege", "+255754100201", students_group, True),
        ("Juma Kikwete", "+255713200302", students_group, True),
        ("Neema Massawe", "+255655300403", staff_group, True),
        ("Baraka Nyerere (Opted Out)", "+255784400504", students_group, False),
    ]
    created_contacts = 0
    for name, phone, grp, opted_in in sample_contacts:
        c, created = Contact.objects.get_or_create(
            user=user,
            phone_number=phone,
            defaults={
                "name": name,
                "is_virtual": True,
                "opt_in_status": opted_in,
                "opt_in_at": timezone.now() if opted_in else None,
                "opt_out_status": not opted_in,
                "opt_out_at": timezone.now() if not opted_in else None,
            },
        )
        if created:
            created_contacts += 1
        GroupMembership.objects.get_or_create(contact=c, group=grp)
        if not opted_in:
            record_opt_out(user=user, phone_number=phone, note="Demo opt-out contact")

    rule1, _ = AutoReplyRule.objects.get_or_create(
        user=user,
        name="Opening Hours Inquiry",
        defaults={
            "match_mode": AutoReplyRule.MatchMode.CONTAINS,
            "keywords": ["opening hours", "office hours"],
            "response_template": "Hello {{contact_name}}, our opening hours are Monday to Friday, 8:00 AM to 5:00 PM.",
            "priority": 100,
            "cooldown_minutes": 5,
            "is_enabled": True,
        },
    )
    AutoReplyRule.objects.get_or_create(
        user=user,
        name="Exam Timetable Lookup",
        defaults={
            "match_mode": AutoReplyRule.MatchMode.REGEX,
            "keywords": [r"\b(exam|timetable|schedule)\b"],
            "response_template": "Hi {{contact_name}}, the semester exam timetable is posted on portal.edusms.ac.tz.",
            "priority": 80,
            "cooldown_minutes": 10,
            "is_enabled": True,
        },
    )
    AIProviderConfig.objects.get_or_create(
        user=user,
        name="Deterministic Lab Mock AI",
        defaults={
            "provider_type": AIProviderConfig.ProviderType.DETERMINISTIC_MOCK,
            "model_name": "edusms-mock-v1",
            "is_enabled": True,
            "system_instructions": "Reply concisely and helpfully to student SMS questions in <=160 characters.",
            "fallback_message": "Thanks for your message! Our team will follow up shortly.",
        },
    )

    # Inject one sample simulated inbound exchange if none exist yet
    if not Message.objects.filter(user=user, is_simulation=True).exists():
        inject_simulated_inbound_sms(
            user=user,
            sender_number="+255754100201",
            body="Hello, what are your opening hours?",
        )

    return {
        "status": "seeded",
        "virtual_contacts_created": created_contacts,
        "sample_rule": rule1.name,
    }


@transaction.atomic
def reset_simulation_data(user) -> dict:
    from apps.campaigns.models import BulkCampaign

    deleted_msgs, _ = Message.objects.filter(user=user, is_simulation=True).delete()
    deleted_campaigns, _ = BulkCampaign.objects.filter(user=user, is_simulation=True).delete()
    deleted_virtual_contacts, _ = Contact.objects.filter(user=user, is_virtual=True).delete()
    return {
        "deleted_simulated_messages": deleted_msgs,
        "deleted_simulated_campaigns": deleted_campaigns,
        "deleted_virtual_contacts": deleted_virtual_contacts,
    }
