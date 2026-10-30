from __future__ import annotations

import secrets
import uuid
from zoneinfo import available_timezones

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.crypto import decrypt_secret, encrypt_secret, sha256_hex
from apps.core.models import TimeStampedUUIDModel


VALID_TIMEZONES = available_timezones()


def validate_iana_timezone(value: str) -> None:
    if value not in VALID_TIMEZONES:
        raise ValidationError(f"'{value}' is not a valid IANA time zone.")


class UserManager(BaseUserManager):
    def create_user(self, email: str, password: str | None = None, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")
        normalized = self.normalize_email(email).strip().lower()
        user = self.model(email=normalized, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("email_verified", True)
        return self.create_user(email=email, password=password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class ThemePreference(models.TextChoices):
        SYSTEM = "system", "System"
        DARK = "dark", "Dark"
        LIGHT = "light", "Light"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, db_index=True)
    full_name = models.CharField(max_length=150)
    organization = models.CharField(max_length=150, blank=True, default="")
    timezone = models.CharField(
        max_length=64,
        default="Africa/Dar_es_Salaam",
        validators=[validate_iana_timezone],
    )
    default_country_code = models.CharField(max_length=4, default="TZ")
    theme_preference = models.CharField(
        max_length=16,
        choices=ThemePreference.choices,
        default=ThemePreference.SYSTEM,
    )

    # Account state
    email_verified = models.BooleanField(default=False)
    onboarding_completed = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    # Global automation, safety & privacy settings
    global_automation_enabled = models.BooleanField(default=True)
    global_ai_enabled = models.BooleanField(default=False)
    default_execution_mode = models.CharField(
        max_length=16,
        choices=[("simulation", "Simulation"), ("sim_gateway", "Real SIM Gateway")],
        default="simulation",
    )
    message_retention_days = models.PositiveIntegerField(default=90)
    store_inbound_message_body = models.BooleanField(default=True)
    require_consent_for_campaigns = models.BooleanField(default=True)
    daily_real_sms_limit = models.PositiveIntegerField(default=500)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.email


class UserSession(TimeStampedUUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sessions",
    )
    refresh_jti = models.CharField(max_length=64, unique=True, db_index=True)
    device_label = models.CharField(max_length=120, blank=True, default="Web Browser")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True, default="")
    last_used_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_used_at"]
        indexes = [
            models.Index(fields=["user", "revoked_at", "-last_used_at"]),
        ]

    @property
    def is_active_session(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()


class MFAConfig(TimeStampedUUIDModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mfa_config",
    )
    encrypted_totp_secret = models.TextField()
    is_enabled = models.BooleanField(default=False)
    recovery_code_hashes = models.JSONField(default=list, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    def set_secret(self, raw_secret: str) -> None:
        self.encrypted_totp_secret = encrypt_secret(raw_secret)

    def get_secret(self) -> str:
        return decrypt_secret(self.encrypted_totp_secret)

    def generate_recovery_codes(self, count: int = 8) -> list[str]:
        raw_codes = [secrets.token_hex(4).upper() for _ in range(count)]
        self.recovery_code_hashes = [sha256_hex(code) for code in raw_codes]
        return raw_codes


class ActionToken(TimeStampedUUIDModel):
    class Purpose(models.TextChoices):
        EMAIL_VERIFICATION = "email_verification", "Email Verification"
        PASSWORD_RESET = "password_reset", "Password Reset"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="action_tokens",
    )
    purpose = models.CharField(max_length=32, choices=Purpose.choices)
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "purpose", "used_at"]),
        ]

    @property
    def is_valid(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()
