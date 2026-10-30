from __future__ import annotations

import secrets
from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.crypto import decrypt_secret, encrypt_secret
from apps.core.models import TimeStampedUUIDModel


SUPPORTED_API_SCOPES = [
    "messages:read",
    "messages:write",
    "contacts:read",
    "contacts:write",
    "campaigns:read",
    "campaigns:write",
    "simulation:write",
    "analytics:read",
]

SUPPORTED_WEBHOOK_EVENTS = [
    "device.connected",
    "device.disconnected",
    "sms.received",
    "sms.queued",
    "sms.sent",
    "sms.delivered",
    "sms.failed",
    "sms.delivery_unknown",
    "auto_reply.triggered",
    "campaign.started",
    "campaign.progress",
    "campaign.completed",
    "campaign.failed",
    "automation.mode_changed",
]


class APIKey(TimeStampedUUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="api_keys",
    )
    name = models.CharField(max_length=120)
    key_prefix = models.CharField(max_length=24, db_index=True)
    key_hash = models.CharField(max_length=64, unique=True, db_index=True)
    scopes = models.JSONField(default=list)
    simulation_only = models.BooleanField(default=False)
    rate_limit_per_minute = models.PositiveIntegerField(default=60)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "revoked_at"]),
        ]

    @property
    def is_active_key(self) -> bool:
        if self.revoked_at is not None:
            return False
        if self.expires_at and timezone.now() >= self.expires_at:
            return False
        return True

    def __str__(self) -> str:
        return f"{self.name} ({self.key_prefix}…)"


class WebhookEndpoint(TimeStampedUUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="webhook_endpoints",
    )
    name = models.CharField(max_length=120)
    url = models.URLField(max_length=500)
    encrypted_signing_secret = models.TextField()
    events = models.JSONField(default=list)
    include_simulation_events = models.BooleanField(default=True)
    timeout_seconds = models.PositiveSmallIntegerField(default=8)
    is_active = models.BooleanField(default=True, db_index=True)
    secret_rotated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def set_signing_secret(self, raw_secret: str) -> None:
        self.encrypted_signing_secret = encrypt_secret(raw_secret)

    def get_signing_secret(self) -> str:
        return decrypt_secret(self.encrypted_signing_secret)

    def __str__(self) -> str:
        return f"{self.name} -> {self.url}"


class WebhookEvent(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        DELIVERED = "delivered", "Delivered"
        RETRYING = "retrying", "Retrying with Backoff"
        DEAD_LETTER = "dead_letter", "Dead Letter (Max Retries Exhausted)"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="webhook_events",
    )
    endpoint = models.ForeignKey(
        WebhookEndpoint,
        on_delete=models.CASCADE,
        related_name="webhook_events",
    )
    event_uid = models.CharField(max_length=48, unique=True, db_index=True)
    event_type = models.CharField(max_length=48, db_index=True)
    is_simulation = models.BooleanField(default=False)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=5)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "status", "-created_at"]),
        ]

    @staticmethod
    def generate_uid() -> str:
        return f"evt_{secrets.token_hex(12)}"


class WebhookDeliveryAttempt(TimeStampedUUIDModel):
    webhook_event = models.ForeignKey(
        WebhookEvent,
        on_delete=models.CASCADE,
        related_name="attempts",
    )
    attempt_number = models.PositiveSmallIntegerField(default=1)
    request_headers = models.JSONField(default=dict)
    response_status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    response_body_preview = models.CharField(max_length=500, blank=True, default="")
    latency_ms = models.PositiveIntegerField(default=0)
    succeeded = models.BooleanField(default=False)
    error_message = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["attempt_number"]
