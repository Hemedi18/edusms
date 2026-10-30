from __future__ import annotations

from datetime import timedelta
from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.core.realtime import broadcast_account_event
from .models import Device, GatewaySession


@shared_task(name="apps.devices.tasks.mark_stale_gateways_offline")
def mark_stale_gateways_offline() -> int:
    threshold = timezone.now() - timedelta(seconds=getattr(settings, "GATEWAY_ONLINE_THRESHOLD_SECONDS", 90))
    stale_devices = list(
        Device.objects.filter(
            revoked_at__isnull=True,
            connection_status=Device.ConnectionStatus.ONLINE,
            last_heartbeat_at__lt=threshold,
        ).select_related("user")
    )
    count = 0
    for device in stale_devices:
        device.connection_status = Device.ConnectionStatus.OFFLINE
        device.append_event("gateway.offline", "Heartbeat timed out; gateway marked offline.")
        device.recommended_action = "Open EduSMS on your Android phone and verify network connectivity & battery optimization settings."
        device.save(update_fields=["connection_status", "recent_events", "recommended_action", "updated_at"])
        GatewaySession.objects.filter(device=device, ended_at__isnull=True).update(ended_at=timezone.now())
        broadcast_account_event(
            device.user_id,
            "device.status",
            {"device_id": str(device.id), "connection_status": device.connection_status, "is_online": False},
        )
        from apps.developers.services import emit_webhook_event

        emit_webhook_event(
            user=device.user,
            event_type="device.disconnected",
            data={
                "device_id": str(device.id),
                "device_name": device.name,
                "last_heartbeat_at": device.last_heartbeat_at.isoformat() if device.last_heartbeat_at else None,
            },
        )
        count += 1
    return count
