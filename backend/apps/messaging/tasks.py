from __future__ import annotations

from datetime import timedelta
from celery import shared_task
from django.utils import timezone
from .models import Message
from .services import _log_delivery_event


@shared_task(name="apps.messaging.tasks.expire_stale_messages")
def expire_stale_messages() -> int:
    now = timezone.now()
    stale = list(
        Message.objects.filter(
            is_simulation=False,
            status=Message.Status.QUEUED,
            expires_at__lte=now,
        )
    )
    for msg in stale:
        msg.status = Message.Status.EXPIRED
        msg.failure_code = "JOB_EXPIRED"
        msg.failure_reason = "Message expired in queue before gateway connected."
        msg.save(update_fields=["status", "failure_code", "failure_reason", "updated_at"])
        _log_delivery_event(msg, "expired", msg.failure_reason, raw_status_code="JOB_EXPIRED")
    return len(stale)


@shared_task(name="apps.messaging.tasks.purge_expired_retention_messages")
def purge_expired_retention_messages() -> int:
    from apps.accounts.models import User

    total_deleted = 0
    now = timezone.now()
    for user in User.objects.filter(is_active=True):
        if user.message_retention_days and user.message_retention_days > 0:
            cutoff = now - timedelta(days=user.message_retention_days)
            deleted, _ = Message.objects.filter(user=user, created_at__lt=cutoff).delete()
            total_deleted += deleted
    return total_deleted
