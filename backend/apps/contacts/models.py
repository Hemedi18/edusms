from __future__ import annotations

from django.conf import settings
from django.db import models
from apps.core.models import TimeStampedUUIDModel


class Contact(TimeStampedUUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contacts",
    )
    name = models.CharField(max_length=160)
    phone_number = models.CharField(max_length=24, db_index=True)
    raw_phone_input = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    is_virtual = models.BooleanField(
        default=False,
        help_text="Marks virtual recipients created specifically for Simulation Mode testing.",
    )

    # Per-contact policy controls (nullable booleans allow inheriting from group/global defaults)
    allow_outgoing = models.BooleanField(default=True)
    allow_auto_reply = models.BooleanField(null=True, blank=True, default=None)
    allow_ai_reply = models.BooleanField(null=True, blank=True, default=None)
    automation_mode = models.ForeignKey(
        "automation.AutomationMode",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_contacts",
    )
    quiet_hours_start = models.TimeField(null=True, blank=True)
    quiet_hours_end = models.TimeField(null=True, blank=True)
    cooldown_minutes = models.PositiveIntegerField(null=True, blank=True)

    # Consent & Opt-out state
    opt_in_status = models.BooleanField(default=False)
    opt_in_at = models.DateTimeField(null=True, blank=True)
    opt_out_status = models.BooleanField(default=False, db_index=True)
    opt_out_at = models.DateTimeField(null=True, blank=True)

    tags = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, default="")

    groups = models.ManyToManyField(
        "ContactGroup",
        through="GroupMembership",
        related_name="contacts",
    )

    class Meta:
        ordering = ["name", "phone_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "phone_number"],
                name="uniq_contact_user_phone",
            )
        ]
        indexes = [
            models.Index(fields=["user", "opt_out_status"]),
            models.Index(fields=["user", "name"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone_number})"


class ContactGroup(TimeStampedUUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contact_groups",
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    color = models.CharField(max_length=16, default="#7C3AED")

    # Group policy defaults
    allow_outgoing = models.BooleanField(default=True)
    allow_auto_reply = models.BooleanField(default=True)
    allow_ai_reply = models.BooleanField(default=False)
    automation_mode = models.ForeignKey(
        "automation.AutomationMode",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_groups",
    )
    quiet_hours_start = models.TimeField(null=True, blank=True)
    quiet_hours_end = models.TimeField(null=True, blank=True)
    cooldown_minutes = models.PositiveIntegerField(default=15)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"],
                name="uniq_contact_group_user_name",
            )
        ]

    def __str__(self) -> str:
        return self.name


class GroupMembership(TimeStampedUUIDModel):
    contact = models.ForeignKey(
        Contact,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    group = models.ForeignKey(
        ContactGroup,
        on_delete=models.CASCADE,
        related_name="memberships",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["contact", "group"],
                name="uniq_group_membership_contact_group",
            )
        ]
        indexes = [
            models.Index(fields=["group", "contact"]),
        ]


class ConsentRecord(TimeStampedUUIDModel):
    class Action(models.TextChoices):
        OPT_IN = "opt_in", "Opt-In"
        OPT_OUT = "opt_out", "Opt-Out"

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual Dashboard/App Action"
        CSV_IMPORT = "csv_import", "Authorized CSV Import"
        ANDROID_PICKER = "android_picker", "Android Contact Picker"
        INBOUND_KEYWORD = "inbound_keyword", "Inbound SMS Keyword (STOP/START)"
        API = "api", "Developer API"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="consent_records",
    )
    contact = models.ForeignKey(
        Contact,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="consent_records",
    )
    phone_number = models.CharField(max_length=24, db_index=True)
    action = models.CharField(max_length=16, choices=Action.choices)
    source = models.CharField(max_length=24, choices=Source.choices, default=Source.MANUAL)
    evidence_note = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "phone_number", "-created_at"]),
        ]


class SuppressionRecord(TimeStampedUUIDModel):
    class Reason(models.TextChoices):
        OPT_OUT = "opt_out", "Recipient Opted Out"
        MANUAL_BLOCK = "manual_block", "Manual Suppression"
        INVALID_NUMBER = "invalid_number", "Invalid Destination Number"
        CARRIER_BOUNCE = "carrier_bounce", "Permanent Carrier Failure"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="suppression_records",
    )
    phone_number = models.CharField(max_length=24, db_index=True)
    reason = models.CharField(max_length=32, choices=Reason.choices, default=Reason.OPT_OUT)
    notes = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "phone_number"],
                name="uniq_suppression_user_phone",
            )
        ]
