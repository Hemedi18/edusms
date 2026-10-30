from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.accounts.models import validate_iana_timezone
from apps.core.crypto import decrypt_secret, encrypt_secret
from apps.core.models import TimeStampedUUIDModel


class ScheduleWindow(TimeStampedUUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="schedule_windows",
    )
    name = models.CharField(max_length=120)
    timezone = models.CharField(
        max_length=64,
        default="Africa/Dar_es_Salaam",
        validators=[validate_iana_timezone],
    )
    # List of weekday integers: 0 = Monday ... 6 = Sunday
    days_of_week = models.JSONField(default=list)
    start_time = models.TimeField()
    end_time = models.TimeField()
    effective_from = models.DateField(null=True, blank=True)
    effective_until = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.start_time}-{self.end_time} {self.timezone})"


class AIProviderConfig(TimeStampedUUIDModel):
    class ProviderType(models.TextChoices):
        OPENAI_COMPATIBLE = "openai_compatible", "OpenAI-Compatible Chat Completions API"
        GEMINI = "gemini", "Google Gemini API"
        DETERMINISTIC_MOCK = "deterministic_mock", "Deterministic Local Mock (No Key Required)"

    class TestStatus(models.TextChoices):
        UNTESTED = "untested", "Untested"
        OK = "ok", "Verified"
        ERROR = "error", "Connection Error"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_providers",
    )
    name = models.CharField(max_length=120)
    provider_type = models.CharField(
        max_length=32,
        choices=ProviderType.choices,
        default=ProviderType.OPENAI_COMPATIBLE,
    )
    api_base_url = models.URLField(blank=True, default="https://api.openai.com/v1")
    encrypted_api_key = models.TextField(blank=True, default="")
    model_name = models.CharField(max_length=80, default="gpt-4o-mini")
    temperature = models.FloatField(default=0.3)
    max_output_tokens = models.PositiveIntegerField(default=160)
    max_response_chars = models.PositiveIntegerField(default=320)
    timeout_seconds = models.PositiveSmallIntegerField(default=12)
    max_retries = models.PositiveSmallIntegerField(default=1)
    is_enabled = models.BooleanField(default=True)
    simulate_failure = models.BooleanField(
        default=False,
        help_text="Development testing flag to simulate provider outage and verify fallback behavior.",
    )
    system_instructions = models.TextField(
        default="You are a concise, polite SMS assistant. Reply in plain text under 160 characters."
    )
    fallback_message = models.TextField(
        blank=True,
        default="Thank you for your message. I cannot generate an automated answer right now, and will reply soon.",
    )

    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_status = models.CharField(max_length=16, choices=TestStatus.choices, default=TestStatus.UNTESTED)
    last_error = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def set_api_key(self, raw_key: str) -> None:
        self.encrypted_api_key = encrypt_secret(raw_key)

    def get_api_key(self) -> str:
        return decrypt_secret(self.encrypted_api_key)

    def __str__(self) -> str:
        return f"{self.name} ({self.model_name})"


class AICallLog(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        SUCCESS = "success", "Success"
        FALLBACK_USED = "fallback_used", "Provider Failed — Deterministic Fallback Used"
        ERROR = "error", "Error"
        TIMEOUT = "timeout", "Timeout"
        BLOCKED_SAFETY = "blocked_safety", "Blocked by Safety Guard"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_call_logs",
    )
    provider = models.ForeignKey(
        AIProviderConfig,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="call_logs",
    )
    inbound_message = models.ForeignKey(
        "messaging.Message",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_call_logs",
    )
    model_name = models.CharField(max_length=80)
    status = models.CharField(max_length=24, choices=Status.choices)
    latency_ms = models.PositiveIntegerField(default=0)
    prompt_chars = models.PositiveIntegerField(default=0)
    response_chars = models.PositiveIntegerField(default=0)
    response_preview = models.CharField(max_length=320, blank=True, default="")
    error_message = models.CharField(max_length=255, blank=True, default="")
    is_test = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
        ]


