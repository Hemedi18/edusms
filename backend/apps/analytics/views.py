from __future__ import annotations

from datetime import timedelta
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.automation.models import AICallLog, AutoReplyRule, AutomationMode
from apps.campaigns.models import BulkCampaign
from apps.contacts.models import Contact, ContactGroup, SuppressionRecord
from apps.developers.models import WebhookEvent
from apps.developers.permissions import HasAPIKeyScopeOrJWT
from apps.devices.models import Device
from apps.messaging.models import Message


class AnalyticsOverviewView(APIView):
    permission_classes = [HasAPIKeyScopeOrJWT]
    required_scopes_by_method = {"GET": "analytics:read"}

    @extend_schema(responses={200: OpenApiTypes.OBJECT}, summary="Account analytics & time-series overview")
    def get(self, request):
        user = request.user
        days = max(1, min(90, int(request.query_params.get("days", 14))))
        since = timezone.now() - timedelta(days=days)

        msgs = Message.objects.filter(user=user, created_at__gte=since)
        real_msgs = msgs.filter(is_simulation=False)
        sim_msgs = msgs.filter(is_simulation=True)

        status_breakdown = list(
            msgs.values("status", "is_simulation").annotate(count=Count("id")).order_by("-count")
        )
        direction_breakdown = list(
            msgs.values("direction", "is_simulation").annotate(count=Count("id"))
        )

        # Daily time-series over the requested window
        daily_rows = list(
            msgs.annotate(day=TruncDate("created_at"))
            .values("day", "direction", "is_simulation")
            .annotate(count=Count("id"))
            .order_by("day")
        )
        day_map: dict[str, dict] = {}
        for i in range(days + 1):
            d_str = (since + timedelta(days=i)).date().isoformat()
            day_map[d_str] = {
                "date": d_str,
                "real_outbound": 0,
                "real_inbound": 0,
                "sim_outbound": 0,
                "sim_inbound": 0,
            }
        for row in daily_rows:
            d_str = row["day"].isoformat() if row["day"] else None
            if d_str and d_str in day_map:
                key = ("sim_" if row["is_simulation"] else "real_") + row["direction"]
                if key in day_map[d_str]:
                    day_map[d_str][key] += row["count"]

        devices = Device.objects.filter(user=user, revoked_at__isnull=True)
        online_devices = sum(1 for d in devices if d.is_online)
        active_mode = AutomationMode.objects.filter(user=user, is_active=True).first()

        ai_logs = AICallLog.objects.filter(user=user, created_at__gte=since)
        ai_errors = ai_logs.filter(status__in=[AICallLog.Status.ERROR, AICallLog.Status.TIMEOUT, AICallLog.Status.FALLBACK_USED]).count()

        campaigns = BulkCampaign.objects.filter(user=user)
        webhook_events = WebhookEvent.objects.filter(user=user, created_at__gte=since)

        return Response(
            {
                "window_days": days,
                "gateway_summary": {
                    "paired_devices": devices.count(),
                    "online_devices": online_devices,
                    "sim_ready_devices": devices.filter(sim_available=True, is_enabled=True, is_paused=False).count(),
                },
                "message_summary": {
                    "real_outbound_submitted": real_msgs.filter(
                        direction="outbound", status__in=["submitted", "delivered", "delivery_unknown"]
                    ).count(),
                    "real_outbound_delivered_confirmed": real_msgs.filter(direction="outbound", status="delivered").count(),
                    "real_outbound_queued": real_msgs.filter(
                        direction="outbound", status__in=["queued", "dispatched_to_device"]
                    ).count(),
                    "real_outbound_failed": real_msgs.filter(direction="outbound", status="failed").count(),
                    "real_inbound_received": real_msgs.filter(direction="inbound").count(),
                    "simulated_outbound": sim_msgs.filter(direction="outbound").count(),
                    "simulated_inbound": sim_msgs.filter(direction="inbound").count(),
                    "pending_human_approval": Message.objects.filter(user=user, status="pending_approval").count(),
                },
                "contacts_summary": {
                    "total_contacts": Contact.objects.filter(user=user).count(),
                    "opted_in_contacts": Contact.objects.filter(user=user, opt_in_status=True, opt_out_status=False).count(),
                    "suppressed_or_opted_out": SuppressionRecord.objects.filter(user=user).count(),
                    "groups_count": ContactGroup.objects.filter(user=user).count(),
                },
                "automation_summary": {
                    "global_automation_enabled": user.global_automation_enabled,
                    "global_ai_enabled": user.global_ai_enabled,
                    "active_mode": active_mode.name if active_mode else "Default",
                    "enabled_rules_count": AutoReplyRule.objects.filter(user=user, is_enabled=True).count(),
                    "total_rule_hits": AutoReplyRule.objects.filter(user=user).aggregate(s=Sum("hit_count"))["s"] or 0,
                    "auto_replies_sent": msgs.filter(is_auto_reply=True).count(),
                    "ai_calls_count": ai_logs.count(),
                    "ai_errors_or_fallbacks": ai_errors,
                },
                "campaigns_summary": {
                    "total_campaigns": campaigns.count(),
                    "running_campaigns": campaigns.filter(status="running").count(),
                    "completed_campaigns": campaigns.filter(status="completed").count(),
                    "paused_or_scheduled": campaigns.filter(status__in=["paused", "scheduled"]).count(),
                },
                "webhooks_summary": {
                    "delivered": webhook_events.filter(status="delivered").count(),
                    "retrying": webhook_events.filter(status="retrying").count(),
                    "dead_letter": webhook_events.filter(status="dead_letter").count(),
                },
                "status_breakdown": status_breakdown,
                "direction_breakdown": direction_breakdown,
                "timeseries": list(day_map.values()),
            }
        )
