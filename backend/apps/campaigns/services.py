"""
Audience building, deduplication, consent/suppression filtering, throttled execution,
cancellation, error-threshold auto-pause, and accurate reporting for Bulk SMS Campaigns.
"""
from __future__ import annotations

import csv
import io
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.automation.services import render_response_template
from apps.contacts.models import Contact, ContactGroup
from apps.contacts.phone_utils import InvalidPhoneNumberError, normalize_phone_number
from apps.contacts.services import is_time_in_quiet_window, resolve_effective_contact_policy
from apps.core.realtime import broadcast_account_event
from apps.messaging.models import Message
from apps.messaging.services import submit_outbound_message
from .models import BulkCampaign, CampaignRecipient


def build_campaign_audience_preview(
    *,
    user,
    message_template: str,
    contact_ids: list[str] | None = None,
    group_ids: list[str] | None = None,
    raw_numbers: list[str] | None = None,
    csv_text: str = "",
    max_volume: int = 1000,
    is_simulation: bool = True,
) -> dict:
    candidates: list[tuple[str, str, Contact | None]] = []

    if contact_ids:
        for c in Contact.objects.filter(user=user, id__in=contact_ids):
            candidates.append((c.phone_number, c.name, c))

    if group_ids:
        groups = ContactGroup.objects.filter(user=user, id__in=group_ids)
        for c in Contact.objects.filter(user=user, groups__in=groups).distinct():
            candidates.append((c.phone_number, c.name, c))

    for num in (raw_numbers or []):
        if str(num).strip():
            candidates.append((str(num).strip(), "", None))

    if csv_text and csv_text.strip():
        reader = csv.DictReader(io.StringIO(csv_text.strip()))
        for row in reader:
            raw_phone = (
                row.get("phone_number") or row.get("phone") or row.get("mobile") or row.get("number") or ""
            ).strip()
            name = (row.get("name") or row.get("full_name") or "").strip()
            if raw_phone:
                candidates.append((raw_phone, name, None))

    total_input = len(candidates)
    seen_phones: set[str] = set()
    duplicates_removed = 0
    eligible: list[dict] = []
    excluded: list[dict] = []

    cap = min(max_volume or 1000, getattr(settings, "MAX_CAMPAIGN_RECIPIENTS_PER_RUN", 5000))

    for idx, (raw_phone, name_hint, contact_obj) in enumerate(candidates):
        try:
            norm = normalize_phone_number(raw_phone, user.default_country_code)
        except InvalidPhoneNumberError as exc:
            invalid_key = f"invalid:{idx}:{raw_phone[:28]}"
            excluded.append(
                {
                    "phone_number": invalid_key,
                    "display_input": raw_phone,
                    "name": name_hint,
                    "contact": None,
                    "reason": f"Invalid number: {exc}",
                }
            )
            continue

        if norm in seen_phones:
            duplicates_removed += 1
            continue
        seen_phones.add(norm)

        contact = contact_obj or Contact.objects.filter(user=user, phone_number=norm).first()
        display_name = (contact.name if contact else name_hint) or ""
        policy = resolve_effective_contact_policy(user, contact=contact, phone_number=norm)

        if not policy["can_send_outgoing"]:
            excluded.append(
                {
                    "phone_number": norm,
                    "display_input": raw_phone,
                    "name": display_name,
                    "contact": contact,
                    "reason": "; ".join(policy["blocking_reasons"]) or "Opted out or suppressed",
                }
            )
            continue

        # Enforce explicit opt-in consent on real carrier bulk campaigns when account requires it
        if not is_simulation and user.require_consent_for_campaigns and (not contact or not contact.opt_in_status):
            excluded.append(
                {
                    "phone_number": norm,
                    "display_input": raw_phone,
                    "name": display_name,
                    "contact": contact,
                    "reason": "Missing explicit opt-in consent required for real SIM/provider campaigns",
                }
            )
            continue

        if len(eligible) >= cap:
            excluded.append(
                {
                    "phone_number": norm,
                    "display_input": raw_phone,
                    "name": display_name,
                    "contact": contact,
                    "reason": f"Exceeded campaign max_volume cap ({cap})",
                }
            )
            continue

        rendered = render_response_template(
            message_template,
            user=user,
            contact=contact,
            sender_number=norm,
        )
        eligible.append(
            {
                "phone_number": norm,
                "name": display_name,
                "contact": contact,
                "rendered_body": rendered,
            }
        )

    return {
        "total_input_count": total_input,
        "duplicate_removed_count": duplicates_removed,
        "eligible_count": len(eligible),
        "excluded_count": len(excluded),
        "eligible": eligible,
        "excluded": excluded,
        "sample_preview": eligible[0]["rendered_body"] if eligible else render_response_template(message_template, user=user),
    }


