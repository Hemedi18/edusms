from __future__ import annotations

from datetime import UTC, datetime
import pyotp
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.crypto import sha256_hex
from apps.core.services import create_notification, record_audit_event
from .models import ActionToken, MFAConfig, User, UserSession
from .serializers import (
    LoginSerializer,
    RegisterSerializer,
    UserProfileSerializer,
    UserSessionSerializer,
    issue_action_token,
    issue_session_tokens,
)


class LoginRateThrottle(ScopedRateThrottle):
    scope = "auth_login"


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [LoginRateThrottle]

    @extend_schema(request=RegisterSerializer, responses={201: OpenApiTypes.OBJECT}, summary="Register new EduSMS account")
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        tokens = issue_session_tokens(user, request=request)
        record_audit_event(
            user=user,
            event_type="auth.registered",
            summary=f"Account registered for {user.email}",
            request=request,
        )
        create_notification(
            user=user,
            title="Welcome to EduSMS",
            body="Your workspace is ready in Simulation Mode. Pair an Android phone anytime to send real SIM SMS.",
            category="system",
            level="success",
            action_url="/devices",
        )
        return Response(
            {
                "user": UserProfileSerializer(user).data,
                **tokens,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [LoginRateThrottle]

    @extend_schema(request=LoginSerializer, responses={200: OpenApiTypes.OBJECT}, summary="Sign in with email, password & optional TOTP")
    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        tokens = issue_session_tokens(
            user,
            request=request,
            device_label=serializer.validated_data.get("device_label", ""),
        )
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        record_audit_event(
            user=user,
            event_type="auth.login",
            summary=f"User signed in ({tokens['session_id']})",
            request=request,
        )
        return Response(
            {
                "user": UserProfileSerializer(user).data,
                **tokens,
            },
            status=status.HTTP_200_OK,
        )


class RefreshSessionView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Rotate refresh token & issue new access token")
    @transaction.atomic
    def post(self, request):
        raw_refresh = request.data.get("refresh")
        if not raw_refresh:
            raise ValidationError({"refresh": "Refresh token is required."})
        try:
            old_token = RefreshToken(raw_refresh)
            old_jti = str(old_token["jti"])
            user_id = old_token["user_id"]
        except TokenError as exc:
            raise AuthenticationFailed("Invalid or expired refresh token.") from exc

        session = UserSession.objects.select_for_update().filter(refresh_jti=old_jti).first()
        if session and session.revoked_at is not None:
            raise AuthenticationFailed("This session has been revoked. Please sign in again.")

        user = User.objects.filter(id=user_id, is_active=True).first()
        if not user:
            raise AuthenticationFailed("Account is inactive or no longer exists.")

        try:
            old_token.blacklist()
        except Exception:
            pass

        new_refresh = RefreshToken.for_user(user)
        new_jti = str(new_refresh["jti"])
        new_exp = datetime.fromtimestamp(int(new_refresh["exp"]), tz=UTC)

        if session:
            session.refresh_jti = new_jti
            session.last_used_at = timezone.now()
            session.expires_at = new_exp
            session.save(update_fields=["refresh_jti", "last_used_at", "expires_at", "updated_at"])
        else:
            session = UserSession.objects.create(
                user=user,
                refresh_jti=new_jti,
                expires_at=new_exp,
            )

        return Response(
            {
                "access": str(new_refresh.access_token),
                "refresh": str(new_refresh),
                "session_id": str(session.id),
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Sign out & blacklist refresh token")
    def post(self, request):
        raw_refresh = request.data.get("refresh")
        if raw_refresh:
            try:
                token = RefreshToken(raw_refresh)
                jti = str(token["jti"])
                UserSession.objects.filter(user=request.user, refresh_jti=jti, revoked_at__isnull=True).update(
                    revoked_at=timezone.now()
                )
                token.blacklist()
            except TokenError:
                pass
        record_audit_event(
            user=request.user,
            event_type="auth.logout",
            summary="User signed out",
            request=request,
        )
        return Response({"status": "logged_out"}, status=status.HTTP_200_OK)


class CurrentUserProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        user = serializer.save()
        record_audit_event(
            user=user,
            event_type="account.profile_updated",
            summary="Account profile or settings updated",
            request=self.request,
        )


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Change account password")
    def post(self, request):
        current_password = request.data.get("current_password", "")
        new_password = request.data.get("new_password", "")
        if not request.user.check_password(current_password):
            raise ValidationError({"current_password": "Incorrect current password."})
        validate_password(new_password, user=request.user)
        request.user.set_password(new_password)
        request.user.save(update_fields=["password", "updated_at"])
        record_audit_event(
            user=request.user,
            event_type="auth.password_changed",
            summary="Password changed by user",
            request=request,
        )
        return Response({"status": "password_updated"})


class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Confirm email verification token")
    @transaction.atomic
    def post(self, request):
        raw_token = (request.data.get("token") or "").strip()
        if not raw_token:
            raise ValidationError({"token": "Verification token is required."})
        rec = ActionToken.objects.select_for_update().filter(
            purpose=ActionToken.Purpose.EMAIL_VERIFICATION,
            token_hash=sha256_hex(raw_token),
        ).first()
        if not rec or not rec.is_valid:
            raise ValidationError({"token": "Verification token is invalid or expired."})
        rec.used_at = timezone.now()
        rec.save(update_fields=["used_at", "updated_at"])
        rec.user.email_verified = True
        rec.user.save(update_fields=["email_verified", "updated_at"])
        record_audit_event(
            user=rec.user,
            event_type="auth.email_verified",
            summary="Email address verified",
            request=request,
        )
        return Response({"status": "email_verified"})


class ResendVerificationView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT}, summary="Resend email verification link")
    def post(self, request):
        if request.user.email_verified:
            return Response({"status": "already_verified"})
        raw_token = issue_action_token(request.user, ActionToken.Purpose.EMAIL_VERIFICATION, ttl_minutes=60 * 24)
        verify_url = f"{settings.PUBLIC_WEB_URL}/verify-email?token={raw_token}"
        send_mail(
            subject="Verify your EduSMS account",
            message=f"Verify your email: {verify_url}\nToken: {raw_token}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[request.user.email],
            fail_silently=True,
        )
        return Response({"status": "verification_sent"})


class PasswordResetRequestView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [LoginRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Request password reset email")
    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        user = User.objects.filter(email=email, is_active=True).first()
        if user:
            raw_token = issue_action_token(user, ActionToken.Purpose.PASSWORD_RESET, ttl_minutes=30)
            reset_url = f"{settings.PUBLIC_WEB_URL}/reset-password?token={raw_token}"
            send_mail(
                subject="Reset your EduSMS password",
                message=f"Reset link (valid 30 minutes): {reset_url}\nToken: {raw_token}",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
            record_audit_event(
                user=user,
                event_type="auth.password_reset_requested",
                summary="Password reset requested",
                request=request,
            )
        # Always return generic 200 to prevent account enumeration
        return Response(
            {"status": "if_account_exists_reset_instructions_sent"},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [LoginRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Confirm password reset token & set new password")
    @transaction.atomic
    def post(self, request):
        raw_token = (request.data.get("token") or "").strip()
        new_password = request.data.get("new_password") or ""
        if not raw_token or not new_password:
            raise ValidationError({"detail": "Both token and new_password are required."})
        rec = ActionToken.objects.select_for_update().filter(
            purpose=ActionToken.Purpose.PASSWORD_RESET,
            token_hash=sha256_hex(raw_token),
        ).first()
        if not rec or not rec.is_valid:
            raise ValidationError({"token": "Password reset token is invalid or expired."})
        validate_password(new_password, user=rec.user)
        rec.used_at = timezone.now()
        rec.save(update_fields=["used_at", "updated_at"])
        rec.user.set_password(new_password)
        rec.user.save(update_fields=["password", "updated_at"])
        UserSession.objects.filter(user=rec.user, revoked_at__isnull=True).update(revoked_at=timezone.now())
        record_audit_event(
            user=rec.user,
            event_type="auth.password_reset_completed",
            summary="Password reset completed; existing sessions revoked",
            request=request,
        )
        return Response({"status": "password_reset_complete"})


class SessionListView(generics.ListAPIView):
    queryset = UserSession.objects.none()
    serializer_class = UserSessionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return UserSession.objects.none()
        return UserSession.objects.filter(user=self.request.user, revoked_at__isnull=True)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["current_session_id"] = self.request.query_params.get("current_session_id")
        return ctx


class SessionRevokeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT}, summary="Revoke active login session")
    def post(self, request, pk):
        session = generics.get_object_or_404(UserSession, pk=pk, user=request.user)
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at", "updated_at"])
        record_audit_event(
            user=request.user,
            event_type="auth.session_revoked",
            summary=f"Revoked session {session.device_label}",
            request=request,
            target_type="UserSession",
            target_id=str(session.id),
        )
        return Response({"status": "revoked"})


class MFASetupView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT}, summary="Initiate TOTP MFA setup & provisioning URI")
    def post(self, request):
        secret = pyotp.random_base32()
        mfa, _ = MFAConfig.objects.get_or_create(user=request.user)
        mfa.set_secret(secret)
        mfa.is_enabled = False
        mfa.save()
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name=request.user.email, issuer_name="EduSMS")
        return Response({"secret": secret, "provisioning_uri": uri})


class MFAVerifyEnableView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Verify TOTP code, enable MFA & issue recovery codes")
    def post(self, request):
        code = (request.data.get("code") or "").strip()
        mfa = MFAConfig.objects.filter(user=request.user).first()
        if not mfa:
            raise ValidationError({"detail": "Initiate MFA setup first."})
        totp = pyotp.TOTP(mfa.get_secret())
        if not totp.verify(code, valid_window=1):
            raise ValidationError({"code": "Invalid authenticator verification code."})
        recovery_codes = mfa.generate_recovery_codes()
        mfa.is_enabled = True
        mfa.confirmed_at = timezone.now()
        mfa.save()
        record_audit_event(
            user=request.user,
            event_type="auth.mfa_enabled",
            summary="TOTP Multi-Factor Authentication enabled",
            request=request,
        )
        return Response({"status": "mfa_enabled", "recovery_codes": recovery_codes})


class MFADisableView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Disable TOTP MFA with password confirmation")
    def post(self, request):
        password = request.data.get("password") or ""
        if not request.user.check_password(password):
            raise ValidationError({"password": "Password confirmation is required to disable MFA."})
        MFAConfig.objects.filter(user=request.user).delete()
        record_audit_event(
            user=request.user,
            event_type="auth.mfa_disabled",
            summary="TOTP Multi-Factor Authentication disabled",
            request=request,
        )
        return Response({"status": "mfa_disabled"})


class AccountDataExportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: OpenApiTypes.OBJECT}, summary="Export full account JSON data archive")
    def get(self, request):
        user = request.user
        from apps.contacts.models import Contact, ContactGroup, SuppressionRecord
        from apps.devices.models import Device
        from apps.messaging.models import Message
        from apps.automation.models import AutoReplyRule, AutomationMode
        from apps.campaigns.models import BulkCampaign
        from apps.developers.models import WebhookEndpoint

        payload = {
            "exported_at": timezone.now().isoformat(),
            "account": UserProfileSerializer(user).data,
            "devices": list(
                Device.objects.filter(user=user).values(
                    "id", "name", "platform", "device_model", "is_enabled", "last_heartbeat_at", "revoked_at", "created_at"
                )
            ),
            "contacts": list(
                Contact.objects.filter(user=user).values(
                    "id", "name", "phone_number", "opt_in_status", "opt_out_status", "tags", "notes", "created_at"
                )
            ),
            "groups": list(ContactGroup.objects.filter(user=user).values("id", "name", "description", "created_at")),
            "suppressions": list(SuppressionRecord.objects.filter(user=user).values("phone_number", "reason", "created_at")),
            "messages": list(
                Message.objects.filter(user=user).values(
                    "id",
                    "direction",
                    "transport_type",
                    "is_simulation",
                    "sender_number",
                    "recipient_number",
                    "body",
                    "status",
                    "created_at",
                )[:2000]
            ),
            "automation_modes": list(AutomationMode.objects.filter(user=user).values("id", "name", "slug", "is_active")),
            "auto_reply_rules": list(AutoReplyRule.objects.filter(user=user).values("id", "name", "match_mode", "is_enabled")),
            "campaigns": list(BulkCampaign.objects.filter(user=user).values("id", "name", "status", "is_simulation", "created_at")),
            "webhooks": list(WebhookEndpoint.objects.filter(user=user).values("id", "name", "url", "events", "is_active")),
        }
        record_audit_event(
            user=user,
            event_type="account.data_exported",
            summary="User exported account data archive",
            request=request,
        )
        return Response(payload)


class AccountDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Permanently delete account & all data")
    @transaction.atomic
    def post(self, request):
        password = request.data.get("password") or ""
        confirmation = (request.data.get("confirmation") or "").strip()
        if not request.user.check_password(password):
            raise ValidationError({"password": "Incorrect password."})
        if confirmation != "DELETE":
            raise ValidationError({"confirmation": "Type DELETE to confirm permanent account deletion."})
        email = request.user.email
        request.user.delete()
        return Response({"status": "account_deleted", "email": email}, status=status.HTTP_200_OK)
