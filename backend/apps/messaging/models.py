from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.crypto import decrypt_secret, encrypt_secret
from apps.core.models import TimeStampedUUIDModel


class SenderIdentityConfig(TimeStampedUUIDModel):
    class IdentityType(models.TextChoices):
        SIM_SLOT = "sim_slot", "Physical Android SIM Card (Carrier Number)"
        EXTERNAL_PROVIDER = "external_provider", "External SMS Provider Registered Sender ID"

    class RegistrationStatus(models.TextChoices):
        SIM_NATIVE = "sim_native", "Carrier SIM Native Number"
        PENDING_REGISTRATION = "pending_registration", "Pending Regulatory/Provider Registration"
        VERIFIED_ACTIVE = "verified_active", "Verified & Registered with Provider"
        DEV_ADAPTER = "dev_adapter", "Development Provider Adapter (Unverified)"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sender_identities",
    )
    label = models.CharField(max_length=120)
    identity_type = models.CharField(max_length=24, choices=IdentityType.choices)
    device = models.ForeignKey(
        "devices.Device",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="sender_identities",
    )
    sim_slot = models.PositiveSmallIntegerField(default=0)
    sim_phone_number_hint = models.CharField(max_length=24, blank=True, default="")

    # External provider fields (kept strictly separate from SIM gateway identity)
    provider_name = models.CharField(max_length=64, blank=True, default="")
    provider_base_url = models.URLField(blank=True, default="")
    alphanumeric_sender_id = models.CharField(max_length=11, blank=True, default="")
    country_code = models.CharField(max_length=4, default="TZ")
    registration_status = models.CharField(
        max_length=32,
        choices=RegistrationStatus.choices,
        default=RegistrationStatus.SIM_NATIVE,
    )
    encrypted_provider_api_key = models.TextField(blank=True, default="")
    is_enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~(Q(identity_type="sim_slot") & ~Q(alphanumeric_sender_id="")),
                name="chk_sim_slot_cannot_spoof_alphanumeric_sender_id",
            ),
        ]

    def set_provider_api_key(self, raw_key: str) -> None:
        self.encrypted_provider_api_key = encrypt_secret(raw_key)

    def get_provider_api_key(self) -> str:
        return decrypt_secret(self.encrypted_provider_api_key)


