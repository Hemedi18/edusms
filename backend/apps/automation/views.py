from __future__ import annotations

import re
from django.db import transaction
from django.utils.text import slugify
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.crypto import mask_secret
from apps.core.realtime import broadcast_account_event
from apps.core.services import record_audit_event
from .ai_adapters import generate_ai_reply, test_ai_provider_connectivity
from .models import AICallLog, AIProviderConfig, AutoReplyRule, AutomationMode, ScheduleWindow
from .services import (
    ensure_builtin_modes_for_user,
    is_schedule_active,
    preview_auto_responder,
)


class ScheduleWindowSerializer(serializers.ModelSerializer):
    is_currently_active = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleWindow
        fields = [
            "id",
            "name",
            "timezone",
            "days_of_week",
            "start_time",
            "end_time",
            "effective_from",
            "effective_until",
            "is_currently_active",
            "created_at",
        ]
        read_only_fields = ["id", "is_currently_active", "created_at"]

    def validate_days_of_week(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("days_of_week must be a list of weekday integers (0=Mon..6=Sun).")
        for d in value:
            if not isinstance(d, int) or d < 0 or d > 6:
                raise serializers.ValidationError("Each day in days_of_week must be an integer between 0 and 6.")
        return sorted(set(value))

    def validate(self, attrs):
        eff_from = attrs.get("effective_from")
        eff_until = attrs.get("effective_until")
        if eff_from and eff_until and eff_until < eff_from:
            raise serializers.ValidationError({"effective_until": "effective_until cannot be earlier than effective_from."})
        return attrs

    def get_is_currently_active(self, obj: ScheduleWindow) -> bool:
        ok, _ = is_schedule_active(obj)
        return ok


class AIProviderConfigSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    masked_api_key = serializers.SerializerMethodField()
    has_api_key = serializers.SerializerMethodField()

    class Meta:
        model = AIProviderConfig
        fields = [
            "id",
            "name",
            "provider_type",
            "api_base_url",
            "api_key",
            "masked_api_key",
            "has_api_key",
            "model_name",
            "temperature",
            "max_output_tokens",
            "max_response_chars",
            "timeout_seconds",
            "max_retries",
            "is_enabled",
            "simulate_failure",
            "system_instructions",
            "fallback_message",
            "last_tested_at",
            "last_test_status",
            "last_error",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "masked_api_key",
            "has_api_key",
            "last_tested_at",
            "last_test_status",
            "last_error",
            "created_at",
        ]

    def get_masked_api_key(self, obj: AIProviderConfig) -> str:
        if not obj.encrypted_api_key:
            return ""
        try:
            return mask_secret(obj.get_api_key())
        except Exception:
            return "••••••••"

    def get_has_api_key(self, obj: AIProviderConfig) -> bool:
        return bool(obj.encrypted_api_key)

    def create(self, validated_data):
        raw_key = validated_data.pop("api_key", "")
        provider = AIProviderConfig(user=self.context["request"].user, **validated_data)
        if raw_key:
            provider.set_api_key(raw_key)
        provider.save()
        return provider

    def update(self, instance: AIProviderConfig, validated_data):
        raw_key = validated_data.pop("api_key", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if raw_key is not None and raw_key != "":
            instance.set_api_key(raw_key)
        instance.save()
        return instance


class AICallLogSerializer(serializers.ModelSerializer):
    provider_name = serializers.CharField(source="provider.name", read_only=True, default="")

    class Meta:
        model = AICallLog
        fields = [
            "id",
            "provider",
            "provider_name",
            "inbound_message",
            "model_name",
            "status",
            "latency_ms",
            "prompt_chars",
            "response_chars",
            "response_preview",
            "error_message",
            "is_test",
            "created_at",
        ]


class AutomationModeSerializer(serializers.ModelSerializer):
    schedule_details = ScheduleWindowSerializer(source="schedule", read_only=True)

    class Meta:
        model = AutomationMode
        fields = [
            "id",
            "name",
            "slug",
            "is_builtin",
            "description",
            "icon",
            "is_enabled",
            "is_active",
            "priority",
            "response_method",
            "response_template",
            "ai_provider",
            "ai_override_instructions",
            "schedule",
            "schedule_details",
            "selected_groups",
            "allowed_contacts",
            "blocked_contacts",
            "cooldown_minutes",
            "max_replies_per_sender_per_day",
            "require_human_approval",
            "fallback_behavior",
            "fallback_text",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "slug", "is_builtin", "schedule_details", "created_at", "updated_at"]

    def validate(self, attrs):
        user = self.context["request"].user
        if attrs.get("ai_provider") and attrs["ai_provider"].user_id != user.id:
            raise serializers.ValidationError({"ai_provider": "Invalid AI provider for this account."})
        if attrs.get("schedule") and attrs["schedule"].user_id != user.id:
            raise serializers.ValidationError({"schedule": "Invalid schedule window for this account."})
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        base_slug = slugify(validated_data["name"])[:32] or "custom-mode"
        slug = base_slug
        idx = 2
        while AutomationMode.objects.filter(user=user, slug=slug).exists():
            slug = f"{base_slug}-{idx}"
            idx += 1
        validated_data["slug"] = slug
        validated_data["user"] = user
        return super().create(validated_data)


class AutoReplyRuleSerializer(serializers.ModelSerializer):
    schedule_details = ScheduleWindowSerializer(source="schedule", read_only=True)

    class Meta:
        model = AutoReplyRule
        fields = [
            "id",
            "name",
            "is_enabled",
            "match_mode",
            "keywords",
            "case_sensitive",
            "allowed_senders",
            "restricted_contacts",
            "restricted_groups",
            "apply_in_modes",
            "schedule",
            "schedule_details",
            "response_template",
            "custom_variables",
            "priority",
            "cooldown_minutes",
            "max_responses_per_day",
            "require_human_approval",
            "expires_at",
            "hit_count",
            "last_triggered_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "hit_count", "last_triggered_at", "schedule_details", "created_at", "updated_at"]

    def validate_keywords(self, value):
        if not isinstance(value, list) or not [v for v in value if str(v).strip()]:
            raise serializers.ValidationError("At least one keyword or matching pattern is required.")
        return [str(v).strip() for v in value if str(v).strip()]

    def validate(self, attrs):
        match_mode = attrs.get("match_mode", getattr(self.instance, "match_mode", AutoReplyRule.MatchMode.CONTAINS))
        keywords = attrs.get("keywords", getattr(self.instance, "keywords", []))
        if match_mode == AutoReplyRule.MatchMode.REGEX:
            for pat in keywords:
                if len(pat) > 250:
                    raise serializers.ValidationError({"keywords": "Regex pattern exceeds 250 characters."})
                try:
                    re.compile(pat)
                except re.error as exc:
                    raise serializers.ValidationError({"keywords": f"Invalid regular expression '{pat}': {exc}"}) from exc
        return attrs


class ScheduleWindowViewSet(viewsets.ModelViewSet):
    queryset = ScheduleWindow.objects.none()
    serializer_class = ScheduleWindowSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ScheduleWindow.objects.none()
        return ScheduleWindow.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class AutomationModeViewSet(viewsets.ModelViewSet):
    queryset = AutomationMode.objects.none()
    serializer_class = AutomationModeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AutomationMode.objects.none()
        ensure_builtin_modes_for_user(self.request.user)
        return AutomationMode.objects.filter(user=self.request.user).select_related("schedule")

    def perform_destroy(self, instance: AutomationMode):
        if instance.is_builtin:
            raise ValidationError({"detail": "Built-in modes cannot be deleted; edit or disable them instead."})
        instance.delete()

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def activate(self, request, pk=None):
        mode = self.get_object()
        AutomationMode.objects.filter(user=request.user).update(is_active=False)
        mode.is_active = True
        mode.is_enabled = True
        mode.save(update_fields=["is_active", "is_enabled", "updated_at"])

        broadcast_account_event(
            request.user.id,
            "automation.mode_changed",
            {"mode_id": str(mode.id), "mode_name": mode.name, "slug": mode.slug},
        )
        from apps.developers.services import emit_webhook_event

        emit_webhook_event(
            user=request.user,
            event_type="automation.mode_changed",
            data={"mode_id": str(mode.id), "mode_name": mode.name, "slug": mode.slug},
        )
        record_audit_event(
            user=request.user,
            event_type="automation.mode_activated",
            summary=f"Activated automation mode '{mode.name}'",
            request=request,
        )
        return Response(AutomationModeSerializer(mode).data)


class AutoReplyRuleViewSet(viewsets.ModelViewSet):
    queryset = AutoReplyRule.objects.none()
    serializer_class = AutoReplyRuleSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["is_enabled", "match_mode"]
    search_fields = ["name", "response_template"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AutoReplyRule.objects.none()
        return AutoReplyRule.objects.filter(user=self.request.user).select_related("schedule")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        orig = self.get_object()
        copy = AutoReplyRule.objects.create(
            user=request.user,
            name=f"{orig.name} (Copy)"[:120],
            is_enabled=False,
            match_mode=orig.match_mode,
            keywords=list(orig.keywords),
            case_sensitive=orig.case_sensitive,
            allowed_senders=list(orig.allowed_senders),
            schedule=orig.schedule,
            response_template=orig.response_template,
            custom_variables=dict(orig.custom_variables),
            priority=orig.priority,
            cooldown_minutes=orig.cooldown_minutes,
            max_responses_per_day=orig.max_responses_per_day,
            require_human_approval=orig.require_human_approval,
        )
        copy.restricted_contacts.set(orig.restricted_contacts.all())
        copy.restricted_groups.set(orig.restricted_groups.all())
        copy.apply_in_modes.set(orig.apply_in_modes.all())
        return Response(AutoReplyRuleSerializer(copy).data, status=status.HTTP_201_CREATED)


class RulePreviewTestView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Dry-run test auto-responder rule & policy evaluation")
    def post(self, request):
        sender = request.data.get("sender_number") or "+255754100201"
        body = request.data.get("body") or ""
        if not body.strip():
            raise ValidationError({"body": "Sample incoming message text is required."})
        return Response(preview_auto_responder(user=request.user, sender_number=sender, body=body))


class ScheduleValidateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=ScheduleWindowSerializer, responses={200: OpenApiTypes.OBJECT}, summary="Validate schedule window & evaluate active state")
    def post(self, request):
        ser = ScheduleWindowSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        temp = ScheduleWindow(user=request.user, **ser.validated_data)
        active, reason = is_schedule_active(temp)
        return Response({"valid": True, "currently_active": active, "evaluation_summary": reason})


class AIProviderConfigViewSet(viewsets.ModelViewSet):
    queryset = AIProviderConfig.objects.none()
    serializer_class = AIProviderConfigSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AIProviderConfig.objects.none()
        return AIProviderConfig.objects.filter(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="test-connection")
    def test_connection(self, request, pk=None):
        provider = self.get_object()
        res = test_ai_provider_connectivity(provider)
        provider.refresh_from_db()
        return Response(
            {
                "test_result": res,
                "provider": AIProviderConfigSerializer(provider).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="test-prompt")
    def test_prompt(self, request, pk=None):
        provider = self.get_object()
        prompt_text = (request.data.get("prompt") or request.data.get("body") or "").strip()
        if not prompt_text:
            raise ValidationError({"prompt": "Test message prompt is required."})
        res = generate_ai_reply(
            provider=provider,
            inbound_text=prompt_text,
            sender_name=request.data.get("sender_name", "Test Student"),
            mode_instructions=request.data.get("instructions_override", ""),
            is_test=True,
        )
        return Response(res)

    @action(detail=False, methods=["get"], url_path="supported-models")
    def supported_models(self, request):
        return Response(
            {
                "openai_compatible": ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "llama-3.3-70b-versatile"],
                "gemini": ["gemini-2.5-flash", "gemini-2.5-pro"],
                "deterministic_mock": ["edusms-mock-v1"],
            }
        )


class AICallLogListView(generics.ListAPIView):
    queryset = AICallLog.objects.none()
    serializer_class = AICallLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["status", "is_test", "provider"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AICallLog.objects.none()
        return AICallLog.objects.filter(user=self.request.user).select_related("provider")


class GlobalAutomationToggleView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, summary="Toggle global automation & AI switches")
    def post(self, request):
        user = request.user
        if "global_automation_enabled" in request.data:
            user.global_automation_enabled = bool(request.data["global_automation_enabled"])
        if "global_ai_enabled" in request.data:
            user.global_ai_enabled = bool(request.data["global_ai_enabled"])
        user.save(update_fields=["global_automation_enabled", "global_ai_enabled", "updated_at"])
        record_audit_event(
            user=user,
            event_type="automation.global_toggled",
            summary=f"Updated global automation={user.global_automation_enabled}, AI={user.global_ai_enabled}",
            request=request,
        )
        return Response(
            {
                "global_automation_enabled": user.global_automation_enabled,
                "global_ai_enabled": user.global_ai_enabled,
            }
        )
