from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.crypto import mask_secret
from apps.core.services import (
    check_idempotency,
    extract_idempotency_key,
    record_audit_event,
    save_idempotency,
)
from apps.developers.permissions import HasAPIKeyScopeOrJWT
from .models import Message, MessageAttempt, MessageDeliveryEvent, SenderIdentityConfig
from .services import (
    _broadcast_message_update,
    _execute_external_provider_transport,
    _execute_simulation_transport,
    _log_delivery_event,
    inject_simulated_inbound_sms,
    reset_simulation_data,
    seed_simulation_demo_dataset,
    submit_outbound_message,
)


class MessageDeliveryEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageDeliveryEvent
        fields = ["id", "event_type", "raw_status_code", "description", "is_simulation", "occurred_at"]


class MessageAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageAttempt
        fields = [
            "id",
            "attempt_number",
            "device",
            "transport_type",
            "sim_slot",
            "status",
            "claimed_at",
            "acknowledged_at",
            "completed_at",
            "android_result_code",
            "error_detail",
        ]


class MessageSerializer(serializers.ModelSerializer):
    delivery_events = MessageDeliveryEventSerializer(many=True, read_only=True)
    attempts = MessageAttemptSerializer(many=True, read_only=True)
    contact_name = serializers.CharField(source="contact.name", read_only=True, default="")
    device_name = serializers.CharField(source="device.name", read_only=True, default="")

    class Meta:
        model = Message
        fields = [
            "id",
            "direction",
            "transport_type",
            "is_simulation",
            "sender_number",
            "recipient_number",
            "contact",
            "contact_name",
            "device",
            "device_name",
            "sender_identity",
            "campaign",
            "triggered_by_rule",
            "triggered_by_mode",
            "in_reply_to",
            "sim_slot",
            "body",
            "body_redacted",
            "status",
            "matched_policy_summary",
            "is_auto_reply",
            "ai_generated",
            "failure_code",
            "failure_reason",
            "scheduled_for",
            "expires_at",
            "submitted_at",
            "delivered_at",
            "received_at",
            "created_at",
            "attempts",
            "delivery_events",
        ]


class MessageCreateSerializer(serializers.Serializer):
    recipient_number = serializers.CharField(max_length=32)
    body = serializers.CharField(max_length=1600)
    transport_type = serializers.ChoiceField(
        choices=Message.TransportType.choices,
        default=Message.TransportType.SIMULATION,
    )
    device_id = serializers.UUIDField(required=False, allow_null=True)
    sim_slot = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=3)
    sender_identity_id = serializers.UUIDField(required=False, allow_null=True)
    simulated_outcome = serializers.ChoiceField(
        choices=["simulated_delivered", "simulated_sent", "failed", "delivery_unknown"],
        required=False,
        default="simulated_delivered",
    )
    ttl_minutes = serializers.IntegerField(required=False, default=120, min_value=1, max_value=10080)