class Message(TimeStampedUUIDModel):
    class Direction(models.TextChoices):
        INBOUND = "inbound", "Inbound"
        OUTBOUND = "outbound", "Outbound"

    class TransportType(models.TextChoices):
        SIM_GATEWAY = "sim_gateway", "Physical Android SIM Gateway"
        EXTERNAL_PROVIDER = "external_provider", "External SMS Provider"
        SIMULATION = "simulation", "Simulation Sandbox"

    class Status(models.TextChoices):
        PENDING_APPROVAL = "pending_approval", "Pending Human Approval"
        QUEUED = "queued", "Queued on Server"
        DISPATCHED_TO_DEVICE = "dispatched_to_device", "Dispatched to Android Gateway"
        SUBMITTED = "submitted", "Accepted for Transmission (Not Yet Delivery-Confirmed)"
        DELIVERED = "delivered", "Carrier Delivery Confirmed"
        DELIVERY_UNKNOWN = "delivery_unknown", "Submitted — Carrier Delivery Report Unavailable"
        SIMULATED_SENT = "simulated_sent", "Simulated Sent (Sandbox)"
        SIMULATED_DELIVERED = "simulated_delivered", "Simulated Delivered (Sandbox)"
        SIMULATED_RECEIVED = "simulated_received", "Simulated Inbound (Sandbox)"
        RECEIVED = "received", "Received via SIM Gateway"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired Before Transmission"
        CANCELED = "canceled", "Canceled"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    contact = models.ForeignKey(
        "contacts.Contact",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="messages",
    )
    device = models.ForeignKey(
        "devices.Device",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="messages",
    )
    sender_identity = models.ForeignKey(
        SenderIdentityConfig,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="messages",
    )
    campaign = models.ForeignKey(
        "campaigns.BulkCampaign",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="messages",
    )
    triggered_by_rule = models.ForeignKey(
        "automation.AutoReplyRule",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_messages",
    )
    triggered_by_mode = models.ForeignKey(
        "automation.AutomationMode",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_messages",
    )
    in_reply_to = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="replies",
    )

    direction = models.CharField(max_length=12, choices=Direction.choices, db_index=True)
    transport_type = models.CharField(max_length=24, choices=TransportType.choices, db_index=True)
    is_simulation = models.BooleanField(default=False, db_index=True)

    sender_number = models.CharField(max_length=32, blank=True, default="", db_index=True)
    recipient_number = models.CharField(max_length=32, blank=True, default="", db_index=True)
    sim_slot = models.PositiveSmallIntegerField(null=True, blank=True)
    body = models.TextField()
    body_redacted = models.BooleanField(default=False)

    status = models.CharField(max_length=28, choices=Status.choices, db_index=True)
    external_message_id = models.CharField(max_length=128, blank=True, default="")
    matched_policy_summary = models.CharField(max_length=255, blank=True, default="")
    is_auto_reply = models.BooleanField(default=False)
    ai_generated = models.BooleanField(default=False)

    failure_code = models.CharField(max_length=64, blank=True, default="")
    failure_reason = models.CharField(max_length=255, blank=True, default="")

    scheduled_for = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    (Q(transport_type="simulation") & Q(is_simulation=True))
                    | (~Q(transport_type="simulation") & Q(is_simulation=False))
                ),
                name="chk_message_simulation_transport_match",
            ),
            models.CheckConstraint(
                condition=~(
                    Q(is_simulation=True)
                    & Q(status__in=["dispatched_to_device", "submitted", "delivered", "received"])
                ),
                name="chk_simulation_never_uses_real_carrier_status",
            ),
            models.CheckConstraint(
                condition=~(
                    Q(is_simulation=False)
                    & Q(status__in=["simulated_sent", "simulated_delivered", "simulated_received"])
                ),
                name="chk_real_transport_never_uses_simulated_status",
            ),
            models.UniqueConstraint(
                fields=["user", "device", "external_message_id"],
                condition=~Q(external_message_id=""),
                name="uniq_inbound_gateway_message_dedup",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "is_simulation", "-created_at"]),
            models.Index(fields=["device", "status", "expires_at"]),
            models.Index(fields=["user", "direction", "status"]),
        ]

    def __str__(self) -> str:
        prefix = "[SIMULATION] " if self.is_simulation else ""
        return f"{prefix}{self.direction} {self.sender_number}->{self.recipient_number} ({self.status})"


class MessageAttempt(TimeStampedUUIDModel):
    class AttemptStatus(models.TextChoices):
        CLAIMED = "claimed", "Claimed by Gateway"
        SUBMITTED = "submitted", "Accepted by Handset/Provider"
        FAILED = "failed", "Transmission Failed"
        EXPIRED = "expired", "Expired"
        SIMULATED = "simulated", "Simulated Execution"

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="attempts",
    )
    device = models.ForeignKey(
        "devices.Device",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="message_attempts",
    )
    attempt_number = models.PositiveSmallIntegerField(default=1)
    transport_type = models.CharField(max_length=24, choices=Message.TransportType.choices)
    sim_slot = models.PositiveSmallIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=AttemptStatus.choices, default=AttemptStatus.CLAIMED)
    claimed_at = models.DateTimeField(null=True, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    android_result_code = models.CharField(max_length=64, blank=True, default="")
    error_detail = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["attempt_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["message", "attempt_number"],
                name="uniq_message_attempt_number",
            )
        ]


class MessageDeliveryEvent(TimeStampedUUIDModel):
    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="delivery_events",
    )
    attempt = models.ForeignKey(
        MessageAttempt,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_events",
    )
    event_type = models.CharField(max_length=32)
    raw_status_code = models.CharField(max_length=64, blank=True, default="")
    description = models.CharField(max_length=255)
    is_simulation = models.BooleanField(default=False)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["occurred_at"]