@transaction.atomic
def create_campaign_with_recipients(
    *,
    user,
    validated_data: dict,
    contact_ids: list[str] | None = None,
    group_ids: list[str] | None = None,
    raw_numbers: list[str] | None = None,
    csv_text: str = "",
) -> BulkCampaign:
    transport_type = validated_data.get("transport_type", BulkCampaign.TransportType.SIMULATION)
    is_simulation = transport_type == BulkCampaign.TransportType.SIMULATION
    validated_data["is_simulation"] = is_simulation

    if transport_type == BulkCampaign.TransportType.SIM_GATEWAY:
        device = validated_data.get("device")
        if not device or device.user_id != user.id or device.is_revoked:
            raise ValidationError({"device": "A valid paired Android SIM gateway device is required for Real SIM campaigns."})

    audience = build_campaign_audience_preview(
        user=user,
        message_template=validated_data["message_template"],
        contact_ids=contact_ids,
        group_ids=group_ids,
        raw_numbers=raw_numbers,
        csv_text=csv_text,
        max_volume=validated_data.get("max_volume", 1000),
        is_simulation=is_simulation,
    )
    if audience["eligible_count"] == 0 and audience["excluded_count"] == 0:
        raise ValidationError({"detail": "Select at least one contact, group, or CSV recipient."})

    campaign = BulkCampaign.objects.create(
        user=user,
        total_input_count=audience["total_input_count"],
        duplicate_removed_count=audience["duplicate_removed_count"],
        **validated_data,
    )

    recipient_rows: list[CampaignRecipient] = []
    for item in audience["eligible"]:
        recipient_rows.append(
            CampaignRecipient(
                campaign=campaign,
                contact=item["contact"],
                phone_number=item["phone_number"],
                recipient_name=item["name"][:160],
                rendered_body=item["rendered_body"],
                status=CampaignRecipient.Status.PENDING,
            )
        )
    for item in audience["excluded"]:
        recipient_rows.append(
            CampaignRecipient(
                campaign=campaign,
                contact=item["contact"],
                phone_number=item["phone_number"][:40],
                recipient_name=item["name"][:160],
                status=CampaignRecipient.Status.EXCLUDED,
                exclusion_reason=item["reason"][:255],
            )
        )
    CampaignRecipient.objects.bulk_create(recipient_rows)
    return campaign


def compute_campaign_stats(campaign: BulkCampaign) -> dict:
    counts = dict(
        campaign.recipients.values_list("status").annotate(cnt=Count("id")).values_list("status", "cnt")
    )
    total_unique = sum(counts.values())
    excluded = counts.get(CampaignRecipient.Status.EXCLUDED, 0)
    eligible = total_unique - excluded
    pending = counts.get(CampaignRecipient.Status.PENDING, 0)
    queued = counts.get(CampaignRecipient.Status.QUEUED, 0)
    submitted = counts.get(CampaignRecipient.Status.SUBMITTED, 0)
    delivered = counts.get(CampaignRecipient.Status.DELIVERED, 0)
    sim_sent = counts.get(CampaignRecipient.Status.SIMULATED_SENT, 0)
    sim_delivered = counts.get(CampaignRecipient.Status.SIMULATED_DELIVERED, 0)
    unknown = counts.get(CampaignRecipient.Status.DELIVERY_UNKNOWN, 0)
    failed = counts.get(CampaignRecipient.Status.FAILED, 0)
    canceled = counts.get(CampaignRecipient.Status.CANCELED, 0)
    expired = counts.get(CampaignRecipient.Status.EXPIRED, 0)

    attempts = queued + submitted + delivered + sim_sent + sim_delivered + unknown + failed + expired
    return {
        "total_input_recipients": campaign.total_input_count,
        "duplicates_removed": campaign.duplicate_removed_count,
        "total_recipients": total_unique,
        "eligible_recipients": eligible,
        "excluded_recipients": excluded,
        "pending_messages": pending,
        "queued_messages": queued,
        "transmission_attempts": attempts,
        "submitted_messages": submitted,
        "delivery_confirmed_messages": delivered,
        "simulated_sent_messages": sim_sent,
        "simulated_delivered_messages": sim_delivered,
        "unknown_delivery_messages": unknown,
        "failed_messages": failed,
        "canceled_messages": canceled,
        "expired_messages": expired,
    }


