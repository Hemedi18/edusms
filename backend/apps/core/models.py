from __future__ import annotations

import secrets
import uuid
from django.conf import settings
from django.db import models

from .crypto import decrypt_secret, encrypt_secret


class TimeStampedUUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Notification(TimeStampedUUIDModel):
    class Level(models.TextChoices):
        INFO = "info", "Info"
        SUCCESS = "success", "Success"
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"

    class Category(models.TextChoices):
        GATEWAY = "gateway", "Gateway"
        MESSAGE = "message", "Message"
        AUTOMATION = "automation", "Automation"
        CAMPAIGN = "campaign", "Campaign"
        SECURITY = "security", "Security"
        WEBHOOK = "webhook", "Webhook"
        SUPPORT = "support", "Support & Live Chat"
        SYSTEM = "system", "System"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.SYSTEM)
    level = models.CharField(max_length=16, choices=Level.choices, default=Level.INFO)
    title = models.CharField(max_length=160)
    body = models.TextField()
    action_url = models.CharField(max_length=255, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_read", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"[{self.level}] {self.title}"


class AuditEvent(TimeStampedUUIDModel):
    class ActorType(models.TextChoices):
        USER = "user", "User"
        API_KEY = "api_key", "API Key"
        DEVICE = "device", "Gateway Device"
        SYSTEM = "system", "System"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    actor_type = models.CharField(max_length=24, choices=ActorType.choices, default=ActorType.USER)
    actor_identifier = models.CharField(max_length=128, blank=True, default="")
    event_type = models.CharField(max_length=80, db_index=True)
    target_type = models.CharField(max_length=64, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True, default="")
    summary = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["event_type", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.event_type}: {self.summary}"


class IdempotencyRecord(TimeStampedUUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="idempotency_records",
    )
    key = models.CharField(max_length=128)
    endpoint = models.CharField(max_length=128)
    request_hash = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField()
    response_body = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "key", "endpoint"],
                name="uniq_idempotency_user_key_endpoint",
            )
        ]
        indexes = [
            models.Index(fields=["user", "key", "endpoint"]),
        ]


class ErrorReport(TimeStampedUUIDModel):
    """
    Captures both automatic runtime errors (frontend/backend/mobile) and manual user error submissions,
    along with optional screen capture screenshots, session telemetry, and automatic email alerting.
    """

    class Source(models.TextChoices):
        WEB_AUTO = "web_auto", "Web Automatic Crash / Error"
        WEB_MANUAL = "web_manual", "Web Manual Error Submission"
        MOBILE_AUTO = "mobile_auto", "Mobile Automatic Error"
        MOBILE_MANUAL = "mobile_manual", "Mobile Manual Error Submission"
        BACKEND_EXCEPTION = "backend_exception", "Backend Unhandled Exception"

    class Severity(models.TextChoices):
        CRITICAL = "critical", "Critical"
        ERROR = "error", "Error"
        WARNING = "warning", "Warning"
        MANUAL = "manual", "User Submitted Issue"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        INVESTIGATING = "investigating", "Investigating"
        RESOLVED = "resolved", "Resolved"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="error_reports",
    )
    user_email = models.EmailField(blank=True, default="")
    user_name = models.CharField(max_length=120, blank=True, default="")
    source = models.CharField(max_length=32, choices=Source.choices, default=Source.WEB_AUTO)
    severity = models.CharField(max_length=24, choices=Severity.choices, default=Severity.ERROR)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.OPEN, db_index=True)
    title = models.CharField(max_length=240)
    message = models.TextField()
    stack_trace = models.TextField(blank=True, default="")
    page_url = models.CharField(max_length=500, blank=True, default="")
    component_name = models.CharField(max_length=160, blank=True, default="")
    screenshot_data_url = models.TextField(blank=True, default="")
    user_session_info = models.JSONField(default=dict, blank=True)
    admin_email_sent = models.BooleanField(default=False)
    auto_reply_email_sent = models.BooleanField(default=False)
    admin_response = models.TextField(blank=True, default="")
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"[{self.severity}] {self.title} ({self.user_email or 'anonymous'})"


def _default_reply_token() -> str:
    return f"educhat_{secrets.token_urlsafe(18)}"


