"""
Deterministic contact & group policy resolution, consent management, and CSV import/export.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from .models import ConsentRecord, Contact, ContactGroup, GroupMembership, SuppressionRecord
from .phone_utils import InvalidPhoneNumberError, normalize_phone_number


OPT_OUT_KEYWORDS = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ONDOA", "ACHA"}
OPT_IN_KEYWORDS = {"START", "UNSTOP", "YES", "SUBSCRIBE", "JIUNGE"}


def is_time_in_quiet_window(local_now: time, start: time | None, end: time | None) -> bool:
    if start is None or end is None:
        return False
    if start <= end:
        return start <= local_now <= end
    # Overnight window (e.g., 22:00 -> 06:30)
    return local_now >= start or local_now <= end


@transaction.atomic
def record_opt_out(
    *,
    user,
    phone_number: str,
    source: str = ConsentRecord.Source.MANUAL,
    note: str = "",
) -> Contact | None:
    normalized = normalize_phone_number(phone_number, user.default_country_code)
    now = timezone.now()
    contact = Contact.objects.filter(user=user, phone_number=normalized).first()
    if contact:
        contact.opt_out_status = True
        contact.opt_out_at = now
        contact.opt_in_status = False
        contact.save(update_fields=["opt_out_status", "opt_out_at", "opt_in_status", "updated_at"])

    SuppressionRecord.objects.update_or_create(
        user=user,
        phone_number=normalized,
        defaults={
            "reason": SuppressionRecord.Reason.OPT_OUT,
            "notes": note[:255] or f"Opted out via {source}",
        },
    )
    ConsentRecord.objects.create(
        user=user,
        contact=contact,
        phone_number=normalized,
        action=ConsentRecord.Action.OPT_OUT,
        source=source,
        evidence_note=note[:255],
    )
    return contact


@transaction.atomic
def record_opt_in(
    *,
    user,
    phone_number: str,
    source: str = ConsentRecord.Source.MANUAL,
    note: str = "",
) -> Contact | None:
    normalized = normalize_phone_number(phone_number, user.default_country_code)
    now = timezone.now()
    contact = Contact.objects.filter(user=user, phone_number=normalized).first()
    if contact:
        contact.opt_in_status = True
        contact.opt_in_at = now
        contact.opt_out_status = False
        contact.save(update_fields=["opt_in_status", "opt_in_at", "opt_out_status", "updated_at"])

    SuppressionRecord.objects.filter(
        user=user,
        phone_number=normalized,
        reason=SuppressionRecord.Reason.OPT_OUT,
    ).delete()
    ConsentRecord.objects.create(
        user=user,
        contact=contact,
        phone_number=normalized,
        action=ConsentRecord.Action.OPT_IN,
        source=source,
        evidence_note=note[:255],
    )
    return contact


def resolve_effective_contact_policy(
    user,
    *,
    contact: Contact | None = None,
    phone_number: str | None = None,
    at_time: datetime | None = None,
) -> dict:
    """
    Computes the effective messaging and automation policy for a contact or raw phone number.
    Precedence (strictest safety wins for opt-outs/suppressions):
      1. Suppression list & explicit opt-out ALWAYS block outgoing campaigns & automated replies.
      2. Explicit per-contact settings override group settings.
      3. Group settings override global user defaults (restrictive group blocks win if contact is in multiple groups unless contact explicitly overrides).
      4. Global user settings (`global_automation_enabled`, `global_ai_enabled`).
    """
    now_utc = at_time or timezone.now()
    user_tz = ZoneInfo(user.timezone or "UTC")
    local_time = now_utc.astimezone(user_tz).time()

    if contact is None and phone_number:
        try:
            norm = normalize_phone_number(phone_number, user.default_country_code)
        except InvalidPhoneNumberError:
            norm = phone_number
        contact = Contact.objects.filter(user=user, phone_number=norm).prefetch_related("groups").first()
    else:
        norm = contact.phone_number if contact else (phone_number or "")

    suppressed = SuppressionRecord.objects.filter(user=user, phone_number=norm).first()
    is_opted_out = bool((contact and contact.opt_out_status) or (suppressed and suppressed.reason == SuppressionRecord.Reason.OPT_OUT))
    is_suppressed = suppressed is not None

    groups: list[ContactGroup] = list(contact.groups.all()) if contact else []
    trace: list[str] = []
    blocking_reasons: list[str] = []

    # 1. Outgoing eligibility
    can_send_outgoing = True
    if is_suppressed:
        can_send_outgoing = False
        blocking_reasons.append(f"Suppressed ({suppressed.reason})")
        trace.append("Blocked by SuppressionRecord")
    if is_opted_out:
        can_send_outgoing = False
        if "Opted out" not in " ".join(blocking_reasons):
            blocking_reasons.append("Contact has opted out")
        trace.append("Blocked by explicit opt-out")
    if contact and not contact.allow_outgoing:
        can_send_outgoing = False
        blocking_reasons.append("Contact allow_outgoing is disabled")
        trace.append("Blocked by contact.allow_outgoing=False")
    elif groups and any(not g.allow_outgoing for g in groups):
        can_send_outgoing = False
        blocking_reasons.append("Group policy disables outgoing messages")
        trace.append("Blocked by group.allow_outgoing=False")

    # 2. Auto-reply eligibility
    if is_suppressed or is_opted_out:
        can_auto_reply = False
    elif not user.global_automation_enabled:
        can_auto_reply = False
        blocking_reasons.append("Global automation is disabled")
        trace.append("Disabled by user.global_automation_enabled=False")
    elif contact and contact.allow_auto_reply is not None:
        can_auto_reply = contact.allow_auto_reply
        trace.append(f"Contact override allow_auto_reply={contact.allow_auto_reply}")
        if not can_auto_reply:
            blocking_reasons.append("Contact disables automatic replies")
    elif groups:
        # If any group disables auto-reply, respect the block; otherwise True
        if any(not g.allow_auto_reply for g in groups):
            can_auto_reply = False
            blocking_reasons.append("Member of a group with auto-replies disabled")
            trace.append("Blocked by group.allow_auto_reply=False")
        else:
            can_auto_reply = True
            trace.append("Inherited allow_auto_reply=True from group")
    else:
        can_auto_reply = True
        trace.append("Inherited allow_auto_reply=True from global default")

    # 3. AI reply eligibility (requires global_ai_enabled AND auto_reply allowed)
    if not can_auto_reply or not user.global_ai_enabled:
        can_ai_reply = False
        if not user.global_ai_enabled:
            trace.append("Global AI is disabled")
    elif contact and contact.allow_ai_reply is not None:
        can_ai_reply = contact.allow_ai_reply
        trace.append(f"Contact override allow_ai_reply={contact.allow_ai_reply}")
    elif groups:
        if any(not g.allow_ai_reply for g in groups):
            can_ai_reply = False
            trace.append("Group policy disables AI replies")
        else:
            can_ai_reply = any(g.allow_ai_reply for g in groups)
            trace.append(f"Inherited allow_ai_reply={can_ai_reply} from group")
    else:
        can_ai_reply = user.global_ai_enabled
        trace.append(f"Inherited allow_ai_reply={can_ai_reply} from global AI setting")

    # 4. Quiet hours check
    qh_start = contact.quiet_hours_start if (contact and contact.quiet_hours_start) else None
    qh_end = contact.quiet_hours_end if (contact and contact.quiet_hours_end) else None
    qh_source = "contact" if qh_start and qh_end else "none"
    if not (qh_start and qh_end):
        for g in groups:
            if g.quiet_hours_start and g.quiet_hours_end:
                qh_start = g.quiet_hours_start
                qh_end = g.quiet_hours_end
                qh_source = f"group:{g.name}"
                break

    in_quiet_hours = is_time_in_quiet_window(local_time, qh_start, qh_end)
    if in_quiet_hours:
        can_auto_reply = False
        can_ai_reply = False
        blocking_reasons.append(f"Currently inside quiet hours ({qh_start}–{qh_end} {user.timezone})")
        trace.append(f"Suppressed by quiet hours from {qh_source}")

    # 5. Cooldown resolution
    if contact and contact.cooldown_minutes is not None:
        cooldown_minutes = contact.cooldown_minutes
        cooldown_source = "contact"
    elif groups:
        cooldown_minutes = max(g.cooldown_minutes for g in groups)
        cooldown_source = "group"
    else:
        cooldown_minutes = 15
        cooldown_source = "global_default"

    # 6. Automation mode resolution
    effective_mode = None
    mode_source = "global_active"
    if contact and contact.automation_mode_id:
        effective_mode = contact.automation_mode
        mode_source = "contact"
    else:
        for g in groups:
            if g.automation_mode_id:
                effective_mode = g.automation_mode
                mode_source = f"group:{g.name}"
                break
    if effective_mode is None:
        from apps.automation.services import get_active_mode_for_user

        effective_mode = get_active_mode_for_user(user, at_time=now_utc)

    return {
        "phone_number": norm,
        "contact_id": str(contact.id) if contact else None,
        "contact_name": contact.name if contact else "",
        "is_suppressed": is_suppressed,
        "is_opted_out": is_opted_out,
        "opt_in_status": bool(contact.opt_in_status) if contact else False,
        "can_send_outgoing": can_send_outgoing,
        "can_auto_reply": can_auto_reply,
        "can_ai_reply": can_ai_reply,
        "in_quiet_hours": in_quiet_hours,
        "quiet_hours_start": str(qh_start) if qh_start else None,
        "quiet_hours_end": str(qh_end) if qh_end else None,
        "quiet_hours_source": qh_source,
        "effective_cooldown_minutes": cooldown_minutes,
        "cooldown_source": cooldown_source,
        "effective_mode_id": str(effective_mode.id) if effective_mode else None,
        "effective_mode_name": effective_mode.name if effective_mode else "Default",
        "effective_mode_source": mode_source,
        "groups": [{"id": str(g.id), "name": g.name} for g in groups],
        "blocking_reasons": blocking_reasons,
        "inheritance_trace": trace,
    }


@transaction.atomic
def import_contacts_from_csv(
    *,
    user,
    csv_text: str,
    group_ids: list[str] | None = None,
    mark_opted_in: bool = False,
    is_virtual: bool = False,
) -> dict:
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    groups = list(ContactGroup.objects.filter(user=user, id__in=(group_ids or [])))

    created_count = 0
    updated_count = 0
    duplicate_in_file_count = 0
    invalid_rows: list[dict] = []
    seen_phones: set[str] = set()

    for idx, row in enumerate(reader, start=2):
        raw_phone = (
            row.get("phone_number")
            or row.get("phone")
            or row.get("mobile")
            or row.get("number")
            or ""
        ).strip()
        name = (row.get("name") or row.get("full_name") or raw_phone).strip()
        email = (row.get("email") or "").strip()
        notes = (row.get("notes") or "").strip()
        tags_raw = (row.get("tags") or "").strip()
        tags = [t.strip() for t in tags_raw.split(";") if t.strip()] if tags_raw else []

        try:
            normalized = normalize_phone_number(raw_phone, user.default_country_code)
        except InvalidPhoneNumberError as exc:
            invalid_rows.append({"line": idx, "input": raw_phone, "error": str(exc)})
            continue

        if normalized in seen_phones:
            duplicate_in_file_count += 1
            continue
        seen_phones.add(normalized)

        contact, created = Contact.objects.get_or_create(
            user=user,
            phone_number=normalized,
            defaults={
                "name": name[:160],
                "raw_phone_input": raw_phone[:40],
                "email": email,
                "notes": notes,
                "tags": tags,
                "is_virtual": is_virtual,
                "opt_in_status": mark_opted_in,
                "opt_in_at": timezone.now() if mark_opted_in else None,
            },
        )
        if created:
            created_count += 1
            if mark_opted_in:
                ConsentRecord.objects.create(
                    user=user,
                    contact=contact,
                    phone_number=normalized,
                    action=ConsentRecord.Action.OPT_IN,
                    source=ConsentRecord.Source.CSV_IMPORT,
                    evidence_note="Authorized CSV contact import",
                )
        else:
            updated_count += 1
            if name and contact.name == contact.phone_number:
                contact.name = name[:160]
                contact.save(update_fields=["name", "updated_at"])

        for group in groups:
            GroupMembership.objects.get_or_create(contact=contact, group=group)

    return {
        "created_count": created_count,
        "existing_updated_count": updated_count,
        "duplicate_in_file_count": duplicate_in_file_count,
        "invalid_count": len(invalid_rows),
        "invalid_rows": invalid_rows[:50],
    }


def export_contacts_to_csv(user, include_opted_out: bool = False) -> str:
    qs = Contact.objects.filter(user=user).prefetch_related("groups")
    if not include_opted_out:
        qs = qs.filter(opt_out_status=False)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["name", "phone_number", "email", "groups", "opt_in_status", "opt_out_status", "is_virtual", "tags", "notes"]
    )
    for c in qs:
        group_names = ";".join(g.name for g in c.groups.all())
        tag_str = ";".join(str(t) for t in (c.tags or []))
        writer.writerow(
            [c.name, c.phone_number, c.email, group_names, c.opt_in_status, c.opt_out_status, c.is_virtual, tag_str, c.notes]
        )
    return output.getvalue()
