from __future__ import annotations

import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

logger = logging.getLogger(__name__)


def account_group_name(user_id) -> str:
    return f"account_{str(user_id).replace('-', '')}"


def broadcast_account_event(user_id, event_type: str, payload: dict) -> None:
    """
    Best-effort realtime WebSocket broadcast to connected dashboard/mobile clients.
    Core correctness NEVER depends on WebSocket delivery.
    """
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(
            account_group_name(user_id),
            {
                "type": "account.event",
                "event_type": event_type,
                "timestamp": timezone.now().isoformat(),
                "data": payload,
            },
        )
    except Exception as exc:
        logger.debug("Realtime broadcast skipped (%s): %s", event_type, exc)