class SenderIdentityConfigSerializer(serializers.ModelSerializer):
    provider_api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    masked_provider_api_key = serializers.SerializerMethodField()

    class Meta:
        model = SenderIdentityConfig
        fields = [
            "id",
            "label",
            "identity_type",
            "device",
            "sim_slot",
            "sim_phone_number_hint",
            "provider_name",
            "provider_base_url",
            "alphanumeric_sender_id",
            "country_code",
            "registration_status",
            "provider_api_key",
            "masked_provider_api_key",
            "is_enabled",
            "created_at",
        ]
        read_only_fields = ["id", "masked_provider_api_key", "created_at"]

    def get_masked_provider_api_key(self, obj: SenderIdentityConfig) -> str:
        if not obj.encrypted_provider_api_key:
            return ""
        try:
            return mask_secret(obj.get_provider_api_key())
        except Exception:
            return "••••••••"

    def validate(self, attrs):
        user = self.context["request"].user
        id_type = attrs.get("identity_type", getattr(self.instance, "identity_type", None))
        alpha = attrs.get("alphanumeric_sender_id", getattr(self.instance, "alphanumeric_sender_id", ""))
        device = attrs.get("device", getattr(self.instance, "device", None))

        if id_type == SenderIdentityConfig.IdentityType.SIM_SLOT:
            if alpha:
                raise serializers.ValidationError(
                    {
                        "alphanumeric_sender_id": (
                            "Physical SIM gateways transmit using the carrier-assigned SIM phone number and cannot set or spoof an alphanumeric sender ID."
                        )
                    }
                )
            if device and device.user_id != user.id:
                raise serializers.ValidationError({"device": "Selected device does not belong to your account."})
        elif id_type == SenderIdentityConfig.IdentityType.EXTERNAL_PROVIDER:
            if alpha and (len(alpha) > 11 or not alpha.replace(" ", "").isalnum()):
                raise serializers.ValidationError(
                    {"alphanumeric_sender_id": "Registered alphanumeric Sender IDs must be 1–11 alphanumeric characters."}
                )
        return attrs

    def create(self, validated_data):
        raw_key = validated_data.pop("provider_api_key", "")
        obj = SenderIdentityConfig(user=self.context["request"].user, **validated_data)
        if raw_key:
            obj.set_provider_api_key(raw_key)
        obj.save()
        return obj

    def update(self, instance, validated_data):
        raw_key = validated_data.pop("provider_api_key", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if raw_key is not None and raw_key != "":
            instance.set_provider_api_key(raw_key)
        instance.save()
        return instance


class MessageViewSet(viewsets.ModelViewSet):
    queryset = Message.objects.none()
    serializer_class = MessageSerializer
    permission_classes = [HasAPIKeyScopeOrJWT]
    required_scopes_by_method = {
        "GET": "messages:read",
        "POST": "messages:write",
    }
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = [
        "direction",
        "status",
        "transport_type",
        "is_simulation",
        "contact",
        "device",
        "is_auto_reply",
    ]
    search_fields = ["sender_number", "recipient_number", "body", "matched_policy_summary"]
    ordering_fields = ["created_at", "submitted_at", "delivered_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Message.objects.none()
        qs = (
            Message.objects.filter(user=self.request.user)
            .select_related("contact", "device")
            .prefetch_related("attempts", "delivery_events")
        )
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        return qs

    def create(self, request, *args, **kwargs):
        idem_key = extract_idempotency_key(request)
        cached_resp = check_idempotency(request.user, idem_key, "messages.create", request.data)
        if cached_resp is not None:
            return cached_resp

        in_ser = MessageCreateSerializer(data=request.data)
        in_ser.is_valid(raise_exception=True)
        d = in_ser.validated_data

        # Enforce simulation-only API key constraint if authenticated via a simulation-scoped key
        api_key = getattr(request, "api_key_record", None)
        if api_key and api_key.simulation_only and d["transport_type"] != Message.TransportType.SIMULATION:
            raise ValidationError(
                {"transport_type": "This API key is restricted to Simulation Mode (`edusms_sim_...`)."}
            )

        msg = submit_outbound_message(
            user=request.user,
            recipient_number=d["recipient_number"],
            body=d["body"],
            transport_type=d["transport_type"],
            device_id=str(d["device_id"]) if d.get("device_id") else None,
            sim_slot=d.get("sim_slot"),
            sender_identity_id=str(d["sender_identity_id"]) if d.get("sender_identity_id") else None,
            simulated_outcome=d.get("simulated_outcome", "simulated_delivered"),
            ttl_minutes=d.get("ttl_minutes", 120),
        )
        out_data = MessageSerializer(msg).data
        save_idempotency(request.user, idem_key, "messages.create", request.data, out_data, status.HTTP_201_CREATED)
        return Response(out_data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="status")
    def message_status(self, request, pk=None):
        msg = self.get_object()
        return Response(
            {
                "id": str(msg.id),
                "status": msg.status,
                "transport_type": msg.transport_type,
                "is_simulation": msg.is_simulation,
                "submitted_at": msg.submitted_at,
                "delivered_at": msg.delivered_at,
                "failure_code": msg.failure_code,
                "failure_reason": msg.failure_reason,
                "status_explanation": (
                    "Simulated sandbox status — no real carrier SMS sent."
                    if msg.is_simulation
                    else (
                        "Carrier delivery report confirmed."
                        if msg.status == Message.Status.DELIVERED
                        else (
                            "Accepted by handset/provider for transmission; carrier delivery confirmation has NOT arrived yet."
                            if msg.status == Message.Status.SUBMITTED
                            else f"Current state: {msg.get_status_display()}"
                        )
                    )
                ),
            }
        )

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def cancel(self, request, pk=None):
        msg = Message.objects.select_for_update().get(pk=self.get_object().pk)
        if msg.status not in {Message.Status.QUEUED, Message.Status.PENDING_APPROVAL}:
            raise ValidationError(
                {
                    "detail": (
                        f"Cannot cancel message in state '{msg.status}'. Only queued or pending-approval messages can be canceled before handset dispatch."
                    )
                }
            )
        msg.status = Message.Status.CANCELED
        msg.save(update_fields=["status", "updated_at"])
        _log_delivery_event(msg, "canceled", "Message canceled by user before transmission.")
        _broadcast_message_update(msg)
        return Response(MessageSerializer(msg).data)

    @action(detail=True, methods=["post"], url_path="approve-reply")
    @transaction.atomic
    def approve_reply(self, request, pk=None):
        msg = Message.objects.select_for_update().get(pk=self.get_object().pk)
        if msg.status != Message.Status.PENDING_APPROVAL:
            raise ValidationError({"detail": "Only messages in pending_approval state can be approved."})
        if msg.is_simulation:
            msg.status = Message.Status.SIMULATED_SENT
            msg.submitted_at = timezone.now()
            msg.save(update_fields=["status", "submitted_at", "updated_at"])
            _execute_simulation_transport(msg, simulated_outcome="simulated_delivered")
        elif msg.transport_type == Message.TransportType.EXTERNAL_PROVIDER and msg.sender_identity:
            msg.status = Message.Status.QUEUED
            msg.save(update_fields=["status", "updated_at"])
            _execute_external_provider_transport(msg, msg.sender_identity)
        else:
            msg.status = Message.Status.QUEUED
            msg.save(update_fields=["status", "updated_at"])
            _log_delivery_event(msg, "queued", "Human reviewer approved reply; queued for gateway dispatch.")
        _broadcast_message_update(msg)
        return Response(MessageSerializer(msg).data)


class SenderIdentityViewSet(viewsets.ModelViewSet):
    queryset = SenderIdentityConfig.objects.none()
    serializer_class = SenderIdentityConfigSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SenderIdentityConfig.objects.none()
        return SenderIdentityConfig.objects.filter(user=self.request.user)


class SimulationInjectInboundView(APIView):
    permission_classes = [HasAPIKeyScopeOrJWT]
    required_scopes_by_method = {"POST": "simulation:write"}

    @extend_schema(request=OpenApiTypes.OBJECT, responses={201: OpenApiTypes.OBJECT}, summary="Inject simulated inbound SMS")
    def post(self, request):
        sender = request.data.get("sender_number") or request.data.get("sender") or ""
        body = request.data.get("body") or request.data.get("text") or ""
        if not sender or not body:
            raise ValidationError({"detail": "Both sender_number and body are required."})
        res = inject_simulated_inbound_sms(user=request.user, sender_number=sender, body=body)
        return Response(res, status=status.HTTP_201_CREATED)


class SimulationSeedDemoView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT}, summary="Seed Simulation Lab demo dataset")
    def post(self, request):
        res = seed_simulation_demo_dataset(request.user)
        record_audit_event(
            user=request.user,
            event_type="simulation.seeded",
            summary="Seeded Simulation Mode demo dataset",
            request=request,
        )
        return Response(res, status=status.HTTP_200_OK)


class SimulationResetView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT}, summary="Reset Simulation Lab test data")
    def post(self, request):
        res = reset_simulation_data(request.user)
        record_audit_event(
            user=request.user,
            event_type="simulation.reset",
            summary="Reset Simulation Mode test data",
            request=request,
            metadata=res,
        )
        return Response(res, status=status.HTTP_200_OK)