def is_campaign_within_operating_window(campaign: BulkCampaign, now_utc=None) -> tuple[bool, str]:
    now_utc = now_utc or timezone.now()
    tz = ZoneInfo(campaign.timezone or "UTC")
    local_time = now_utc.astimezone(tz).time()

    if campaign.quiet_hours_start and campaign.quiet_hours_end:
        if is_time_in_quiet_window(local_time, campaign.quiet_hours_start, campaign.quiet_hours_end):
            return False, f"Paused during campaign quiet hours ({campaign.quiet_hours_start}–{campaign.quiet_hours_end})"

    if campaign.operating_window_start and campaign.operating_window_end:
        if not is_time_in_quiet_window(local_time, campaign.operating_window_start, campaign.operating_window_end):
            return False, f"Outside permitted operating window ({campaign.operating_window_start}–{campaign.operating_window_end})"

    return True, "Inside operating window"


@transaction.atomic
def process_campaign_batch(campaign_id: str, batch_size: int = 25) -> dict:
    """
    Concurrency-safe batch processor for a running campaign.
    Re-verifies campaign cancellation, expiry, operating windows, live opt-out status,
    per-recipient cooldowns, and auto-pause failure thresholds.
    """
    from apps.developers.services import emit_webhook_event

    campaign = BulkCampaign.objects.select_for_update().filter(id=campaign_id).first()
    if not campaign or campaign.status != BulkCampaign.Status.RUNNING:
        return {"processed": 0, "status": campaign.status if campaign else "missing"}

    now = timezone.now()
    if campaign.expires_at and now >= campaign.expires_at:
        campaign.recipients.filter(status=CampaignRecipient.Status.PENDING).update(
            status=CampaignRecipient.Status.EXPIRED,
            error_detail="Campaign expired before recipient could be processed.",
            processed_at=now,
        )
        campaign.status = BulkCampaign.Status.COMPLETED
        campaign.completed_at = now
        campaign.save(update_fields=["status", "completed_at", "updated_at"])
        return {"processed": 0, "status": campaign.status, "reason": "expired"}

    win_ok, win_reason = is_campaign_within_operating_window(campaign, now_utc=now)
    if not win_ok:
        return {"processed": 0, "status": campaign.status, "deferred_reason": win_reason}

    pending_entries = list(
        CampaignRecipient.objects.select_for_update(of=("self",), skip_locked=True)
        .filter(campaign=campaign, status=CampaignRecipient.Status.PENDING)
        .select_related("contact")
        .order_by("created_at")[:batch_size]
    )

    processed_now = 0
    for entry in pending_entries:
        # Re-check campaign wasn't canceled mid-loop
        campaign.refresh_from_db(fields=["status"])
        if campaign.status != BulkCampaign.Status.RUNNING:
            break

        # Re-verify live opt-out/suppression right before sending!
        live_policy = resolve_effective_contact_policy(
            campaign.user,
            contact=entry.contact,
            phone_number=entry.phone_number,
            at_time=now,
        )
        if not live_policy["can_send_outgoing"]:
            entry.status = CampaignRecipient.Status.EXCLUDED
            entry.exclusion_reason = "; ".join(live_policy["blocking_reasons"]) or "Opted out before send"
            entry.processed_at = now
            entry.save(update_fields=["status", "exclusion_reason", "processed_at", "updated_at"])
            continue

        # Per-recipient cooldown check across outbound messages
        if campaign.recipient_cooldown_minutes > 0:
            recent = Message.objects.filter(
                user=campaign.user,
                direction=Message.Direction.OUTBOUND,
                recipient_number=entry.phone_number,
                is_simulation=campaign.is_simulation,
                created_at__gte=now - timedelta(minutes=campaign.recipient_cooldown_minutes),
            ).exclude(status=Message.Status.CANCELED).exists()
            if recent:
                entry.status = CampaignRecipient.Status.EXCLUDED
                entry.exclusion_reason = f"Skipped due to {campaign.recipient_cooldown_minutes}m recipient cooldown"
                entry.processed_at = now
                entry.save(update_fields=["status", "exclusion_reason", "processed_at", "updated_at"])
                continue

        body_text = entry.rendered_body or render_response_template(
            campaign.message_template,
            user=campaign.user,
            contact=entry.contact,
            sender_number=entry.phone_number,
        )
        entry.attempts_count += 1
        try:
            msg = submit_outbound_message(
                user=campaign.user,
                recipient_number=entry.phone_number,
                body=body_text,
                transport_type=campaign.transport_type,
                device_id=str(campaign.device_id) if campaign.device_id else None,
                sim_slot=campaign.sim_slot,
                sender_identity_id=str(campaign.sender_identity_id) if campaign.sender_identity_id else None,
                simulated_outcome=campaign.simulated_outcome,
                campaign=campaign,
            )
            entry.message = msg
            entry.processed_at = now
            entry.status = _map_message_status_to_recipient_status(msg.status)
            if msg.delivered_at:
                entry.delivered_at = msg.delivered_at
            if msg.failure_reason:
                entry.error_detail = msg.failure_reason
            entry.save()
        except Exception as exc:
            entry.status = CampaignRecipient.Status.FAILED
            entry.error_detail = str(exc)[:255]
            entry.processed_at = now
            entry.save()
        processed_now += 1

    stats = compute_campaign_stats(campaign)

    # Check failure rate safety threshold (once >= 4 attempts have executed)
    if stats["transmission_attempts"] >= 4 and campaign.error_pause_threshold_pct > 0:
        fail_pct = (stats["failed_messages"] * 100.0) / max(1, stats["transmission_attempts"])
        if fail_pct >= campaign.error_pause_threshold_pct and stats["pending_messages"] > 0:
            campaign.status = BulkCampaign.Status.PAUSED
            campaign.pause_reason = (
                f"Auto-paused by safety guard: failure rate {fail_pct:.0f}% exceeded threshold ({campaign.error_pause_threshold_pct}%)."
            )
            campaign.save(update_fields=["status", "pause_reason", "updated_at"])
            emit_webhook_event(
                user=campaign.user,
                event_type="campaign.failed",
                data={"campaign_id": str(campaign.id), "pause_reason": campaign.pause_reason, "simulation": campaign.is_simulation},
                is_simulation=campaign.is_simulation,
            )
            return {"processed": processed_now, "status": campaign.status, "stats": stats}

    if stats["pending_messages"] == 0 and stats["queued_messages"] == 0:
        campaign.status = BulkCampaign.Status.COMPLETED
        campaign.completed_at = now
        campaign.save(update_fields=["status", "completed_at", "updated_at"])
        emit_webhook_event(
            user=campaign.user,
            event_type="campaign.completed",
            data={"campaign_id": str(campaign.id), "stats": stats, "simulation": campaign.is_simulation},
            is_simulation=campaign.is_simulation,
        )
    else:
        emit_webhook_event(
            user=campaign.user,
            event_type="campaign.progress",
            data={"campaign_id": str(campaign.id), "stats": stats, "simulation": campaign.is_simulation},
            is_simulation=campaign.is_simulation,
        )

    broadcast_account_event(
        campaign.user_id,
        "campaign.progress",
        {"campaign_id": str(campaign.id), "status": campaign.status, "stats": stats},
    )
    return {"processed": processed_now, "status": campaign.status, "stats": stats}


