from __future__ import annotations

from celery import shared_task
from django.utils import timezone
from .models import BulkCampaign
from .services import process_campaign_batch


@shared_task(name="apps.campaigns.tasks.run_campaign_worker", bind=True, max_retries=3)
def run_campaign_worker(self, campaign_id: str, batch_size: int = 25) -> dict:
    res = process_campaign_batch(campaign_id=campaign_id, batch_size=batch_size)
    campaign = BulkCampaign.objects.filter(id=campaign_id).first()
    if campaign and campaign.status == BulkCampaign.Status.RUNNING:
        pending_exists = campaign.recipients.filter(status="pending").exists()
        if pending_exists and not res.get("deferred_reason"):
            delay_sec = max(1.0, (campaign.inter_message_interval_ms or 1000) / 1000.0)
            run_campaign_worker.apply_async(args=[campaign_id, batch_size], countdown=delay_sec)
    return res


@shared_task(name="apps.campaigns.tasks.process_due_campaigns")
def process_due_campaigns() -> int:
    now = timezone.now()
    due_scheduled = list(
        BulkCampaign.objects.filter(
            status=BulkCampaign.Status.SCHEDULED,
            scheduled_at__lte=now,
        )
    )
    count = 0
    for camp in due_scheduled:
        camp.status = BulkCampaign.Status.RUNNING
        camp.started_at = camp.started_at or now
        camp.save(update_fields=["status", "started_at", "updated_at"])
        process_campaign_batch(str(camp.id), batch_size=25)
        count += 1

    for running in BulkCampaign.objects.filter(status=BulkCampaign.Status.RUNNING):
        if running.recipients.filter(status="pending").exists():
            process_campaign_batch(str(running.id), batch_size=25)
            count += 1
    return count
