from __future__ import annotations

import secrets
from datetime import UTC, timedelta
import pyotp
from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.crypto import sha256_hex
from apps.core.services import get_client_ip, record_audit_event
from .models import ActionToken, MFAConfig, User, UserSession


def issue_session_tokens(user: User, request=None, device_label: str = "") -> dict:
    refresh = RefreshToken.for_user(user)
    jti = str(refresh["jti"])
    exp_ts = int(refresh["exp"])
    expires_at = timezone.datetime.fromtimestamp(exp_ts, tz=UTC)

    ua = (request.META.get("HTTP_USER_AGENT", "")[:255]) if request else ""
    label = device_label or ("EduSMS Mobile" if "dart" in ua.lower() or "flutter" in ua.lower() else "Web Dashboard")

    session = UserSession.objects.create(
        user=user,
        refresh_jti=jti,
        device_label=label[:120],
        ip_address=get_client_ip(request),
        user_agent=ua,
        expires_at=expires_at,
    )
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "session_id": str(session.id),
    }


def issue_action_token(user: User, purpose: str, ttl_minutes: int = 30) -> str:
    raw = secrets.token_urlsafe(24)
    ActionToken.objects.create(
        user=user,
        purpose=purpose,
        token_hash=sha256_hex(raw),
        expires_at=timezone.now() + timedelta(minutes=ttl_minutes),
    )
    return raw


class UserProfileSerializer(serializers.ModelSerializer):
    mfa_enabled = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "organization",
            "timezone",
            "default_country_code",
            "theme_preference",
            "email_verified",
            "onboarding_completed",
            "global_automation_enabled",
            "global_ai_enabled",
            "default_execution_mode",
            "message_retention_days",
            "store_inbound_message_body",
            "require_consent_for_campaigns",
            "daily_real_sms_limit",
            "mfa_enabled",
            "created_at",
        ]
        read_only_fields = ["id", "email", "email_verified", "mfa_enabled", "created_at"]

    def get_mfa_enabled(self, obj: User) -> bool:
        mfa = getattr(obj, "mfa_config", None)
        return bool(mfa and mfa.is_enabled)


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=150)
    organization = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    password = serializers.CharField(write_only=True, min_length=10)
    timezone = serializers.CharField(max_length=64, required=False, default="Africa/Dar_es_Salaam")
    default_country_code = serializers.CharField(max_length=4, required=False, default="TZ")

    def validate_email(self, value: str) -> str:
        norm = value.strip().lower()
        if User.objects.filter(email=norm).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return norm

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def validate_timezone(self, value: str) -> str:
        from .models import validate_iana_timezone

        validate_iana_timezone(value)
        return value

    @transaction.atomic
    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User.objects.create_user(password=password, **validated_data)

        # Provision built-in automation modes for the new user
        from apps.automation.services import ensure_builtin_modes_for_user

        ensure_builtin_modes_for_user(user)

        # Send email verification link
        raw_token = issue_action_token(user, ActionToken.Purpose.EMAIL_VERIFICATION, ttl_minutes=60 * 24)
        verify_url = f"{settings.PUBLIC_WEB_URL}/verify-email?token={raw_token}"
        send_mail(
            subject="Verify your EduSMS account",
            message=f"Welcome to EduSMS, {user.full_name}!\n\nVerify your email: {verify_url}\nToken: {raw_token}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=True,
        )
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    mfa_code = serializers.CharField(write_only=True, required=False, allow_blank=True)
    device_label = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        email = attrs["email"].strip().lower()
        password = attrs["password"]
        user = authenticate(request=self.context.get("request"), username=email, password=password)
        if not user:
            record_audit_event(
                user=User.objects.filter(email=email).first(),
                event_type="auth.login_failed",
                summary=f"Failed login attempt for {email}",
                request=self.context.get("request"),
            )
            raise serializers.ValidationError({"detail": "Invalid email or password."})
        if not user.is_active:
            raise serializers.ValidationError({"detail": "This account is disabled."})

        mfa = getattr(user, "mfa_config", None)
        if mfa and mfa.is_enabled:
            code = (attrs.get("mfa_code") or "").strip().upper()
            if not code:
                raise serializers.ValidationError(
                    {"mfa_required": "Multi-factor authentication code is required."}
                )
            totp = pyotp.TOTP(mfa.get_secret())
            code_hash = sha256_hex(code)
            if totp.verify(code, valid_window=1):
                pass
            elif code_hash in (mfa.recovery_code_hashes or []):
                mfa.recovery_code_hashes = [h for h in mfa.recovery_code_hashes if h != code_hash]
                mfa.save(update_fields=["recovery_code_hashes", "updated_at"])
            else:
                raise serializers.ValidationError({"mfa_code": "Invalid MFA or recovery code."})

        attrs["user"] = user
        return attrs


class UserSessionSerializer(serializers.ModelSerializer):
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = UserSession
        fields = [
            "id",
            "device_label",
            "ip_address",
            "user_agent",
            "last_used_at",
            "expires_at",
            "revoked_at",
            "created_at",
            "is_current",
        ]

    def get_is_current(self, obj: UserSession) -> bool:
        current_id = self.context.get("current_session_id")
        return bool(current_id and str(obj.id) == str(current_id))
