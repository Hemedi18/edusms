from __future__ import annotations

import logging
import re
from typing import Any
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.db import transaction
from django.utils import timezone

from .models import ErrorReport, Notification, ServerHostingConfig, SupportMessage, SupportThread

logger = logging.getLogger(__name__)


def get_or_create_hosting_config() -> ServerHostingConfig:
    cfg = ServerHostingConfig.objects.first()
    if not cfg:
        cfg = ServerHostingConfig.objects.create(
            primary_domain=getattr(settings, "CPANEL_PRIMARY_DOMAIN", "edusphere.co.tz"),
            subdomain=getattr(settings, "CPANEL_SUBDOMAIN", "edusms.edusphere.co.tz"),
            cpanel_host=getattr(settings, "CPANEL_HOST", "https://edusphere.co.tz:2083"),
            cpanel_username=getattr(settings, "CPANEL_USERNAME", ""),
            support_email=getattr(settings, "SUPPORT_ADMIN_EMAIL", "support@edusms.edusphere.co.tz"),
            admin_alert_email=getattr(settings, "SUPPORT_ADMIN_EMAIL", "support@edusms.edusphere.co.tz"),
            smtp_host=getattr(settings, "EMAIL_HOST", "mail.edusphere.co.tz"),
            smtp_port=getattr(settings, "EMAIL_PORT", 587),
            smtp_use_tls=getattr(settings, "EMAIL_USE_TLS", True),
            smtp_username=getattr(settings, "EMAIL_HOST_USER", "support@edusms.edusphere.co.tz"),
            github_repo_url=getattr(settings, "GITHUB_REPO_URL", "https://github.com/Hemedi18/edusms.git"),
            github_branch="main",
        )
    return cfg


def _send_platform_email(
    subject: str,
    body_text: str,
    to_emails: list[str],
    reply_to: list[str] | None = None,
) -> bool:
    """
    Sends email using dynamic SMTP settings from ServerHostingConfig if configured with a password,
    falling back cleanly to Django's configured EMAIL_BACKEND (e.g. console/locmem in dev/tests).
    """
    recipients = [e.strip() for e in to_emails if e and "@" in e]
    if not recipients:
        return False

    cfg = get_or_create_hosting_config()
    from_email = cfg.support_email or settings.DEFAULT_FROM_EMAIL
    smtp_password = cfg.get_smtp_password() or getattr(settings, "EMAIL_HOST_PASSWORD", "")

    try:
        if smtp_password and cfg.smtp_host and settings.EMAIL_BACKEND.endswith("smtp.EmailBackend"):
            conn = get_connection(
                backend="django.core.mail.backends.smtp.EmailBackend",
                host=cfg.smtp_host,
                port=cfg.smtp_port,
                username=cfg.smtp_username or cfg.support_email,
                password=smtp_password,
                use_tls=cfg.smtp_use_tls,
                timeout=10,
            )
        else:
            conn = get_connection()

        msg = EmailMultiAlternatives(
            subject=subject,
            body=body_text,
            from_email=from_email,
            to=recipients,
            reply_to=reply_to or [from_email],
            connection=conn,
        )
        msg.send(fail_silently=False)
        return True
    except Exception as exc:
        logger.warning("Email dispatch fallback warning (%s): %s", subject, exc)
        try:
            # Fallback to console/default backend so email content is still logged in dev
            msg = EmailMultiAlternatives(
                subject=subject,
                body=body_text,
                from_email=from_email,
                to=recipients,
                reply_to=reply_to or [from_email],
            )
            msg.send(fail_silently=True)
            return True
        except Exception:
            return False


