from __future__ import annotations

import secrets
import string
from datetime import timedelta
from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedUUIDModel


class Device(TimeStampedUUIDModel):
    class Platform(models.TextChoices):
        ANDROID = "android", "Android SIM Gateway"
        IOS = "ios", "iOS Companion Device"

    class ConnectionStatus(models.TextChoices):
        ONLINE = "online", "Online"
        OFFLINE = "offline", "Offline"
        RECONNECTING = "reconnecting", "Reconnecting"
        PAUSED = "paused", "Paused"
        REVOKED = "revoked", "Revoked"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="devices",
    )
    name = models.CharField(max_length=120)
    device_identity = models.CharField(
        max_length=128,
        help_text="Client-generated persistent installation identifier.",
    )
    platform = models.CharField(max_length=16, choices=Platform.choices, default=Platform.ANDROID)
    manufacturer = models.CharField(max_length=80, blank=True, default="")
    device_model = models.CharField(max_length=80, blank=True, default="")
    os_version = models.CharField(max_length=40, blank=True, default="")
    app_version = models.CharField(max_length=32, blank=True, default="1.0.0")

    # Gateway credential (stored only as SHA-256 hash)
    gateway_token_prefix = models.CharField(max_length=24, blank=True, default="")
    gateway_token_hash = models.CharField(max_length=64, unique=True, db_index=True)

    # Operational controls & status
    is_enabled = models.BooleanField(default=True)
    is_paused = models.BooleanField(default=False)
    connection_status = models.CharField(
        max_length=20,
        choices=ConnectionStatus.choices,
        default=ConnectionStatus.OFFLINE,
    )

    # Telephony & SIM telemetry
    sim_available = models.BooleanField(default=False)
    sim_slots = models.JSONField(default=list, blank=True)
    selected_sim_slot = models.PositiveSmallIntegerField(default=0)
    network_type = models.CharField(max_length=40, blank=True, default="")
    carrier_name = models.CharField(max_length=80, blank=True, default="")
    battery_level = models.PositiveSmallIntegerField(null=True, blank=True)
    is_charging = models.BooleanField(default=False)
    is_default_sms_app = models.BooleanField(default=False)
    permissions_state = models.JSONField(default=dict, blank=True)

    # Counters & diagnostics
    incoming_message_count = models.PositiveIntegerField(default=0)
    outgoing_message_count = models.PositiveIntegerField(default=0)
    failed_transmission_count = models.PositiveIntegerField(default=0)
    recent_events = models.JSONField(default=list, blank=True)
    last_error = models.CharField(max_length=255, blank=True, default="")
    recommended_action = models.CharField(max_length=255, blank=True, default="")

    last_heartbeat_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "revoked_at"]),
            models.Index(fields=["user", "connection_status"]),
        ]

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    @property
    def is_online(self) -> bool:
        if self.is_revoked or not self.is_enabled:
            return False
        if not self.last_heartbeat_at:
            return False
        threshold = timedelta(seconds=getattr(settings, "GATEWAY_ONLINE_THRESHOLD_SECONDS", 90))
        return (timezone.now() - self.last_heartbeat_at) <= threshold

    @property
    def can_transmit_real_sms(self) -> bool:
        return (
            self.platform == self.Platform.ANDROID
            and not self.is_revoked
            and self.is_enabled
            and not self.is_paused
            and self.sim_available
        )

    def append_event(self, event_type: str, detail: str) -> None:
        events = list(self.recent_events or [])
        events.insert(
            0,
            {
                "type": event_type,
                "detail": detail[:200],
                "timestamp": timezone.now().isoformat(),
            },
        )
        self.recent_events = events[:30]

    def __str__(self) -> str:
        return f"{self.name} ({self.platform})"


class PairingSession(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending Pairing"
        AWAITING_APPROVAL = "awaiting_approval", "Claimed — Awaiting Account Approval"
        APPROVED = "approved", "Approved"
        CONSUMED = "consumed", "Consumed"
        EXPIRED = "expired", "Expired"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pairing_sessions",
    )
    device_name_hint = models.CharField(max_length=120, blank=True, default="Android SIM Gateway")
    code_hash = models.CharField(max_length=64, db_index=True)
    qr_secret_hash = models.CharField(max_length=64, db_index=True)
    claim_nonce_hash = models.CharField(max_length=64, blank=True, default="")
    pending_device_metadata = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.PENDING)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    paired_device = models.ForeignKey(
        Device,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pairing_sessions",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "status", "-created_at"]),
        ]

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at or self.status == self.Status.EXPIRED

    @staticmethod
    def generate_human_code(length: int = 6) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return "".join(secrets.choice(alphabet) for _ in range(length))


class GatewaySession(TimeStampedUUIDModel):
    device = models.ForeignKey(
        Device,
        on_delete=models.CASCADE,
        related_name="gateway_sessions",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    network_type = models.CharField(max_length=40, blank=True, default="")
    app_version = models.CharField(max_length=32, blank=True, default="")
    heartbeat_count = models.PositiveIntegerField(default=1)
    started_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_seen_at"]
        indexes = [
            models.Index(fields=["device", "ended_at", "-last_seen_at"]),
        ]
