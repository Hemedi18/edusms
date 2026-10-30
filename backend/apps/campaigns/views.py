from __future__ import annotations

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.services import (
    check_idempotency,
    extract_idempotency_key,
    record_audit_event,
    save_idempotency,
)
from apps.developers.permissions import HasAPIKeyScopeOrJWT
from apps.messaging.services import submit_outbound_message
from .models import BulkCampaign, CampaignRecipient
from .services import (
    build_campaign_audience_preview,
    cancel_campaign,
    compute_campaign_stats,
    create_campaign_with_recipients,
    export_campaign_report_csv,
    process_campaign_batch,
)
from .tasks import run_campaign_worker


class CampaignRecipientSerializer(serializers.ModelSerializer):
    class Meta:
        model = CampaignRecipient
        fields = [
            "id",
            "contact",
            "message",
            "phone_number",
            "recipient_name",
            "rendered_body",
            "status",
            "exclusion_reason",
            "error_detail",
            "attempts_count",
            "processed_at",
            "delivered_at",
        ]


class BulkCampaignSerializer(serializers.ModelSerializer):
    stats = serializers.SerializerMethodField()
    contact_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)
    group_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)
    raw_numbers = serializers.ListField(child=serializers.CharField(), write_only=True, required=False)
    csv_text = serializers.CharField(write_only=True, required=False, allow_blank=True, default="")

    class Meta:
        model = BulkCampaign
        fields = [
            "id",
            "name",
            "message_template",
            "transport_type",
            "is_simulation",
            "device",
            "sender_identity",
            "sim_slot",
            "status",
            "timezone",
            "scheduled_at",
            "expires_at",
            "inter_message_interval_ms",
            "max_volume",
            "recipient_cooldown_minutes",
            "operating_window_start",
            "operating_window_end",
            "quiet_hours_start",
            "quiet_hours_end",
            "max_retries",
            "error_pause_threshold_pct",
            "simulated_outcome",
            "pause_reason",
            "started_at",
            "completed_at",
            "canceled_at",
            "created_at",
            "stats",
            "contact_ids",
            "group_ids",
            "raw_numbers",
            "csv_text",
        ]
        read_only_fields = [
            "id",
            "is_simulation",
            "status",
            "pause_reason",
            "started_at",
            "completed_at",
            "canceled_at",
            "created_at",
            "stats",
        ]

    def get_stats(self, obj: BulkCampaign) -> dict:
        return compute_campaign_stats(obj)