def _map_message_status_to_recipient_status(msg_status: str) -> str:
    mapping = {
        Message.Status.QUEUED: CampaignRecipient.Status.QUEUED,
        Message.Status.DISPATCHED_TO_DEVICE: CampaignRecipient.Status.QUEUED,
        Message.Status.SUBMITTED: CampaignRecipient.Status.SUBMITTED,
        Message.Status.DELIVERED: CampaignRecipient.Status.DELIVERED,
        Message.Status.DELIVERY_UNKNOWN: CampaignRecipient.Status.DELIVERY_UNKNOWN,
        Message.Status.SIMULATED_SENT: CampaignRecipient.Status.SIMULATED_SENT,
        Message.Status.SIMULATED_DELIVERED: CampaignRecipient.Status.SIMULATED_DELIVERED,
        Message.Status.FAILED: CampaignRecipient.Status.FAILED,
        Message.Status.CANCELED: CampaignRecipient.Status.CANCELED,
        Message.Status.EXPIRED: CampaignRecipient.Status.EXPIRED,
    }
    return mapping.get(msg_status, CampaignRecipient.Status.QUEUED)


def sync_campaign_recipient_from_message(message: Message) -> None:
    entry = CampaignRecipient.objects.filter(message=message).first()
    if not entry:
        return
    entry.status = _map_message_status_to_recipient_status(message.status)
    if message.delivered_at:
        entry.delivered_at = message.delivered_at
    if message.failure_reason:
        entry.error_detail = message.failure_reason
    entry.save(update_fields=["status", "delivered_at", "error_detail", "updated_at"])

    campaign = entry.campaign
    stats = compute_campaign_stats(campaign)
    if campaign.status == BulkCampaign.Status.RUNNING and stats["pending_messages"] == 0 and stats["queued_messages"] == 0:
        campaign.status = BulkCampaign.Status.COMPLETED
        campaign.completed_at = timezone.now()
        campaign.save(update_fields=["status", "completed_at", "updated_at"])


