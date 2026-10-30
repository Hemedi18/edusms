"""
Deterministic rule, schedule, template, and mode evaluation engine for EduSMS.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.contacts.models import Contact
from apps.contacts.phone_utils import is_shortcode_or_alphanumeric_sender, normalize_phone_number
from apps.contacts.services import is_time_in_quiet_window, resolve_effective_contact_policy
from .ai_adapters import generate_ai_reply
from .models import AIProviderConfig, AutoReplyRule, AutomationMode, ScheduleWindow


BUILTIN_MODES_SPEC = [
    {
        "slug": "default",
        "name": "Default",
        "icon": "zap",
        "priority": 10,
        "is_active": True,
        "description": "Standard operating mode evaluating active keyword & regex rules.",
        "response_method": AutomationMode.ResponseMethod.RULES_ONLY,
        "response_template": "",
    },
    {
        "slug": "meeting",
        "name": "Meeting",
        "icon": "briefcase",
        "priority": 50,
        "is_active": False,
        "description": "Polite auto-reply while in meetings or lectures.",
        "response_method": AutomationMode.ResponseMethod.RULES_THEN_TEMPLATE,
        "response_template": "I am currently in a meeting and may not reply immediately. I will get back to you when available.",
    },
    {
        "slug": "focus",
        "name": "Focus",
        "icon": "target",
        "priority": 45,
        "is_active": False,
        "description": "Deep work & exam study mode with calm auto-acknowledgement.",
        "response_method": AutomationMode.ResponseMethod.RULES_THEN_TEMPLATE,
        "response_template": "Hi {{contact_name}}, I'm currently in Focus Mode with notifications muted. I'll respond once my session ends.",
    },
    {
        "slug": "vacation",
        "name": "Vacation",
        "icon": "sun",
        "priority": 60,
        "is_active": False,
        "description": "Out-of-office / semester break responder.",
        "response_method": AutomationMode.ResponseMethod.TEMPLATE_ONLY,
        "response_template": "Hello! I am currently away on leave and have limited access to SMS. I will reply upon my return.",
    },
    {
        "slug": "sleeping",
        "name": "Sleeping",
        "icon": "moon",
        "priority": 55,
        "is_active": False,
        "description": "Overnight quiet responder for urgent inquiries.",
        "response_method": AutomationMode.ResponseMethod.RULES_THEN_TEMPLATE,
        "response_template": "Thanks for your message. It's currently outside waking hours—I'll read and reply in the morning.",
    },
    {
        "slug": "custom",
        "name": "Custom",
        "icon": "sliders",
        "priority": 40,
        "is_active": False,
        "description": "User-tailored hybrid rules + AI workflow mode.",
        "response_method": AutomationMode.ResponseMethod.RULES_THEN_AI,
        "response_template": "Thanks for reaching out, {{contact_name}}! We'll get back to you shortly.",
    },
]


def ensure_builtin_modes_for_user(user) -> list[AutomationMode]:
    modes = []
    for spec in BUILTIN_MODES_SPEC:
        mode, _ = AutomationMode.objects.get_or_create(
            user=user,
            slug=spec["slug"],
            defaults={
                "name": spec["name"],
                "is_builtin": True,
                "icon": spec["icon"],
                "priority": spec["priority"],
                "is_active": spec["is_active"],
                "description": spec["description"],
                "response_method": spec["response_method"],
                "response_template": spec["response_template"],
            },
        )
        modes.append(mode)
    return modes


def is_schedule_active(schedule: ScheduleWindow | None, at_time: datetime | None = None) -> tuple[bool, str]:
    if schedule is None:
        return True, "No schedule restriction"
    now_utc = at_time or timezone.now()
    tz = ZoneInfo(schedule.timezone or "UTC")
    local_dt = now_utc.astimezone(tz)
    local_date = local_dt.date()

    if schedule.effective_from and local_date < schedule.effective_from:
        return False, f"Schedule starts on {schedule.effective_from}"
    if schedule.effective_until and local_date > schedule.effective_until:
        return False, f"Schedule ended on {schedule.effective_until}"

    days = schedule.days_of_week or []
    if days and local_dt.weekday() not in [int(d) for d in days]:
        return False, f"Day {local_dt.strftime('%A')} is outside scheduled days"

    in_window = is_time_in_quiet_window(local_dt.time(), schedule.start_time, schedule.end_time)
    if not in_window:
        return False, f"Local time {local_dt.strftime('%H:%M')} is outside {schedule.start_time}-{schedule.end_time} ({schedule.timezone})"

    return True, f"Inside schedule '{schedule.name}'"


def get_active_mode_for_user(user, at_time: datetime | None = None) -> AutomationMode | None:
    modes = list(AutomationMode.objects.filter(user=user, is_enabled=True).select_related("schedule"))
    if not modes:
        modes = ensure_builtin_modes_for_user(user)

    # 1. Explicit active mode if its schedule (if any) is currently valid
    for m in modes:
        if m.is_active:
            ok, _ = is_schedule_active(m.schedule, at_time=at_time)
            if ok:
                return m

    # 2. Scheduled enabled modes ordered by priority DESC
    scheduled = [m for m in modes if m.schedule_id is not None]
    scheduled.sort(key=lambda item: item.priority, reverse=True)
    for m in scheduled:
        ok, _ = is_schedule_active(m.schedule, at_time=at_time)
        if ok:
            return m

    # 3. Fallback to Default mode
    for m in modes:
        if m.slug == "default":
            return m
    return modes[0] if modes else None


ALLOWED_TEMPLATE_VARS = {"contact_name", "first_name", "phone_number", "current_time", "current_date", "mode_name"}


def render_response_template(
    template_str: str,
    *,
    user,
    contact: Contact | None = None,
    sender_number: str = "",
    mode_name: str = "Default",
    custom_variables: dict | None = None,
    at_time: datetime | None = None,
) -> str:
    now_utc = at_time or timezone.now()
    local_dt = now_utc.astimezone(ZoneInfo(user.timezone or "UTC"))
    contact_name = (contact.name.strip() if contact and contact.name else "") or "there"
    first_name = contact_name.split()[0] if contact_name != "there" else "there"

    context: dict[str, str] = {
        "contact_name": contact_name,
        "first_name": first_name,
        "phone_number": sender_number,
        "current_time": local_dt.strftime("%I:%M %p").lstrip("0"),
        "current_date": local_dt.strftime("%Y-%m-%d"),
        "mode_name": mode_name,
    }
    if isinstance(custom_variables, dict):
        for k, v in custom_variables.items():
            if re.match(r"^[a-zA-Z_][a-zA-Z0-9_]{0,31}$", str(k)):
                context[str(k)] = str(v)[:160]

    def _replace(match: re.Match) -> str:
        var_name = match.group(1).strip()
        return str(context.get(var_name, ""))

    rendered = re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", _replace, template_str or "")
    # Clean up double spaces if a variable resolved empty, e.g. "Hello , welcome"
    rendered = re.sub(r"\s+([,\.\!\?])", r"\1", rendered)
    return re.sub(r" {2,}", " ", rendered).strip()


def match_rule_against_text(rule: AutoReplyRule, text: str) -> tuple[bool, str | None]:
    patterns = [str(k) for k in (rule.keywords or []) if str(k).strip()]
    if not patterns:
        return False, None

    candidate = text if rule.case_sensitive else text.lower()
    flags = 0 if rule.case_sensitive else re.IGNORECASE

    for raw_pat in patterns:
        pat = raw_pat if rule.case_sensitive else raw_pat.lower()
        if rule.match_mode == AutoReplyRule.MatchMode.EXACT:
            if candidate.strip() == pat.strip():
                return True, raw_pat
        elif rule.match_mode == AutoReplyRule.MatchMode.CONTAINS:
            if pat in candidate:
                return True, raw_pat
        elif rule.match_mode == AutoReplyRule.MatchMode.STARTS_WITH:
            if candidate.strip().startswith(pat.strip()):
                return True, raw_pat
        elif rule.match_mode == AutoReplyRule.MatchMode.ENDS_WITH:
            if candidate.strip().endswith(pat.strip()):
                return True, raw_pat
        elif rule.match_mode == AutoReplyRule.MatchMode.WHOLE_WORD:
            if re.search(rf"\b{re.escape(raw_pat)}\b", text, flags=flags):
                return True, raw_pat
        elif rule.match_mode == AutoReplyRule.MatchMode.REGEX:
            if len(raw_pat) > 250:
                continue
            try:
                if re.search(raw_pat, text[:1000], flags=flags):
                    return True, raw_pat
            except re.error:
                continue
    return False, None


def _evaluate_matching_rules(
    *,
    user,
    sender_norm: str,
    contact: Contact | None,
    body: str,
    active_mode: AutomationMode | None,
    now_utc: datetime,
    dry_run: bool = False,
) -> tuple[AutoReplyRule | None, str | None, list[str]]:
    from apps.messaging.models import Message

    diagnostics: list[str] = []
    rules = (
        AutoReplyRule.objects.filter(user=user, is_enabled=True)
        .select_related("schedule")
        .prefetch_related("restricted_contacts", "restricted_groups", "apply_in_modes")
        .order_by("-priority", "created_at")
    )
    contact_group_ids = set(contact.groups.values_list("id", flat=True)) if contact else set()

    for rule in rules:
        if rule.expires_at and now_utc >= rule.expires_at:
            diagnostics.append(f"Rule '{rule.name}' skipped: expired.")
            continue

        scoped_modes = list(rule.apply_in_modes.all())
        if scoped_modes and active_mode and active_mode not in scoped_modes:
            diagnostics.append(f"Rule '{rule.name}' skipped: not active in mode '{active_mode.name}'.")
            continue

        sched_ok, sched_reason = is_schedule_active(rule.schedule, at_time=now_utc)
        if not sched_ok:
            diagnostics.append(f"Rule '{rule.name}' skipped: {sched_reason}.")
            continue

        if rule.allowed_senders:
            normalized_allowed = set()
            for s in rule.allowed_senders:
                try:
                    normalized_allowed.add(normalize_phone_number(str(s), user.default_country_code))
                except Exception:
                    normalized_allowed.add(str(s).strip())
            if sender_norm not in normalized_allowed:
                diagnostics.append(f"Rule '{rule.name}' skipped: sender not in allowed_senders.")
                continue

        req_contacts = list(rule.restricted_contacts.all())
        req_groups = list(rule.restricted_groups.all())
        if req_contacts or req_groups:
            contact_ok = bool(contact and any(c.id == contact.id for c in req_contacts))
            group_ok = bool(contact_group_ids and any(g.id in contact_group_ids for g in req_groups))
            if not (contact_ok or group_ok):
                diagnostics.append(f"Rule '{rule.name}' skipped: sender not in restricted contact/group scope.")
                continue

        matched, matched_pattern = match_rule_against_text(rule, body)
        if not matched:
            continue

        if not dry_run:
            # Per-rule cooldown check for this sender
            if rule.cooldown_minutes > 0:
                cooldown_since = now_utc - timedelta(minutes=rule.cooldown_minutes)
                if Message.objects.filter(
                    user=user,
                    direction=Message.Direction.OUTBOUND,
                    recipient_number=sender_norm,
                    triggered_by_rule=rule,
                    created_at__gte=cooldown_since,
                ).exists():
                    diagnostics.append(f"Rule '{rule.name}' matched '{matched_pattern}' but suppressed by {rule.cooldown_minutes}m cooldown.")
                    continue

            # Max daily responses check for this rule + sender
            day_since = now_utc - timedelta(hours=24)
            sent_24h = Message.objects.filter(
                user=user,
                direction=Message.Direction.OUTBOUND,
                recipient_number=sender_norm,
                triggered_by_rule=rule,
                created_at__gte=day_since,
            ).count()
            if sent_24h >= rule.max_responses_per_day:
                diagnostics.append(f"Rule '{rule.name}' matched but hit max_responses_per_day ({rule.max_responses_per_day}).")
                continue

        diagnostics.append(f"Rule '{rule.name}' MATCHED pattern '{matched_pattern}' (priority {rule.priority}).")
        return rule, matched_pattern, diagnostics

    return None, None, diagnostics


def preview_auto_responder(
    *,
    user,
    sender_number: str,
    body: str,
    at_time: datetime | None = None,
) -> dict:
    """Dry-run rule, mode, schedule, and contact policy evaluator without sending any SMS."""
    now_utc = at_time or timezone.now()
    if is_shortcode_or_alphanumeric_sender(sender_number):
        return {
            "would_reply": False,
            "decision": "blocked_shortcode",
            "reason": "Automated replies to carrier shortcodes and alphanumeric senders are blocked to prevent loops.",
            "response_preview": None,
            "diagnostics": [],
        }

    try:
        sender_norm = normalize_phone_number(sender_number, user.default_country_code)
    except Exception:
        sender_norm = sender_number.strip()

    contact = Contact.objects.filter(user=user, phone_number=sender_norm).prefetch_related("groups").first()
    policy = resolve_effective_contact_policy(user, contact=contact, phone_number=sender_norm, at_time=now_utc)
    if not policy["can_auto_reply"]:
        return {
            "would_reply": False,
            "decision": "blocked_policy",
            "reason": "; ".join(policy["blocking_reasons"]) or "Auto-reply disabled by policy.",
            "effective_policy": policy,
            "response_preview": None,
            "diagnostics": policy["inheritance_trace"],
        }

    active_mode = (
        AutomationMode.objects.filter(user=user, id=policy["effective_mode_id"]).first()
        if policy["effective_mode_id"]
        else get_active_mode_for_user(user, at_time=now_utc)
    )
    mode_name = active_mode.name if active_mode else "Default"
    method = active_mode.response_method if active_mode else AutomationMode.ResponseMethod.RULES_ONLY

    diagnostics: list[str] = list(policy["inheritance_trace"])
    diagnostics.append(f"Effective mode: {mode_name} ({method})")

    if method in {
        AutomationMode.ResponseMethod.RULES_ONLY,
        AutomationMode.ResponseMethod.RULES_THEN_AI,
        AutomationMode.ResponseMethod.RULES_THEN_TEMPLATE,
    }:
        rule, pattern, rule_diag = _evaluate_matching_rules(
            user=user,
            sender_norm=sender_norm,
            contact=contact,
            body=body,
            active_mode=active_mode,
            now_utc=now_utc,
            dry_run=True,
        )
        diagnostics.extend(rule_diag)
        if rule:
            rendered = render_response_template(
                rule.response_template,
                user=user,
                contact=contact,
                sender_number=sender_norm,
                mode_name=mode_name,
                custom_variables=rule.custom_variables,
                at_time=now_utc,
            )
            return {
                "would_reply": True,
                "decision": "rule_matched",
                "matched_rule_id": str(rule.id),
                "matched_rule_name": rule.name,
                "matched_pattern": pattern,
                "matched_mode_name": mode_name,
                "require_human_approval": rule.require_human_approval or bool(active_mode and active_mode.require_human_approval),
                "response_preview": rendered,
                "effective_policy": policy,
                "diagnostics": diagnostics,
            }

    if active_mode and method in {
        AutomationMode.ResponseMethod.TEMPLATE_ONLY,
        AutomationMode.ResponseMethod.RULES_THEN_TEMPLATE,
    } and active_mode.response_template.strip():
        rendered = render_response_template(
            active_mode.response_template,
            user=user,
            contact=contact,
            sender_number=sender_norm,
            mode_name=mode_name,
            at_time=now_utc,
        )
        return {
            "would_reply": True,
            "decision": "mode_template",
            "matched_rule_id": None,
            "matched_mode_name": mode_name,
            "require_human_approval": active_mode.require_human_approval,
            "response_preview": rendered,
            "effective_policy": policy,
            "diagnostics": diagnostics,
        }

    if active_mode and method in {AutomationMode.ResponseMethod.AI_ONLY, AutomationMode.ResponseMethod.RULES_THEN_AI}:
        if not policy["can_ai_reply"]:
            diagnostics.append("AI fallback skipped because AI replies are not enabled for this contact/group/account.")
        else:
            provider = active_mode.ai_provider or AIProviderConfig.objects.filter(user=user, is_enabled=True).first()
            if provider:
                ai_res = generate_ai_reply(
                    provider=provider,
                    inbound_text=body,
                    sender_name=contact.name if contact else "",
                    mode_instructions=active_mode.ai_override_instructions,
                    is_test=True,
                )
                if ai_res["reply_text"]:
                    return {
                        "would_reply": True,
                        "decision": "ai_fallback" if ai_res["used_fallback"] else "ai_generated",
                        "matched_mode_name": mode_name,
                        "ai_provider_name": provider.name,
                        "require_human_approval": active_mode.require_human_approval,
                        "response_preview": ai_res["reply_text"],
                        "effective_policy": policy,
                        "diagnostics": diagnostics,
                    }

    return {
        "would_reply": False,
        "decision": "no_match",
        "reason": "No enabled keyword rule matched and no mode template/AI fallback applied.",
        "effective_policy": policy,
        "response_preview": None,
        "diagnostics": diagnostics,
    }


@transaction.atomic
def evaluate_and_respond_to_inbound(
    *,
    inbound_message,
    raw_unredacted_body: str,
    is_simulation: bool,
    device=None,
) -> dict:
    """
    Executes live auto-responder evaluation on an incoming message with loop protection,
    cooldown enforcement, human-approval support, and webhook emission.
    """
    from apps.messaging.models import Message
    from apps.messaging.services import submit_outbound_message
    from apps.developers.services import emit_webhook_event

    user = inbound_message.user
    sender_norm = inbound_message.sender_number
    now_utc = timezone.now()

    # 1. Loop & shortcode protection
    if is_shortcode_or_alphanumeric_sender(sender_norm):
        summary = "Auto-reply skipped: shortcode or alphanumeric sender."
        inbound_message.matched_policy_summary = summary
        inbound_message.save(update_fields=["matched_policy_summary", "updated_at"])
        return {"decision": "blocked_shortcode", "summary": summary, "reply_message_id": None}

    # Prevent replying if we already replied to this exact inbound message event
    if Message.objects.filter(user=user, in_reply_to=inbound_message).exists():
        return {"decision": "already_replied", "summary": "Already replied to this event.", "reply_message_id": None}

    contact = Contact.objects.filter(user=user, phone_number=sender_norm).prefetch_related("groups").first()
    policy = resolve_effective_contact_policy(user, contact=contact, phone_number=sender_norm, at_time=now_utc)
    if not policy["can_auto_reply"]:
        summary = "Auto-reply blocked: " + ("; ".join(policy["blocking_reasons"]) or "disabled by policy")
        inbound_message.matched_policy_summary = summary[:255]
        inbound_message.save(update_fields=["matched_policy_summary", "updated_at"])
        return {"decision": "blocked_policy", "summary": summary, "reply_message_id": None}

    # Per-contact / inherited cooldown check across auto-replies
    eff_cooldown = policy["effective_cooldown_minutes"]
    if eff_cooldown and eff_cooldown > 0:
        recent_auto = Message.objects.filter(
            user=user,
            direction=Message.Direction.OUTBOUND,
            is_auto_reply=True,
            recipient_number=sender_norm,
            is_simulation=is_simulation,
            created_at__gte=now_utc - timedelta(minutes=eff_cooldown),
        ).exists()
        # Note: individual rules may specify shorter cooldowns; check mode/contact cooldown for non-rule replies

    active_mode = (
        AutomationMode.objects.filter(user=user, id=policy["effective_mode_id"])
        .prefetch_related("blocked_contacts", "allowed_contacts", "selected_groups")
        .first()
        if policy["effective_mode_id"]
        else get_active_mode_for_user(user, at_time=now_utc)
    )

    if active_mode and contact:
        if active_mode.blocked_contacts.filter(id=contact.id).exists():
            summary = f"Auto-reply blocked: contact is in blocked list of mode '{active_mode.name}'."
            inbound_message.matched_policy_summary = summary[:255]
            inbound_message.save(update_fields=["matched_policy_summary", "updated_at"])
            return {"decision": "blocked_mode_contact", "summary": summary, "reply_message_id": None}

        # Check mode daily reply limit per sender
        day_auto_count = Message.objects.filter(
            user=user,
            direction=Message.Direction.OUTBOUND,
            is_auto_reply=True,
            recipient_number=sender_norm,
            is_simulation=is_simulation,
            created_at__gte=now_utc - timedelta(hours=24),
        ).count()
        if day_auto_count >= active_mode.max_replies_per_sender_per_day:
            summary = f"Auto-reply suppressed: reached mode daily cap ({active_mode.max_replies_per_sender_per_day}/day)."
            inbound_message.matched_policy_summary = summary[:255]
            inbound_message.save(update_fields=["matched_policy_summary", "updated_at"])
            return {"decision": "rate_capped", "summary": summary, "reply_message_id": None}

    mode_name = active_mode.name if active_mode else "Default"
    method = active_mode.response_method if active_mode else AutomationMode.ResponseMethod.RULES_ONLY

    reply_text = ""
    matched_rule = None
    ai_generated = False
    require_approval = bool(active_mode and active_mode.require_human_approval)
    summary = ""

    # Step A: Evaluate deterministic keyword/regex rules when applicable
    if method in {
        AutomationMode.ResponseMethod.RULES_ONLY,
        AutomationMode.ResponseMethod.RULES_THEN_AI,
        AutomationMode.ResponseMethod.RULES_THEN_TEMPLATE,
    }:
        rule, pattern, _diag = _evaluate_matching_rules(
            user=user,
            sender_norm=sender_norm,
            contact=contact,
            body=raw_unredacted_body,
            active_mode=active_mode,
            now_utc=now_utc,
            dry_run=False,
        )
        if rule:
            matched_rule = rule
            require_approval = require_approval or rule.require_human_approval
            reply_text = render_response_template(
                rule.response_template,
                user=user,
                contact=contact,
                sender_number=sender_norm,
                mode_name=mode_name,
                custom_variables=rule.custom_variables,
                at_time=now_utc,
            )
            summary = f"Rule '{rule.name}' matched '{pattern}' (Mode: {mode_name})"
            AutoReplyRule.objects.filter(pk=rule.pk).update(
                hit_count=F("hit_count") + 1,
                last_triggered_at=now_utc,
            )

    # Step B: Mode template if no rule matched
    if not reply_text and active_mode and method in {
        AutomationMode.ResponseMethod.TEMPLATE_ONLY,
        AutomationMode.ResponseMethod.RULES_THEN_TEMPLATE,
    }:
        if eff_cooldown and Message.objects.filter(
            user=user,
            direction=Message.Direction.OUTBOUND,
            is_auto_reply=True,
            recipient_number=sender_norm,
            is_simulation=is_simulation,
            created_at__gte=now_utc - timedelta(minutes=eff_cooldown),
        ).exists():
            summary = f"Mode '{mode_name}' auto-reply suppressed by {eff_cooldown}m cooldown."
            inbound_message.matched_policy_summary = summary[:255]
            inbound_message.save(update_fields=["matched_policy_summary", "updated_at"])
            return {"decision": "cooldown_active", "summary": summary, "reply_message_id": None}

        if active_mode.response_template.strip():
            reply_text = render_response_template(
                active_mode.response_template,
                user=user,
                contact=contact,
                sender_number=sender_norm,
                mode_name=mode_name,
                at_time=now_utc,
            )
            summary = f"Mode '{mode_name}' template responder"

    # Step C: Safe AI provider generation if enabled and permitted
    if not reply_text and active_mode and method in {
        AutomationMode.ResponseMethod.AI_ONLY,
        AutomationMode.ResponseMethod.RULES_THEN_AI,
    }:
        if policy["can_ai_reply"]:
            provider = active_mode.ai_provider or AIProviderConfig.objects.filter(user=user, is_enabled=True).first()
            if provider and provider.is_enabled:
                ai_res = generate_ai_reply(
                    provider=provider,
                    inbound_text=raw_unredacted_body,
                    sender_name=contact.name if contact else "",
                    mode_instructions=active_mode.ai_override_instructions,
                    inbound_message=inbound_message,
                    is_test=False,
                )
                if ai_res["ok"] and ai_res["reply_text"]:
                    reply_text = ai_res["reply_text"]
                    ai_generated = True
                    summary = f"AI reply via '{provider.name}' (Mode: {mode_name})"
                elif ai_res["used_fallback"] and ai_res["reply_text"]:
                    reply_text = ai_res["reply_text"]
                    summary = f"Deterministic fallback after AI provider '{provider.name}' failure"
                elif (
                    active_mode.fallback_behavior == AutomationMode.FallbackBehavior.SEND_FALLBACK
                    and active_mode.fallback_text.strip()
                ):
                    reply_text = render_response_template(
                        active_mode.fallback_text,
                        user=user,
                        contact=contact,
                        sender_number=sender_norm,
                        mode_name=mode_name,
                        at_time=now_utc,
                    )
                    summary = f"Mode '{mode_name}' fallback after AI failure"

    if not reply_text:
        summary = f"Evaluated in mode '{mode_name}'; no rule or AI policy matched."
        inbound_message.matched_policy_summary = summary[:255]
        inbound_message.save(update_fields=["matched_policy_summary", "updated_at"])
        return {"decision": "no_match", "summary": summary, "reply_message_id": None}

    transport = Message.TransportType.SIMULATION if is_simulation else Message.TransportType.SIM_GATEWAY
    reply_msg = submit_outbound_message(
        user=user,
        recipient_number=sender_norm,
        body=reply_text,
        transport_type=transport,
        device_id=str(device.id) if (device and not is_simulation) else None,
        sim_slot=inbound_message.sim_slot if not is_simulation else None,
        in_reply_to=inbound_message,
        triggered_by_rule=matched_rule,
        triggered_by_mode=active_mode,
        matched_policy_summary=summary,
        is_auto_reply=True,
        ai_generated=ai_generated,
        require_approval=require_approval,
    )
    inbound_message.matched_policy_summary = summary[:255]
    inbound_message.save(update_fields=["matched_policy_summary", "updated_at"])

    emit_webhook_event(
        user=user,
        event_type="auto_reply.triggered",
        data={
            "inbound_message_id": str(inbound_message.id),
            "reply_message_id": str(reply_msg.id),
            "recipient": sender_norm,
            "summary": summary,
            "ai_generated": ai_generated,
            "pending_approval": require_approval,
            "simulation": is_simulation,
        },
        is_simulation=is_simulation,
    )

    return {
        "decision": "pending_approval" if require_approval else ("ai_replied" if ai_generated else "replied"),
        "summary": summary,
        "reply_message_id": str(reply_msg.id),
        "reply_body": reply_msg.body,
        "reply_status": reply_msg.status,
    }
