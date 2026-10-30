from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.accounts.models import validate_iana_timezone
from apps.core.models import TimeStampedUUIDModel


class BulkCampaign(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SCHEDULED = "scheduled", "Scheduled"
        RUNNING = "running", "Running"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        CANCELED = "canceled", "Canceled"
        FAILED = "failed", "Failed"

    class TransportType(models.TextChoices):
        SIM_GATEWAY = "sim_gateway", "Physical Android SIM Gateway"
        EXTERNAL_PROVIDER = "external_provider", "External SMS Provider"
        SIMULATION = "simulation", "Simulation Sandbox"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="bulk_campaigns",
    )
    name = models.CharField(max_length=150)
    message_template = models.TextField()
    transport_type = models.CharField(
        max_length=24,
        choices=TransportType.choices,
        default=TransportType.SIMULATION,
    )
    is_simulation = models.BooleanField(default=True, db_index=True)

    device = models.ForeignKey(
        "devices.Device",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="campaigns",
    )
    sender_identity = models.ForeignKey(
        "messaging.SenderIdentityConfig",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="campaigns",
    )
    sim_slot = models.PositiveSmallIntegerField(null=True, blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    timezone = models.CharField(
        max_length=64,
        default="Africa/Dar_es_Salaam",
        validators=[validate_iana_timezone],
    )
    scheduled_at = models.DateTimeField(null=True, blank=True, db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    # Traffic & compliance controls
    inter_message_interval_ms = models.PositiveIntegerField(default=1500)
    max_volume = models.PositiveIntegerField(default=1000)
    recipient_cooldown_minutes = models.PositiveIntegerField(default=60)
    operating_window_start = models.TimeField(null=True, blank=True)
    operating_window_end = models.TimeField(null=True, blank=True)
    quiet_hours_start = models.TimeField(null=True, blank=True)
    quiet_hours_end = models.TimeField(null=True, blank=True)
    max_retries = models.PositiveSmallIntegerField(default=1)
    error_pause_threshold_pct = models.PositiveSmallIntegerField(default=35)
    simulated_outcome = models.CharField(max_length=28, default="simulated_delivered")

    total_input_count = models.PositiveIntegerField(default=0)
    duplicate_removed_count = models.PositiveIntegerField(default=0)
    pause_reason = models.CharField(max_length=255, blank=True, default="")

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    canceled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    (Q(transport_type="simulation") & Q(is_simulation=True))
                    | (~Q(transport_type="simulation") & Q(is_simulation=False))
                ),
                name="chk_campaign_simulation_transport_match",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "status", "-created_at"]),
            models.Index(fields=["status", "scheduled_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.status})"


class CampaignRecipient(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        EXCLUDED = "excluded", "Excluded (Policy / Invalid / Opt-Out)"
        QUEUED = "queued", "Queued on Gateway"
        SUBMITTED = "submitted", "Accepted for Transmission"
        DELIVERED = "delivered", "Carrier Delivery Confirmed"
        DELIVERY_UNKNOWN = "delivery_unknown", "Delivery Report Unavailable"
        SIMULATED_SENT = "simulated_sent", "Simulated Sent"
        SIMULATED_DELIVERED = "simulated_delivered", "Simulated Delivered"
        FAILED = "failed", "Failed"
        CANCELED = "canceled", "Canceled"
        EXPIRED = "expired", "Expired"

    campaign = models.ForeignKey(
        BulkCampaign,
        on_delete=models.CASCADE,
        related_name="recipients",
    )
    contact = models.ForeignKey(
        "contacts.Contact",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="campaign_entries",
    )
    message = models.OneToOneField(
        "messaging.Message",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="campaign_recipient_entry",
    )
    phone_number = models.CharField(max_length=40, db_index=True)
    recipient_name = models.CharField(max_length=160, blank=True, default="")
    rendered_body = models.TextField(blank=True, default="")
    status = models.CharField(max_length=28, choices=Status.choices, default=Status.PENDING, db_index=True)
    exclusion_reason = models.CharField(max_length=255, blank=True, default="")
    error_detail = models.CharField(max_length=255, blank=True, default="")
    attempts_count = models.PositiveSmallIntegerField(default=0)
    processed_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["campaign", "phone_number"],
                name="uniq_campaign_recipient_phone",
            )
        ]
        indexes = [
            models.Index(fields=["campaign", "status"]),
        ]