class SupportThread(TimeStampedUUIDModel):
    """
    Live Customer Support & AI Help thread with automatic customer session context recording
    and email-to-chat bidirectional bridging.
    """

    class Mode(models.TextChoices):
        AI_ASSISTANT = "ai_assistant", "AI Instant Help"
        LIVE_HUMAN = "live_human", "Live Support Chat"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        AWAITING_ADMIN = "awaiting_admin", "Awaiting Admin Reply"
        AWAITING_USER = "awaiting_user", "Awaiting Customer Reply"
        RESOLVED = "resolved", "Resolved"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="support_threads",
    )
    user_email = models.EmailField(blank=True, default="")
    user_name = models.CharField(max_length=120, blank=True, default="")
    subject = models.CharField(max_length=200, default="Instant Help & Live Support")
    mode = models.CharField(max_length=24, choices=Mode.choices, default=Mode.LIVE_HUMAN)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.OPEN, db_index=True)
    reply_token = models.CharField(max_length=64, unique=True, default=_default_reply_token, db_index=True)
    first_email_notified = models.BooleanField(default=False)
    customer_context = models.JSONField(default=dict, blank=True)
    unread_for_admin = models.PositiveIntegerField(default=0)
    unread_for_user = models.PositiveIntegerField(default=0)
    last_message_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-last_message_at", "-created_at"]
        indexes = [
            models.Index(fields=["status", "-last_message_at"]),
            models.Index(fields=["user", "-last_message_at"]),
        ]

    def __str__(self) -> str:
        return f"Thread #{str(self.id)[:8]} ({self.user_email or 'Guest'})"


class SupportMessage(TimeStampedUUIDModel):
    class SenderType(models.TextChoices):
        USER = "user", "Customer"
        ADMIN = "admin", "Support Admin"
        AI = "ai", "EduSMS AI Assistant"
        SYSTEM = "system", "System"

    class ViaChannel(models.TextChoices):
        WEB_CHAT = "web_chat", "Web Live Chat"
        MOBILE_CHAT = "mobile_chat", "Mobile Live Chat"
        ADMIN_CONSOLE = "admin_console", "Admin Support Console"
        EMAIL_REPLY = "email_reply", "Direct Email Reply"
        AI_HELPER = "ai_helper", "Instant AI Assistant"

    thread = models.ForeignKey(
        SupportThread,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    sender_type = models.CharField(max_length=16, choices=SenderType.choices, default=SenderType.USER)
    sender_label = models.CharField(max_length=120, blank=True, default="")
    via_channel = models.CharField(max_length=24, choices=ViaChannel.choices, default=ViaChannel.WEB_CHAT)
    body = models.TextField()
    screenshot_data_url = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["thread", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"[{self.sender_type}] {self.body[:50]}"


class ServerHostingConfig(TimeStampedUUIDModel):
    """
    Stores cPanel (`edusms.edusphere.co.tz`), SMTP/IMAP Support Email, and GitHub (`Hemedi18/edusms`)
    synchronization settings and operational telemetry.
    """

    primary_domain = models.CharField(max_length=160, default="edusphere.co.tz")
    subdomain = models.CharField(max_length=160, default="edusms.edusphere.co.tz")
    cpanel_host = models.CharField(max_length=255, default="https://edusphere.co.tz:2083")
    cpanel_username = models.CharField(max_length=120, blank=True, default="")
    encrypted_cpanel_api_token = models.TextField(blank=True, default="")
    document_root = models.CharField(max_length=255, default="public_html/edusms")
    support_email = models.EmailField(default="support@edusms.edusphere.co.tz")
    admin_alert_email = models.EmailField(default="admin@edusphere.co.tz")
    smtp_host = models.CharField(max_length=255, default="mail.edusphere.co.tz")
    smtp_port = models.PositivePositiveSmallIntegerField(default=587) if hasattr(models, "PositivePositiveSmallIntegerField") else models.PositiveSmallIntegerField(default=587)
    smtp_use_tls = models.BooleanField(default=True)
    smtp_username = models.CharField(max_length=160, default="support@edusms.edusphere.co.tz")
    encrypted_smtp_password = models.TextField(blank=True, default="")
    github_repo_url = models.CharField(max_length=255, default="https://github.com/Hemedi18/edusms.git")
    github_branch = models.CharField(max_length=80, default="main")
    encrypted_github_pat = models.TextField(blank=True, default="")
    auto_sync_enabled = models.BooleanField(default=True)
    last_cpanel_summary = models.JSONField(default=dict, blank=True)
    last_git_sync_at = models.DateTimeField(null=True, blank=True)
    last_git_sync_status = models.CharField(max_length=32, blank=True, default="ready")
    last_git_sync_output = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-updated_at"]

    def set_cpanel_api_token(self, raw_token: str) -> None:
        self.encrypted_cpanel_api_token = encrypt_secret(raw_token) if raw_token else ""

    def get_cpanel_api_token(self) -> str:
        return decrypt_secret(self.encrypted_cpanel_api_token) if self.encrypted_cpanel_api_token else ""

    def set_smtp_password(self, raw_password: str) -> None:
        self.encrypted_smtp_password = encrypt_secret(raw_password) if raw_password else ""

    def get_smtp_password(self) -> str:
        return decrypt_secret(self.encrypted_smtp_password) if self.encrypted_smtp_password else ""

    def set_github_pat(self, raw_pat: str) -> None:
        self.encrypted_github_pat = encrypt_secret(raw_pat) if raw_pat else ""

    def get_github_pat(self) -> str:
        return decrypt_secret(self.encrypted_github_pat) if self.encrypted_github_pat else ""