class BulkCampaignViewSet(viewsets.ModelViewSet):
    queryset = BulkCampaign.objects.none()
    serializer_class = BulkCampaignSerializer
    permission_classes = [HasAPIKeyScopeOrJWT]
    required_scopes_by_method = {
        "GET": "campaigns:read",
        "POST": "campaigns:write",
    }
    http_method_names = ["get", "post", "delete", "head", "options"]
    filterset_fields = ["status", "transport_type", "is_simulation"]
    search_fields = ["name", "message_template"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return BulkCampaign.objects.none()
        return BulkCampaign.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        idem_key = extract_idempotency_key(request)
        cached_resp = check_idempotency(request.user, idem_key, "campaigns.create", request.data)
        if cached_resp is not None:
            return cached_resp

        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = dict(ser.validated_data)
        contact_ids = [str(x) for x in v.pop("contact_ids", [])]
        group_ids = [str(x) for x in v.pop("group_ids", [])]
        raw_numbers = v.pop("raw_numbers", [])
        csv_text = v.pop("csv_text", "")

        campaign = create_campaign_with_recipients(
            user=request.user,
            validated_data=v,
            contact_ids=contact_ids,
            group_ids=group_ids,
            raw_numbers=raw_numbers,
            csv_text=csv_text,
        )
        out = BulkCampaignSerializer(campaign, context={"request": request}).data
        save_idempotency(request.user, idem_key, "campaigns.create", request.data, out, status.HTTP_201_CREATED)
        record_audit_event(
            user=request.user,
            event_type="campaign.created",
            summary=f"Created campaign '{campaign.name}' ({campaign.transport_type})",
            request=request,
            target_type="BulkCampaign",
            target_id=str(campaign.id),
        )
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="preview-audience")
    def preview_audience(self, request):
        transport_type = request.data.get("transport_type", BulkCampaign.TransportType.SIMULATION)
        res = build_campaign_audience_preview(
            user=request.user,
            message_template=request.data.get("message_template", "Hello {{contact_name}}"),
            contact_ids=request.data.get("contact_ids") or [],
            group_ids=request.data.get("group_ids") or [],
            raw_numbers=request.data.get("raw_numbers") or [],
            csv_text=request.data.get("csv_text") or "",
            max_volume=int(request.data.get("max_volume") or 1000),
            is_simulation=(transport_type == BulkCampaign.TransportType.SIMULATION),
        )
        return Response(
            {
                "total_input_count": res["total_input_count"],
                "duplicate_removed_count": res["duplicate_removed_count"],
                "eligible_count": res["eligible_count"],
                "excluded_count": res["excluded_count"],
                "sample_preview": res["sample_preview"],
                "excluded_preview": [
                    {"phone_number": e["phone_number"], "name": e["name"], "reason": e["reason"]}
                    for e in res["excluded"][:50]
                ],
                "eligible_preview": [
                    {"phone_number": e["phone_number"], "name": e["name"], "rendered_body": e["rendered_body"]}
                    for e in res["eligible"][:25]
                ],
            }
        )

    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        campaign = self.get_object()
        stats = compute_campaign_stats(campaign)
        warnings = []
        if not campaign.is_simulation and campaign.device and not campaign.device.is_online:
            warnings.append("Selected Android gateway is currently offline; messages will wait in queue until expiry.")
        if stats["eligible_recipients"] == 0:
            warnings.append("Campaign has 0 eligible recipients after opt-out/suppression/consent checks.")
        return Response(
            {
                "valid": stats["eligible_recipients"] > 0,
                "stats": stats,
                "warnings": warnings,
            }
        )

    @action(detail=True, methods=["post"], url_path="test-send")
    def test_send(self, request, pk=None):
        campaign = self.get_object()
        test_number = request.data.get("recipient_number") or ""
        if not test_number:
            raise ValidationError({"recipient_number": "Explicit test recipient phone number is required."})
        msg = submit_outbound_message(
            user=request.user,
            recipient_number=test_number,
            body=campaign.message_template,
            transport_type=campaign.transport_type,
            device_id=str(campaign.device_id) if campaign.device_id else None,
            sim_slot=campaign.sim_slot,
            simulated_outcome=campaign.simulated_outcome,
        )
        return Response({"test_message_id": str(msg.id), "status": msg.status, "is_simulation": msg.is_simulation})

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def start(self, request, pk=None):
        campaign = BulkCampaign.objects.select_for_update().get(pk=self.get_object().pk)
        if campaign.status not in {BulkCampaign.Status.DRAFT, BulkCampaign.Status.SCHEDULED, BulkCampaign.Status.PAUSED}:
            raise ValidationError({"detail": f"Cannot start campaign from status '{campaign.status}'."})

        now = timezone.now()
        scheduled_at = request.data.get("scheduled_at")
        if scheduled_at:
            from django.utils.dateparse import parse_datetime

            parsed_dt = parse_datetime(str(scheduled_at))
            if parsed_dt and parsed_dt > now:
                campaign.scheduled_at = parsed_dt
                campaign.status = BulkCampaign.Status.SCHEDULED
                campaign.save(update_fields=["scheduled_at", "status", "updated_at"])
                return Response(BulkCampaignSerializer(campaign).data)

        if campaign.scheduled_at and campaign.scheduled_at > now and not request.data.get("send_now"):
            campaign.status = BulkCampaign.Status.SCHEDULED
            campaign.save(update_fields=["status", "updated_at"])
            return Response(BulkCampaignSerializer(campaign).data)

        campaign.status = BulkCampaign.Status.RUNNING
        campaign.started_at = campaign.started_at or now
        campaign.pause_reason = ""
        campaign.save(update_fields=["status", "started_at", "pause_reason", "updated_at"])

        from apps.developers.services import emit_webhook_event

        emit_webhook_event(
            user=request.user,
            event_type="campaign.started",
            data={"campaign_id": str(campaign.id), "name": campaign.name, "simulation": campaign.is_simulation},
            is_simulation=campaign.is_simulation,
        )

        batch_size = int(request.data.get("batch_size") or 50)
        process_campaign_batch(str(campaign.id), batch_size=batch_size)
        try:
            campaign.refresh_from_db()
            if campaign.status == BulkCampaign.Status.RUNNING and campaign.recipients.filter(status="pending").exists():
                run_campaign_worker.delay(str(campaign.id), 25)
        except Exception:
            pass

        campaign.refresh_from_db()
        return Response(BulkCampaignSerializer(campaign).data)

    @action(detail=True, methods=["post"], url_path="process-batch")
    def process_batch(self, request, pk=None):
        campaign = self.get_object()
        batch_size = max(1, min(100, int(request.data.get("batch_size") or 25)))
        res = process_campaign_batch(str(campaign.id), batch_size=batch_size)
        campaign.refresh_from_db()
        return Response({"batch_result": res, "campaign": BulkCampaignSerializer(campaign).data})

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        campaign = self.get_object()
        if campaign.status not in {BulkCampaign.Status.RUNNING, BulkCampaign.Status.SCHEDULED}:
            raise ValidationError({"detail": f"Cannot pause campaign in status '{campaign.status}'."})
        campaign.status = BulkCampaign.Status.PAUSED
        campaign.pause_reason = request.data.get("reason", "Paused manually by user")[:255]
        campaign.save(update_fields=["status", "pause_reason", "updated_at"])
        return Response(BulkCampaignSerializer(campaign).data)

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        campaign = self.get_object()
        if campaign.status != BulkCampaign.Status.PAUSED:
            raise ValidationError({"detail": "Only paused campaigns can be resumed."})
        campaign.status = BulkCampaign.Status.RUNNING
        campaign.pause_reason = ""
        campaign.save(update_fields=["status", "pause_reason", "updated_at"])
        batch_size = int(request.data.get("batch_size") or 25)
        process_campaign_batch(str(campaign.id), batch_size=batch_size)
        campaign.refresh_from_db()
        return Response(BulkCampaignSerializer(campaign).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        campaign = cancel_campaign(self.get_object())
        record_audit_event(
            user=request.user,
            event_type="campaign.canceled",
            summary=f"Canceled campaign '{campaign.name}' and halted remaining recipients",
            request=request,
            target_type="BulkCampaign",
            target_id=str(campaign.id),
        )
        return Response(BulkCampaignSerializer(campaign).data)

    @action(detail=True, methods=["get"])
    def recipients(self, request, pk=None):
        campaign = self.get_object()
        qs = campaign.recipients.all()
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(CampaignRecipientSerializer(page, many=True).data)
        return Response(CampaignRecipientSerializer(qs, many=True).data)

    @action(detail=True, methods=["get"], url_path="export-csv")
    def export_csv(self, request, pk=None):
        campaign = self.get_object()
        csv_data = export_campaign_report_csv(campaign)
        resp = HttpResponse(csv_data, content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="campaign_{campaign.id}_report.csv"'
        return resp