class AutomationMode(TimeStampedUUIDModel):
    class BuiltinSlug(models.TextChoices):
        DEFAULT = "default", "Default"
        MEETING = "meeting", "Meeting"
        FOCUS = "focus", "Focus"
        VACATION = "vacation", "Vacation"
        SLEEPING = "sleeping", "Sleeping"
        CUSTOM = "custom", "Custom"

    class ResponseMethod(models.TextChoices):
        RULES_ONLY = "rules_only", "Keyword & Regex Rules Only"
        TEMPLATE_ONLY = "template_only", "Mode Static/Template Auto-Reply"
        AI_ONLY = "ai_only", "AI-Generated Response"
        RULES_THEN_AI = "rules_then_ai", "Rules First, Then AI Fallback"
        RULES_THEN_TEMPLATE = "rules_then_template", "Rules First, Then Mode Template"

    class FallbackBehavior(models.TextChoices):
        SEND_FALLBACK = "send_fallback", "Send Configured Fallback Message"
        NO_REPLY = "no_reply", "Do Not Send Automated Reply"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="automation_modes",
    )
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=40)
    is_builtin = models.BooleanField(default=False)
    description = models.CharField(max_length=255, blank=True, default="")
    icon = models.CharField(max_length=32, default="sparkles")
    is_enabled = models.BooleanField(default=True)
    is_active = models.BooleanField(default=False, db_index=True)
    priority = models.IntegerField(default=10)

    response_method = models.CharField(
        max_length=28,
        choices=ResponseMethod.choices,
        default=ResponseMethod.RULES_ONLY,
    )
    response_template = models.TextField(blank=True, default="")
    ai_provider = models.ForeignKey(
        AIProviderConfig,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="modes",
    )
    ai_override_instructions = models.TextField(blank=True, default="")
    schedule = models.ForeignKey(
        ScheduleWindow,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="modes",
    )
    selected_groups = models.ManyToManyField(
        "contacts.ContactGroup",
        blank=True,
        related_name="modes_targeting_group",
    )
    allowed_contacts = models.ManyToManyField(
        "contacts.Contact",
        blank=True,
        related_name="modes_explicitly_allowing",
    )
    blocked_contacts = models.ManyToManyField(
        "contacts.Contact",
        blank=True,
        related_name="modes_explicitly_blocking",
    )

    cooldown_minutes = models.PositiveIntegerField(default=15)
    max_replies_per_sender_per_day = models.PositiveIntegerField(default=5)
    require_human_approval = models.BooleanField(default=False)
    fallback_behavior = models.CharField(
        max_length=24,
        choices=FallbackBehavior.choices,
        default=FallbackBehavior.NO_REPLY,
    )
    fallback_text = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-is_active", "-priority", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "slug"],
                name="uniq_automation_mode_user_slug",
            )
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.user.email})"


class AutoReplyRule(TimeStampedUUIDModel):
    class MatchMode(models.TextChoices):
        EXACT = "exact", "Exact Text"
        CONTAINS = "contains", "Contains"
        STARTS_WITH = "starts_with", "Starts With"
        ENDS_WITH = "ends_with", "Ends With"
        WHOLE_WORD = "whole_word", "Whole Word"
        REGEX = "regex", "Regular Expression"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="auto_reply_rules",
    )
    name = models.CharField(max_length=120)
    is_enabled = models.BooleanField(default=True, db_index=True)
    match_mode = models.CharField(max_length=20, choices=MatchMode.choices, default=MatchMode.CONTAINS)
    keywords = models.JSONField(default=list, help_text="List of keywords or regex patterns.")
    case_sensitive = models.BooleanField(default=False)

    allowed_senders = models.JSONField(default=list, blank=True)
    restricted_contacts = models.ManyToManyField(
        "contacts.Contact",
        blank=True,
        related_name="restricted_rules",
    )
    restricted_groups = models.ManyToManyField(
        "contacts.ContactGroup",
        blank=True,
        related_name="restricted_rules",
    )
    apply_in_modes = models.ManyToManyField(
        AutomationMode,
        blank=True,
        related_name="scoped_rules",
    )
    schedule = models.ForeignKey(
        ScheduleWindow,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="rules",
    )

    response_template = models.TextField()
    custom_variables = models.JSONField(default=dict, blank=True)
    priority = models.IntegerField(default=50, db_index=True)
    cooldown_minutes = models.PositiveIntegerField(default=10)
    max_responses_per_day = models.PositiveIntegerField(default=10)
    require_human_approval = models.BooleanField(default=False)
    expires_at = models.DateTimeField(null=True, blank=True)

    hit_count = models.PositiveIntegerField(default=0)
    last_triggered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-priority", "name"]
        indexes = [
            models.Index(fields=["user", "is_enabled", "-priority"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} [prio={self.priority}]"
