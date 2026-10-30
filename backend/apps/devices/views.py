from __future__ import annotations

import json
import secrets
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.crypto import generate_prefixed_token, sha256_hex
from apps.core.realtime import broadcast_account_event
from apps.core.services import create_notification, get_client_ip, record_audit_event
from .authentication import GatewayTokenAuthentication
from .models import Device, GatewaySession, PairingSession


class PairingRateThrottle(ScopedRateThrottle):
    scope = "pairing"


class GatewayRateThrottle(ScopedRateThrottle):
    scope = "gateway"


class DeviceSerializer(serializers.ModelSerializer):
    is_online = serializers.BooleanField(read_only=True)
    can_transmit_real_sms = serializers.BooleanField(read_only=True)
    pending_jobs_count = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = [
            "id",
            "name",
            "device_identity",
            "platform",
            "manufacturer",
            "device_model",
            "os_version",
            "app_version",
            "gateway_token_prefix",
            "is_enabled",
            "is_paused",
            "connection_status",
            "is_online",
            "can_transmit_real_sms",
            "sim_available",
            "sim_slots",
            "selected_sim_slot",
            "network_type",
            "carrier_name",
            "battery_level",
            "is_charging",
            "is_default_sms_app",
            "permissions_state",
            "incoming_message_count",
            "outgoing_message_count",
            "failed_transmission_count",
            "pending_jobs_count",
            "recent_events",
            "last_error",
            "recommended_action",
            "last_heartbeat_at",
            "last_synced_at",
            "revoked_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "device_identity",
            "platform",
            "gateway_token_prefix",
            "connection_status",
            "is_online",
            "can_transmit_real_sms",
            "incoming_message_count",
            "outgoing_message_count",
            "failed_transmission_count",
            "pending_jobs_count",
            "recent_events",
            "last_heartbeat_at",
            "last_synced_at",
            "revoked_at",
            "created_at",
        ]

    def get_pending_jobs_count(self, obj: Device) -> int:
        from apps.messaging.models import Message

        return Message.objects.filter(
            device=obj,
            is_simulation=False,
            status__in=[Message.Status.QUEUED, Message.Status.DISPATCHED_TO_DEVICE],
        ).count()


def _provision_paired_device(user, pairing: PairingSession, metadata: dict) -> tuple[Device, str]:
    raw_token = generate_prefixed_token("edugw", 28)
    platform = metadata.get("platform", Device.Platform.ANDROID)
    if platform not in {Device.Platform.ANDROID, Device.Platform.IOS}:
        platform = Device.Platform.ANDROID

    sim_slots = metadata.get("sim_slots") or []
    sim_available = bool(metadata.get("sim_available", len(sim_slots) > 0)) if platform == Device.Platform.ANDROID else False

    device = Device.objects.create(
        user=user,
        name=(metadata.get("device_name") or pairing.device_name_hint or "Android SIM Gateway")[:120],
        device_identity=(metadata.get("device_identity") or secrets.token_hex(12))[:128],
        platform=platform,
        manufacturer=(metadata.get("manufacturer") or "")[:80],
        device_model=(metadata.get("device_model") or "")[:80],
        os_version=(metadata.get("os_version") or "")[:40],
        app_version=(metadata.get("app_version") or "1.0.0")[:32],
        gateway_token_prefix=raw_token[:12],
        gateway_token_hash=sha256_hex(raw_token),
        connection_status=Device.ConnectionStatus.ONLINE,
        sim_available=sim_available,
        sim_slots=sim_slots,
        network_type=(metadata.get("network_type") or "")[:40],
        carrier_name=(metadata.get("carrier_name") or "")[:80],
        permissions_state=metadata.get("permissions_state") or {},
        is_default_sms_app=bool(metadata.get("is_default_sms_app", False)),
        last_heartbeat_at=timezone.now(),
        last_synced_at=timezone.now(),
    )
    device.append_event("device.paired", f"Paired via single-use session {str(pairing.id)[:8]}")
    device.save(update_fields=["recent_events"])

    pairing.status = PairingSession.Status.CONSUMED
    pairing.consumed_at = timezone.now()
    pairing.paired_device = device
    pairing.save(update_fields=["status", "consumed_at", "paired_device", "updated_at"])

    GatewaySession.objects.create(
        device=device,
        network_type=device.network_type,
        app_version=device.app_version,
    )
    return device, raw_token