@transaction.atomic
def cancel_campaign(campaign: BulkCampaign) -> BulkCampaign:
    campaign = BulkCampaign.objects.select_for_update().get(pk=campaign.pk)
    if campaign.status in {BulkCampaign.Status.COMPLETED, BulkCampaign.Status.CANCELED}:
        return campaign

    now = timezone.now()
    # Cancel all pending recipient rows
    campaign.recipients.filter(status=CampaignRecipient.Status.PENDING).update(
        status=CampaignRecipient.Status.CANCELED,
        processed_at=now,
    )
    # Also cancel any queued (not yet dispatched to handset) messages belonging to this campaign
    queued_msg_ids = list(
        Message.objects.filter(campaign=campaign, status=Message.Status.QUEUED).values_list("id", flat=True)
    )
    if queued_msg_ids:
        Message.objects.filter(id__in=queued_msg_ids).update(status=Message.Status.CANCELED)
        campaign.recipients.filter(message_id__in=queued_msg_ids).update(
            status=CampaignRecipient.Status.CANCELED,
            processed_at=now,
        )

    campaign.status = BulkCampaign.Status.CANCELED
    campaign.canceled_at = now
    campaign.save(update_fields=["status", "canceled_at", "updated_at"])
    broadcast_account_event(
        campaign.user_id,
        "campaign.progress",
        {"campaign_id": str(campaign.id), "status": campaign.status, "stats": compute_campaign_stats(campaign)},
    )
    return campaign


def export_campaign_report_csv(campaign: BulkCampaign) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "recipient_name",
            "phone_number",
            "status",
            "is_simulation",
            "attempts_count",
            "exclusion_reason",
            "error_detail",
            "processed_at",
            "delivered_at",
        ]
    )
    for r in campaign.recipients.all():
        writer.writerow(
            [
                r.recipient_name,
                r.phone_number,
                r.status,
                campaign.is_simulation,
                r.attempts_count,
                r.exclusion_reason,
                r.error_detail,
                r.processed_at.isoformat() if r.processed_at else "",
                r.delivered_at.isoformat() if r.delivered_at else "",
            ]
        )
    return output.getvalue()
