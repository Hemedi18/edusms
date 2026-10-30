from __future__ import annotations

import json
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.crypto import generate_prefixed_token, mask_secret, sha256_hex
from apps.core.services import record_audit_event
from apps.core.ssrf import SSRFBlockedError, validate_outbound_url
from .models import (
    APIKey,
    SUPPORTED_API_SCOPES,
    SUPPORTED_WEBHOOK_EVENTS,
    WebhookDeliveryAttempt,
    WebhookEndpoint,
    WebhookEvent,
)
from .services import (
    deliver_webhook_event,
    generate_webhook_signing_secret,
    verify_and_guard_webhook_replay,
)


class WebhookTestThrottle(ScopedRateThrottle):
    scope = "webhook_test"


class APIKeySerializer(serializers.ModelSerializer):
    is_active_key = serializers.BooleanField(read_only=True)

    class Meta:
        model = APIKey
        fields = [
            "id",
            "name",
            "key_prefix",
            "scopes",
            "simulation_only",
            "rate_limit_per_minute",
            "expires_at",
            "last_used_at",
            "revoked_at",
            "is_active_key",
            "created_at",
        ]
        read_only_fields = ["id", "key_prefix", "last_used_at", "revoked_at", "is_active_key", "created_at"]

    def validate_scopes(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("Select at least one API scope.")
        invalid = [s for s in value if s not in SUPPORTED_API_SCOPES]
        if invalid:
            raise serializers.ValidationError(f"Unsupported scopes: {invalid}. Supported: {SUPPORTED_API_SCOPES}")
        return sorted(set(value))


class WebhookEndpointSerializer(serializers.ModelSerializer):
    masked_signing_secret = serializers.SerializerMethodField()

    class Meta:
        model = WebhookEndpoint
        fields = [
            "id",
            "name",
            "url",
            "events",
            "include_simulation_events",
            "timeout_seconds",
            "is_active",
            "masked_signing_secret",
            "secret_rotated_at",
            "created_at",
        ]
        read_only_fields = ["id", "masked_signing_secret", "secret_rotated_at", "created_at"]

    def get_masked_signing_secret(self, obj: WebhookEndpoint) -> str:
        try:
            return mask_secret(obj.get_signing_secret())
        except Exception:
            return "••••••••"

    def validate_url(self, value: str) -> str:
        try:
            # Structural & literal IP SSRF check on save; DNS check also runs on every delivery
            return validate_outbound_url(
                value,
                require_https=settings.WEBHOOK_REQUIRE_HTTPS,
                resolve_dns=False,
            )
        except SSRFBlockedError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_events(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("Subscribe to at least one webhook event.")
        invalid = [e for e in value if e != "*" and e not in SUPPORTED_WEBHOOK_EVENTS]
        if invalid:
            raise serializers.ValidationError(f"Unsupported webhook events: {invalid}")
        return sorted(set(value))


class WebhookDeliveryAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebhookDeliveryAttempt
        fields = [
            "id",
            "attempt_number",
            "request_headers",
            "response_status_code",
            "response_body_preview",
            "latency_ms",
            "succeeded",
            "error_message",
            "created_at",
        ]


class WebhookEventSerializer(serializers.ModelSerializer):
    attempts = WebhookDeliveryAttemptSerializer(many=True, read_only=True)
    endpoint_name = serializers.CharField(source="endpoint.name", read_only=True, default="")
    endpoint_url = serializers.CharField(source="endpoint.url", read_only=True, default="")

    class Meta:
        model = WebhookEvent
        fields = [
            "id",
            "endpoint",
            "endpoint_name",
            "endpoint_url",
            "event_uid",
            "event_type",
            "is_simulation",
            "payload",
            "status",
            "attempt_count",
            "max_attempts",
            "next_retry_at",
            "delivered_at",
            "last_error",
            "created_at",
            "attempts",
        ]


class APIKeyViewSet(viewsets.ModelViewSet):
    queryset = APIKey.objects.none()
    serializer_class = APIKeySerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return APIKey.objects.none()
        return APIKey.objects.filter(user=self.request.user)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        sim_only = bool(ser.validated_data.get("simulation_only", False))
        prefix_kind = "edusms_sim" if sim_only else "edusms_live"
        raw_key = generate_prefixed_token(prefix_kind, 24)

        key_obj = APIKey.objects.create(
            user=request.user,
            name=ser.validated_data["name"],
            key_prefix=raw_key[:16],
            key_hash=sha256_hex(raw_key),
            scopes=ser.validated_data["scopes"],
            simulation_only=sim_only,
            rate_limit_per_minute=ser.validated_data.get("rate_limit_per_minute", 60),
            expires_at=ser.validated_data.get("expires_at"),
        )
        record_audit_event(
            user=request.user,
            event_type="developer.api_key_created",
            summary=f"Created API key '{key_obj.name}' ({key_obj.key_prefix}…)",
            request=request,
            target_type="APIKey",
            target_id=str(key_obj.id),
        )
        data = APIKeySerializer(key_obj).data
        # Raw key is returned ONLY ONCE at creation!
        data["raw_key"] = raw_key
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        key_obj = self.get_object()
        if key_obj.revoked_at is None:
            key_obj.revoked_at = timezone.now()
            key_obj.save(update_fields=["revoked_at", "updated_at"])
            record_audit_event(
                user=request.user,
                event_type="developer.api_key_revoked",
                summary=f"Revoked API key '{key_obj.name}'",
                request=request,
                target_type="APIKey",
                target_id=str(key_obj.id),
            )
        return Response(APIKeySerializer(key_obj).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def rotate(self, request, pk=None):
        old_key = self.get_object()
        old_key.revoked_at = timezone.now()
        old_key.save(update_fields=["revoked_at", "updated_at"])

        prefix_kind = "edusms_sim" if old_key.simulation_only else "edusms_live"
        raw_key = generate_prefixed_token(prefix_kind, 24)
        new_key = APIKey.objects.create(
            user=request.user,
            name=old_key.name,
            key_prefix=raw_key[:16],
            key_hash=sha256_hex(raw_key),
            scopes=list(old_key.scopes),
            simulation_only=old_key.simulation_only,
            rate_limit_per_minute=old_key.rate_limit_per_minute,
            expires_at=old_key.expires_at,
        )
        record_audit_event(
            user=request.user,
            event_type="developer.api_key_rotated",
            summary=f"Rotated API key '{new_key.name}'",
            request=request,
            target_type="APIKey",
            target_id=str(new_key.id),
        )
        data = APIKeySerializer(new_key).data
        data["raw_key"] = raw_key
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="capabilities")
    def capabilities(self, request):
        return Response(
            {
                "supported_scopes": SUPPORTED_API_SCOPES,
                "supported_webhook_events": SUPPORTED_WEBHOOK_EVENTS,
            }
        )


class WebhookEndpointViewSet(viewsets.ModelViewSet):
    queryset = WebhookEndpoint.objects.none()
    serializer_class = WebhookEndpointSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WebhookEndpoint.objects.none()
        return WebhookEndpoint.objects.filter(user=self.request.user)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        raw_secret = generate_webhook_signing_secret()
        endpoint = WebhookEndpoint(user=request.user, **ser.validated_data)
        endpoint.set_signing_secret(raw_secret)
        endpoint.save()
        record_audit_event(
            user=request.user,
            event_type="developer.webhook_created",
            summary=f"Created webhook endpoint '{endpoint.name}'",
            request=request,
            target_type="WebhookEndpoint",
            target_id=str(endpoint.id),
        )
        out = WebhookEndpointSerializer(endpoint).data
        out["signing_secret"] = raw_secret
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="rotate-secret")
    def rotate_secret(self, request, pk=None):
        endpoint = self.get_object()
        raw_secret = generate_webhook_signing_secret()
        endpoint.set_signing_secret(raw_secret)
        endpoint.secret_rotated_at = timezone.now()
        endpoint.save(update_fields=["encrypted_signing_secret", "secret_rotated_at", "updated_at"])
        record_audit_event(
            user=request.user,
            event_type="developer.webhook_secret_rotated",
            summary=f"Rotated signing secret for webhook '{endpoint.name}'",
            request=request,
            target_type="WebhookEndpoint",
            target_id=str(endpoint.id),
        )
        out = WebhookEndpointSerializer(endpoint).data
        out["signing_secret"] = raw_secret
        return Response(out)

    @action(detail=True, methods=["post"], throttle_classes=[WebhookTestThrottle])
    def test(self, request, pk=None):
        endpoint = self.get_object()
        uid = WebhookEvent.generate_uid()
        ev = WebhookEvent.objects.create(
            user=request.user,
            endpoint=endpoint,
            event_uid=uid,
            event_type="sms.received",
            is_simulation=True,
            payload={
                "id": uid,
                "type": "sms.received",
                "created_at": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "simulation": True,
                "data": {
                    "message_id": "msg_webhook_test",
                    "sender": "+255700000000",
                    "text": "Hello EduSMS (Webhook Verification Ping)",
                    "gateway_id": "simulation",
                    "simulation": True,
                },
            },
        )
        res = deliver_webhook_event(str(ev.id))
        ev.refresh_from_db()
        return Response({"delivery_result": res, "event": WebhookEventSerializer(ev).data})


class WebhookEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = WebhookEvent.objects.none()
    serializer_class = WebhookEventSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["status", "event_type", "endpoint", "is_simulation"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WebhookEvent.objects.none()
        return WebhookEvent.objects.filter(user=self.request.user).select_related("endpoint").prefetch_related("attempts")

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        ev = self.get_object()
        if ev.status == WebhookEvent.Status.DELIVERED:
            raise ValidationError({"detail": "This webhook event was already delivered."})
        ev.status = WebhookEvent.Status.PENDING
        ev.max_attempts = max(ev.max_attempts, ev.attempt_count + 1)
        ev.save(update_fields=["status", "max_attempts", "updated_at"])
        res = deliver_webhook_event(str(ev.id))
        ev.refresh_from_db()
        return Response({"delivery_result": res, "event": WebhookEventSerializer(ev).data})


class WebhookSignatureVerifyView(APIView):
    """Helper endpoint allowing developers to test signature & replay verification."""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Verify webhook HMAC signature & replay guard")
    def post(self, request):
        endpoint_id = request.data.get("endpoint_id")
        signature = request.data.get("signature") or ""
        event_uid = request.data.get("event_uid") or ""
        payload = request.data.get("payload")
        endpoint = generics.get_object_or_404(WebhookEndpoint, pk=endpoint_id, user=request.user)
        raw_body = (
            payload.encode("utf-8")
            if isinstance(payload, str)
            else json.dumps(payload or {}, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )
        ok, reason = verify_and_guard_webhook_replay(
            secret_value=endpoint.get_signing_secret(),
            signature_header=signature,
            event_uid=event_uid,
            raw_body=raw_body,
        )
        if not ok:
            return Response({"verified": False, "reason": reason}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"verified": True, "reason": reason})