class PairingInitView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [PairingRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={201: OpenApiTypes.OBJECT}, summary="Create single-use device pairing code & QR payload")
    def post(self, request):
        device_name = (request.data.get("device_name") or "Android SIM Gateway").strip()[:120]
        raw_code = PairingSession.generate_human_code()
        raw_qr_secret = secrets.token_urlsafe(18)
        ttl = timedelta(minutes=getattr(settings, "PAIRING_CODE_TTL_MINUTES", 10))
        expires_at = timezone.now() + ttl

        pairing = PairingSession.objects.create(
            user=request.user,
            device_name_hint=device_name,
            code_hash=sha256_hex(raw_code),
            qr_secret_hash=sha256_hex(raw_qr_secret),
            expires_at=expires_at,
        )

        # QR payload contains ONLY pairing bootstrap coordinates — never user JWTs or permanent credentials
        qr_payload = json.dumps(
            {
                "v": 1,
                "api_url": settings.PUBLIC_API_URL,
                "pairing_id": str(pairing.id),
                "code": raw_code,
                "qr_secret": raw_qr_secret,
                "expires_at": expires_at.isoformat(),
            }
        )
        record_audit_event(
            user=request.user,
            event_type="device.pairing_initiated",
            summary=f"Created short-lived pairing session for '{device_name}'",
            request=request,
            target_type="PairingSession",
            target_id=str(pairing.id),
        )
        return Response(
            {
                "pairing_id": str(pairing.id),
                "pairing_code": raw_code,
                "qr_payload": qr_payload,
                "device_name_hint": device_name,
                "expires_at": expires_at.isoformat(),
                "ttl_seconds": int(ttl.total_seconds()),
            },
            status=status.HTTP_201_CREATED,
        )