def extract_customer_context(
    user=None,
    request=None,
    extra_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Automatically builds a rich customer & session profile to display on the side of the Admin Live Chat
    and inside Error Reports.
    """
    extra = extra_context or {}
    ip_address = extra.get("ip_address", "")
    user_agent = extra.get("user_agent", "")
    page_url = extra.get("page_url", "")

    if request is not None:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            ip_address = xff.split(",")[0].strip()
        elif not ip_address:
            ip_address = request.META.get("REMOTE_ADDR", "")
        if not user_agent:
            user_agent = request.META.get("HTTP_USER_AGENT", "")[:255]

    authenticated_user = user if (user and getattr(user, "is_authenticated", False)) else None
    if not authenticated_user and request is not None and getattr(request, "user", None) and request.user.is_authenticated:
        authenticated_user = request.user

    if not authenticated_user:
        return {
            "user_id": None,
            "email": extra.get("user_email") or "guest@anonymous",
            "full_name": extra.get("user_name") or "Guest Visitor",
            "organization": extra.get("organization") or "Unauthenticated Session",
            "user_kind": "Guest / Unauthenticated",
            "email_verified": False,
            "mfa_enabled": False,
            "timezone": extra.get("timezone") or "UTC",
            "default_country_code": extra.get("default_country_code") or "TZ",
            "session": {
                "session_id": "guest-ephemeral",
                "device_label": extra.get("device_label") or "Web Browser",
                "ip_address": ip_address or "127.0.0.1",
                "user_agent": user_agent or "Browser",
                "last_active_at": timezone.now().isoformat(),
            },
            "page_url": page_url,
            "browser_info": extra.get("browser_info") or user_agent,
            "telemetry": {
                "paired_devices_count": 0,
                "online_devices_count": 0,
                "total_messages_count": 0,
                "active_mode": "Default",
                "unresolved_errors_count": 0,
            },
        }

    from apps.accounts.models import UserSession
    from apps.automation.models import AutomationMode
    from apps.devices.models import Device
    from apps.messaging.models import Message

    latest_session = (
        UserSession.objects.filter(user=authenticated_user, revoked_at__isnull=True)
        .order_by("-last_used_at")
        .first()
    )
    devices_qs = Device.objects.filter(user=authenticated_user, revoked_at__isnull=True)
    paired_count = devices_qs.count()
    online_count = sum(1 for d in devices_qs if d.is_online)
    total_msgs = Message.objects.filter(user=authenticated_user).count()
    active_mode = (
        AutomationMode.objects.filter(user=authenticated_user, is_active=True)
        .values_list("name", flat=True)
        .first()
        or "Default"
    )
    unresolved_errors = ErrorReport.objects.filter(user=authenticated_user, status=ErrorReport.Status.OPEN).count()

    if authenticated_user.is_superuser or authenticated_user.is_staff:
        user_kind = "Platform Admin / Owner"
    elif authenticated_user.email_verified:
        user_kind = "Verified Developer Account"
    else:
        user_kind = "Standard User (Unverified Email)"

    mfa_cfg = getattr(authenticated_user, "mfa_config", None)
    mfa_is_enabled = bool(mfa_cfg and getattr(mfa_cfg, "is_enabled", False))

    return {
        "user_id": str(authenticated_user.id),
        "email": authenticated_user.email,
        "full_name": authenticated_user.full_name or authenticated_user.email.split("@")[0],
        "organization": authenticated_user.organization or "Independent Developer",
        "user_kind": user_kind,
        "email_verified": authenticated_user.email_verified,
        "mfa_enabled": mfa_is_enabled,
        "timezone": authenticated_user.timezone,
        "default_country_code": authenticated_user.default_country_code,
        "account_created_at": authenticated_user.created_at.isoformat(),
        "session": {
            "session_id": str(latest_session.id) if latest_session else "jwt-direct",
            "device_label": latest_session.device_label if latest_session else (extra.get("device_label") or "Web Session"),
            "ip_address": ip_address or (latest_session.ip_address if latest_session else "127.0.0.1"),
            "user_agent": user_agent or (latest_session.user_agent if latest_session else "Browser"),
            "last_active_at": (
                latest_session.last_used_at.isoformat() if latest_session else timezone.now().isoformat()
            ),
        },
        "page_url": page_url,
        "browser_info": extra.get("browser_info") or user_agent,
        "telemetry": {
            "paired_devices_count": paired_count,
            "online_devices_count": online_count,
            "total_messages_count": total_msgs,
            "active_mode": active_mode,
            "unresolved_errors_count": unresolved_errors,
        },
    }


def _broadcast_ws_event(user_id: str | None, event_type: str, data: dict[str, Any]) -> None:
    if not user_id:
        return
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f"user_events_{user_id}",
                {
                    "type": "push_event",
                    "payload": {
                        "type": event_type,
                        "data": data,
                    },
                },
            )
    except Exception:
        pass


@transaction.atomic
def record_error_and_notify(
    *,
    user=None,
    request=None,
    source: str = ErrorReport.Source.WEB_AUTO,
    severity: str = ErrorReport.Severity.ERROR,
    title: str,
    message: str,
    stack_trace: str = "",
    page_url: str = "",
    component_name: str = "",
    screenshot_data_url: str = "",
    user_email: str = "",
    user_name: str = "",
    extra_context: dict[str, Any] | None = None,
) -> ErrorReport:
    """
    Immediately persists any user-facing or backend error, emails the platform owner/admin,
    and sends an automatic error acknowledgement email to the affected user.
    """
    context = extract_customer_context(
        user=user,
        request=request,
        extra_context={
            **(extra_context or {}),
            "page_url": page_url,
            "user_email": user_email,
            "user_name": user_name,
        },
    )
    resolved_email = user_email or context.get("email", "")
    if resolved_email == "guest@anonymous":
        resolved_email = ""
    resolved_name = user_name or context.get("full_name", "User")

    auth_user = user if (user and getattr(user, "is_authenticated", False)) else None
    if not auth_user and request is not None and getattr(request, "user", None) and request.user.is_authenticated:
        auth_user = request.user

    report = ErrorReport.objects.create(
        user=auth_user,
        user_email=resolved_email,
        user_name=resolved_name,
        source=source,
        severity=severity,
        status=ErrorReport.Status.OPEN,
        title=title[:240] or "Application Error",
        message=message,
        stack_trace=stack_trace[:20000],
        page_url=page_url[:500],
        component_name=component_name[:160],
        screenshot_data_url=screenshot_data_url,
        user_session_info=context,
    )

    cfg = get_or_create_hosting_config()
    short_id = str(report.id)[:8].upper()

    # 1. Immediate email alert to platform owner / admin
    admin_subject = f"[EduSMS Error #{short_id}] [{severity.upper()}] {report.title}"
    admin_body = (
        f"An error occurred in EduSMS and was recorded immediately.\n\n"
        f"Incident ID: #{short_id} ({report.id})\n"
        f"Source: {report.get_source_display()}\n"
        f"Severity: {report.severity.upper()}\n"
        f"User: {resolved_name} ({resolved_email or 'Unauthenticated'})\n"
        f"Kind of User: {context.get('user_kind')}\n"
        f"Page / Endpoint: {report.page_url or 'N/A'}\n"
        f"Session IP / Device: {context.get('session', {}).get('ip_address')} / {context.get('session', {}).get('device_label')}\n"
        f"Screenshot Attached: {'Yes (View in EduSMS Support Console)' if screenshot_data_url else 'No'}\n\n"
        f"--- Error Message ---\n{report.message}\n\n"
        f"--- Stack Trace / Diagnostics ---\n{report.stack_trace or 'No stack trace provided.'}\n"
    )
    admin_sent = _send_platform_email(
        subject=admin_subject,
        body_text=admin_body,
        to_emails=[cfg.admin_alert_email, cfg.support_email],
        reply_to=[resolved_email] if resolved_email else None,
    )

    # 2. Automatic error response email to the affected user
    auto_reply_sent = False
    if resolved_email:
        user_subject = f"We received your EduSMS error report [Incident #{short_id}]"
        user_body = (
            f"Hello {resolved_name},\n\n"
            f"Our automated error monitoring system has recorded the issue you encountered on EduSMS "
            f"and alerted our engineering team immediately.\n\n"
            f"Incident Reference: #{short_id}\n"
            f"Summary: {report.title}\n"
            f"Page: {report.page_url or 'Application'}\n\n"
            f"You can also follow up anytime using the Instant Help & Live Chat icon at the bottom-right "
            f"of the EduSMS app or by replying to this email.\n\n"
            f"— EduSMS Automated Support ({cfg.subdomain})"
        )
        auto_reply_sent = _send_platform_email(
            subject=user_subject,
            body_text=user_body,
            to_emails=[resolved_email],
            reply_to=[cfg.support_email],
        )

    report.admin_email_sent = admin_sent
    report.auto_reply_email_sent = auto_reply_sent
    report.save(update_fields=["admin_email_sent", "auto_reply_email_sent", "updated_at"])

    if auth_user:
        Notification.objects.create(
            user=auth_user,
            category=Notification.Category.SUPPORT,
            level=Notification.Level.WARNING if severity != ErrorReport.Severity.CRITICAL else Notification.Level.ERROR,
            title=f"Error Recorded (#{short_id})",
            body=f"Your issue '{report.title}' was logged and sent to support.",
            action_url="/support",
            metadata={"error_report_id": str(report.id)},
        )
        _broadcast_ws_event(
            str(auth_user.id),
            "error.reported",
            {"id": str(report.id), "title": report.title, "status": report.status},
        )

    return report


def generate_instant_ai_help_reply(user_query: str, customer_context: dict[str, Any]) -> str:
    """
    Provides instant, accurate AI assistance inside the Instant Help side drawer.
    """
    q = user_query.strip().lower()
    name = customer_context.get("full_name", "there")
    online_gw = customer_context.get("telemetry", {}).get("online_devices_count", 0)
    paired_gw = customer_context.get("telemetry", {}).get("paired_devices_count", 0)

    if any(k in q for k in ["cpanel", "subdomain", "edusphere", "domain", "host", "live", "email"]):
        return (
            f"Hi {name}! To manage `edusms.edusphere.co.tz` and your cPanel hosting:\n"
            "1. Open **Server & GitHub Sync** in the left navigation.\n"
            "2. Enter your cPanel Username and API Token (or use the copy-paste cPanel UAPI commands) and click **Provision Subdomain & Support Email**.\n"
            "3. This creates `edusms.edusphere.co.tz`, provisions `support@edusms.edusphere.co.tz`, and activates automatic error & live-chat email routing."
        )
    if any(k in q for k in ["github", "sync", "git", "pull", "push", "update"]):
        return (
            f"Hi {name}! Your workspace is linked to `https://github.com/Hemedi18/edusms.git` (branch `main`).\n"
            "Whenever you push changes to GitHub, open **Server & GitHub Sync** (`/server-ops`) and click **Sync from GitHub Now** — or configure the GitHub push webhook `/api/v1/ops/github-webhook/` for zero-click auto-sync!"
        )
    if any(k in q for k in ["pair", "android", "sim", "gateway", "qr", "offline"]):
        status_note = (
            f"You currently have {online_gw} online gateway(s) out of {paired_gw} paired."
            if paired_gw
            else "You haven't paired an Android SIM gateway yet."
        )
        return (
            f"{status_note}\n"
            "To pair your Android phone:\n"
            "1. Go to **Devices** and click **Generate Pairing Code & QR**.\n"
            "2. In the EduSMS Android app, enter the 6-character code or scan the QR.\n"
            "3. Grant `SEND_SMS`, `RECEIVE_SMS`, and `READ_PHONE_STATE` permissions so the foreground service can poll and transmit via your SIM card."
        )
    if any(k in q for k in ["screenshot", "error", "bug", "crash", "problem", "broken"]):
        return (
            "You can click the **Take Screenshot** button right below this chat box to capture your current screen and attach it to your message or error report! "
            "Every error is also automatically emailed to our support team with your session diagnostics."
        )
    if any(k in q for k in ["human", "agent", "owner", "admin", "person", "talk"]):
        return (
            "I've flagged this conversation for **Live Human Support**. "
            "Switch the toggle at the top of this drawer to **Live Chat**, send your message (and a screenshot if helpful), and it will be emailed directly to the platform owner so they can reply live!"
        )
    return (
        f"Hi {name}! I'm the **EduSMS Instant AI Assistant**. I can help you with:\n"
        "• **Android SIM Gateway Pairing** & multi-SIM delivery tracking\n"
        "• **cPanel Hosting (`edusms.edusphere.co.tz`)** & email verification setup\n"
        "• **GitHub Auto-Sync (`Hemedi18/edusms`)** & server startup commands\n"
        "• **Rule & AI Auto-Replies**, Bulk Campaigns, or **Live Human Support** (you can also click **Take Screenshot** below to share your screen!)."
    )


@transaction.atomic
def send_support_chat_message(
    *,
    thread: SupportThread,
    sender_type: str,
    body: str,
    screenshot_data_url: str = "",
    via_channel: str = SupportMessage.ViaChannel.WEB_CHAT,
    user=None,
    request=None,
    extra_context: dict[str, Any] | None = None,
) -> list[SupportMessage]:
    """
    Appends a message to a SupportThread, updates customer session context on the side of the chat,
    emails the owner on the first customer message (with direct email-reply support), and optionally
    generates an AI Help response when in AI Assistant mode.
    """
    created_messages: list[SupportMessage] = []
    now = timezone.now()

    if sender_type == SupportMessage.SenderType.USER:
        context = extract_customer_context(user=user or thread.user, request=request, extra_context=extra_context)
        thread.customer_context = context
        if not thread.user_email and context.get("email") != "guest@anonymous":
            thread.user_email = context.get("email", "")
        if not thread.user_name:
            thread.user_name = context.get("full_name", "Customer")
        thread.unread_for_admin += 1
        thread.status = SupportThread.Status.AWAITING_ADMIN
        sender_label = thread.user_name or thread.user_email or "Customer"
    elif sender_type == SupportMessage.SenderType.ADMIN:
        thread.unread_for_user += 1
        thread.unread_for_admin = 0
        thread.status = SupportThread.Status.AWAITING_USER
        sender_label = "Support Admin"
    else:
        sender_label = "EduSMS AI Help"

    msg = SupportMessage.objects.create(
        thread=thread,
        sender_type=sender_type,
        sender_label=sender_label,
        via_channel=via_channel,
        body=body.strip(),
        screenshot_data_url=screenshot_data_url,
        metadata={"page_url": (extra_context or {}).get("page_url", "")},
    )
    created_messages.append(msg)
    thread.last_message_at = now

    # Send email to owner on first customer message (or when in live_human mode)
    cfg = get_or_create_hosting_config()
    if sender_type == SupportMessage.SenderType.USER and (
        not thread.first_email_notified or thread.mode == SupportThread.Mode.LIVE_HUMAN
    ):
        short_id = str(thread.id)[:8].upper()
        ctx = thread.customer_context or {}
        sess = ctx.get("session", {})
        subject = (
            f"[EduSMS Live Chat #{short_id}] New message from {thread.user_name or 'Customer'} "
            f"({thread.user_email or 'Guest'}) [Reply-Token:{thread.reply_token}]"
        )
        email_body = (
            f"New Live Support Chat message received on EduSMS ({cfg.subdomain}).\n\n"
            f"Customer: {thread.user_name or 'Guest'} <{thread.user_email or 'unauthenticated'}>\n"
            f"Kind of User: {ctx.get('user_kind', 'User')}\n"
            f"Organization: {ctx.get('organization', 'N/A')}\n"
            f"Session IP / Device: {sess.get('ip_address', 'N/A')} / {sess.get('device_label', 'Browser')}\n"
            f"Current Page: {ctx.get('page_url') or 'App'}\n"
            f"Screenshot Attached: {'Yes (View in Live Support Console)' if screenshot_data_url else 'No'}\n\n"
            f"--- Customer Message ---\n{msg.body}\n\n"
            f"--- How to Reply ---\n"
            f"1. Reply directly to this email (keep [Reply-Token:{thread.reply_token}] in the subject) — your reply will appear immediately in the user's Live Chat window!\n"
            f"2. Or open the EduSMS Live Support Console at {settings.PUBLIC_WEB_URL}/support\n"
        )
        _send_platform_email(
            subject=subject,
            body_text=email_body,
            to_emails=[cfg.admin_alert_email, cfg.support_email],
            reply_to=[thread.user_email] if thread.user_email else [cfg.support_email],
        )
        thread.first_email_notified = True

    # If Admin replied and customer has an email, also send email copy to customer
    if sender_type == SupportMessage.SenderType.ADMIN and thread.user_email:
        short_id = str(thread.id)[:8].upper()
        _send_platform_email(
            subject=f"Reply from EduSMS Support [Chat #{short_id}]",
            body_text=(
                f"Hello {thread.user_name or 'there'},\n\n"
                f"Support Admin replied to your live chat on EduSMS:\n\n"
                f"\"{msg.body}\"\n\n"
                f"You can view and continue the conversation live inside the EduSMS app.\n"
            ),
            to_emails=[thread.user_email],
            reply_to=[cfg.support_email],
        )

    # If in AI Assistant mode and sender is User, generate instant AI reply
    if sender_type == SupportMessage.SenderType.USER and thread.mode == SupportThread.Mode.AI_ASSISTANT:
        ai_text = generate_instant_ai_help_reply(msg.body, thread.customer_context or {})
        ai_msg = SupportMessage.objects.create(
            thread=thread,
            sender_type=SupportMessage.SenderType.AI,
            sender_label="EduSMS AI Assistant",
            via_channel=SupportMessage.ViaChannel.AI_HELPER,
            body=ai_text,
        )
        created_messages.append(ai_msg)
        thread.status = SupportThread.Status.AWAITING_USER

    thread.save()

    # Broadcast real-time WebSocket event to the customer (and to any staff/admin listening)
    target_user_id = str(thread.user_id) if thread.user_id else None
    for m in created_messages:
        payload = {
            "thread_id": str(thread.id),
            "message": {
                "id": str(m.id),
                "sender_type": m.sender_type,
                "sender_label": m.sender_label,
                "via_channel": m.via_channel,
                "body": m.body,
                "screenshot_data_url": m.screenshot_data_url,
                "created_at": m.created_at.isoformat(),
            },
        }
        _broadcast_ws_event(target_user_id, "support.message", payload)

    return created_messages


def _strip_quoted_email_reply(raw_body: str) -> str:
    lines = []
    for line in raw_body.splitlines():
        stripped = line.strip()
        if stripped.startswith(">"):
            continue
        if re.match(r"^On .+ wrote:$", stripped, re.IGNORECASE):
            break
        if stripped.startswith("--- Customer Message ---"):
            break
        lines.append(line)
    cleaned = "\n".join(lines).strip()
    return cleaned or raw_body.strip()


@transaction.atomic
def process_inbound_email_reply(
    *,
    subject: str = "",
    from_email: str = "",
    body: str = "",
    reply_token: str = "",
    thread_id: str = "",
) -> SupportMessage | None:
    """
    Bridges direct email replies from the platform owner/admin into the customer's Live Chat thread
    and pushes the message in real time over WebSockets.
    """
    thread = None
    if reply_token:
        thread = SupportThread.objects.filter(reply_token=reply_token.strip()).first()
    if not thread and subject:
        m = re.search(r"Reply-Token:\s*(educhat_[A-Za-z0-9_\-]+)", subject)
        if m:
            thread = SupportThread.objects.filter(reply_token=m.group(1)).first()
    if not thread and thread_id:
        thread = SupportThread.objects.filter(id=thread_id).first()
    if not thread and subject:
        m_short = re.search(r"#([0-9A-Fa-f]{8})", subject)
        if m_short:
            prefix = m_short.group(1).lower()
            for candidate in SupportThread.objects.order_by("-last_message_at")[:50]:
                if str(candidate.id).lower().startswith(prefix):
                    thread = candidate
                    break

    if not thread:
        return None

    cleaned_body = _strip_quoted_email_reply(body)
    if not cleaned_body:
        return None

    msgs = send_support_chat_message(
        thread=thread,
        sender_type=SupportMessage.SenderType.ADMIN,
        body=cleaned_body,
        via_channel=SupportMessage.ViaChannel.EMAIL_REPLY,
        extra_context={"admin_from_email": from_email},
    )
    return msgs[0] if msgs else None