class PairingConfirmView(APIView):
    """
    Authenticated confirmation flow: user is signed in (e.g., on the Flutter mobile app)
    and submits the single-use pairing code or scanned QR payload to bind the handset.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [PairingRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={201: OpenApiTypes.OBJECT}, summary="Confirm single-use pairing code from handset")
    @transaction.atomic
    def post(self, request):
        raw_code = (request.data.get("pairing_code") or "").strip().upper()
        pairing_id = request.data.get("pairing_id")
        if not raw_code:
            raise ValidationError({"pairing_code": "Pairing code is required."})

        qs = PairingSession.objects.select_for_update().filter(
            user=request.user,
            code_hash=sha256_hex(raw_code),
        )
        if pairing_id:
            qs = qs.filter(id=pairing_id)
        pairing = qs.order_by("-created_at").first()

        if not pairing:
            raise ValidationError({"pairing_code": "Invalid pairing code for this account."})
        if pairing.status == PairingSession.Status.CONSUMED or pairing.consumed_at is not None:
            raise ValidationError({"pairing_code": "This pairing code has already been used."})
        if pairing.is_expired:
            pairing.status = PairingSession.Status.EXPIRED
            pairing.save(update_fields=["status", "updated_at"])
            raise ValidationError({"pairing_code": "This pairing code has expired. Generate a new code."})

        device, raw_gateway_token = _provision_paired_device(request.user, pairing, request.data)

        record_audit_event(
            user=request.user,
            event_type="device.paired",
            summary=f"Paired device '{device.name}' ({device.platform})",
            request=request,
            target_type="Device",
            target_id=str(device.id),
        )
        create_notification(
            user=request.user,
            title="Gateway Device Paired",
            body=f"{device.name} is now connected to your EduSMS account.",
            category="gateway",
            level="success",
            action_url="/devices",
        )
        broadcast_account_event(
            request.user.id,
            "device.status",
            {"device_id": str(device.id), "connection_status": device.connection_status, "is_online": True},
        )
        from apps.developers.services import emit_webhook_event

        emit_webhook_event(
            user=request.user,
            event_type="device.connected",
            data={"device_id": str(device.id), "device_name": device.name, "platform": device.platform},
        )

        return Response(
            {
                "device": DeviceSerializer(device).data,
                "gateway_token": raw_gateway_token,
            },
            status=status.HTTP_201_CREATED,
        )


class DeviceViewSet(viewsets.ModelViewSet):
    queryset = Device.objects.none()
    serializer_class = DeviceSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "delete", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Device.objects.none()
        qs = Device.objects.filter(user=self.request.user)
        include_revoked = self.request.query_params.get("include_revoked") == "true"
        if not include_revoked and self.action == "list":
            qs = qs.filter(revoked_at__isnull=True)
        return qs

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        device = self.get_object()
        if device.is_revoked:
            raise ValidationError({"detail": "Cannot pause a revoked device."})
        device.is_paused = True
        device.connection_status = Device.ConnectionStatus.PAUSED
        device.append_event("gateway.paused", "Gateway job processing paused by user.")
        device.save(update_fields=["is_paused", "connection_status", "recent_events", "updated_at"])
        broadcast_account_event(
            request.user.id,
            "device.status",
            {"device_id": str(device.id), "connection_status": device.connection_status, "is_paused": True},
        )
        return Response(DeviceSerializer(device).data)

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        device = self.get_object()
        if device.is_revoked:
            raise ValidationError({"detail": "Cannot resume a revoked device."})
        device.is_paused = False
        device.connection_status = Device.ConnectionStatus.ONLINE if device.is_online else Device.ConnectionStatus.OFFLINE
        device.append_event("gateway.resumed", "Gateway job processing resumed by user.")
        device.save(update_fields=["is_paused", "connection_status", "recent_events", "updated_at"])
        broadcast_account_event(
            request.user.id,
            "device.status",
            {"device_id": str(device.id), "connection_status": device.connection_status, "is_paused": False},
        )
        return Response(DeviceSerializer(device).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def revoke(self, request, pk=None):
        device = self.get_object()
        if not device.is_revoked:
            device.revoked_at = timezone.now()
            device.is_enabled = False
            device.connection_status = Device.ConnectionStatus.REVOKED
            device.append_event("device.revoked", "Device credentials permanently revoked.")
            device.save(
                update_fields=["revoked_at", "is_enabled", "connection_status", "recent_events", "updated_at"]
            )
            GatewaySession.objects.filter(device=device, ended_at__isnull=True).update(ended_at=timezone.now())
            # Re-queue any non-submitted jobs claimed by this revoked handset back to failed/canceled safety state
            from apps.messaging.models import Message

            Message.objects.filter(device=device, status=Message.Status.DISPATCHED_TO_DEVICE).update(
                status=Message.Status.FAILED,
                failure_reason="Paired device was revoked before handset confirmed transmission.",
            )
            record_audit_event(
                user=request.user,
                event_type="device.revoked",
                summary=f"Revoked gateway device '{device.name}'",
                request=request,
                target_type="Device",
                target_id=str(device.id),
            )
        return Response(DeviceSerializer(device).data)


# ==============================================================================
# Gateway-Authenticated Handset Endpoints (`X-Gateway-Token`)
# ==============================================================================


class GatewayHeartbeatView(APIView):
    authentication_classes = [GatewayTokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [GatewayRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Android SIM gateway heartbeat & telemetry sync")
    def post(self, request):
        device: Device = request.gateway_device
        was_online = device.connection_status == Device.ConnectionStatus.ONLINE

        now = timezone.now()
        if "sim_available" in request.data:
            device.sim_available = bool(request.data["sim_available"])
        if "sim_slots" in request.data and isinstance(request.data["sim_slots"], list):
            device.sim_slots = request.data["sim_slots"]
        if "network_type" in request.data:
            device.network_type = str(request.data["network_type"])[:40]
        if "carrier_name" in request.data:
            device.carrier_name = str(request.data["carrier_name"])[:80]
        if "battery_level" in request.data and request.data["battery_level"] is not None:
            device.battery_level = max(0, min(100, int(request.data["battery_level"])))
        if "is_charging" in request.data:
            device.is_charging = bool(request.data["is_charging"])
        if "is_default_sms_app" in request.data:
            device.is_default_sms_app = bool(request.data["is_default_sms_app"])
        if "permissions_state" in request.data and isinstance(request.data["permissions_state"], dict):
            device.permissions_state = request.data["permissions_state"]
        if "last_error" in request.data:
            device.last_error = str(request.data["last_error"])[:255]

        # Compute actionable recovery recommendation
        perms = device.permissions_state or {}
        if device.platform == Device.Platform.ANDROID:
            if perms and not perms.get("SEND_SMS", True):
                device.recommended_action = "Grant SEND_SMS permission in Android App Settings to enable outbound SIM messaging."
            elif not device.sim_available:
                device.recommended_action = "Insert an active SIM card with cellular service."
            else:
                device.recommended_action = ""

        device.last_heartbeat_at = now
        device.last_synced_at = now
        device.connection_status = (
            Device.ConnectionStatus.PAUSED if device.is_paused else Device.ConnectionStatus.ONLINE
        )
        device.save()

        active_session = GatewaySession.objects.filter(device=device, ended_at__isnull=True).first()
        if active_session:
            active_session.last_seen_at = now
            active_session.heartbeat_count += 1
            active_session.network_type = device.network_type
            active_session.save(update_fields=["last_seen_at", "heartbeat_count", "network_type", "updated_at"])
        else:
            GatewaySession.objects.create(
                device=device,
                ip_address=get_client_ip(request),
                network_type=device.network_type,
                app_version=device.app_version,
            )

        broadcast_account_event(
            device.user_id,
            "device.status",
            {
                "device_id": str(device.id),
                "connection_status": device.connection_status,
                "is_online": True,
                "sim_available": device.sim_available,
                "battery_level": device.battery_level,
            },
        )
        if not was_online and device.connection_status == Device.ConnectionStatus.ONLINE:
            from apps.developers.services import emit_webhook_event

            emit_webhook_event(
                user=device.user,
                event_type="device.connected",
                data={"device_id": str(device.id), "device_name": device.name},
            )

        from apps.messaging.models import Message

        pending_count = Message.objects.filter(
            device=device,
            is_simulation=False,
            status=Message.Status.QUEUED,
        ).count()

        return Response(
            {
                "status": "ok",
                "device_enabled": device.is_enabled,
                "device_paused": device.is_paused,
                "selected_sim_slot": device.selected_sim_slot,
                "pending_jobs_count": pending_count,
                "server_time": now.isoformat(),
            }
        )


class GatewayPollJobsView(APIView):
    authentication_classes = [GatewayTokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [GatewayRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Poll and atomically claim outbound SMS jobs")
    def post(self, request):
        device: Device = request.gateway_device
        if not device.is_enabled or device.is_paused:
            return Response({"jobs": [], "paused": device.is_paused, "enabled": device.is_enabled})
        if device.platform != Device.Platform.ANDROID:
            return Response({"jobs": [], "reason": "Only Android SIM gateways can poll physical SMS jobs."})

        limit = max(1, min(20, int(request.data.get("limit", 10))))
        from apps.messaging.services import claim_outbound_jobs_for_device

        jobs = claim_outbound_jobs_for_device(device=device, limit=limit)
        return Response({"jobs": jobs})


class GatewayAckJobView(APIView):
    authentication_classes = [GatewayTokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [GatewayRateThrottle]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT}, summary="Acknowledge claimed SMS job receipt on handset")
    def post(self, request, attempt_id):
        device: Device = request.gateway_device
        from apps.messaging.models import MessageAttempt

        attempt = generics.get_object_or_404(
            MessageAttempt,
            pk=attempt_id,
            device=device,
            message__is_simulation=False,
        )
        attempt.acknowledged_at = timezone.now()
        attempt.save(update_fields=["acknowledged_at", "updated_at"])
        return Response({"status": "acknowledged", "attempt_id": str(attempt.id)})


class GatewayInboundSyncView(APIView):
    authentication_classes = [GatewayTokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [GatewayRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Synchronize received SIM SMS messages with deduplication")
    def post(self, request):
        device: Device = request.gateway_device
        if not device.is_enabled:
            raise PermissionDenied("Gateway device is currently disabled by account owner.")

        events = request.data.get("messages")
        if events is None:
            # Support single event payload as well as batched offline sync array
            events = [request.data]

        from apps.messaging.services import ingest_gateway_inbound_sms

        results = []
        for item in events[:50]:
            res = ingest_gateway_inbound_sms(device=device, payload=item)
            results.append(res)
        return Response({"processed": len(results), "results": results}, status=status.HTTP_200_OK)


class GatewayStatusCallbackView(APIView):
    authentication_classes = [GatewayTokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [GatewayRateThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Report Android SENT or carrier DELIVERED radio callback")
    def post(self, request):
        device: Device = request.gateway_device
        from apps.messaging.services import process_gateway_status_callback

        result = process_gateway_status_callback(device=device, payload=request.data)
        return Response(result, status=status.HTTP_200_OK)
