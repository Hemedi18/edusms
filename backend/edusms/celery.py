import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "edusms.settings")

app = Celery("edusms")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    "dispatch-due-campaigns-every-15s": {
        "task": "apps.campaigns.tasks.process_due_campaigns",
        "schedule": 15.0,
    },
    "expire-stale-jobs-every-60s": {
        "task": "apps.messaging.tasks.expire_stale_messages",
        "schedule": 60.0,
    },
    "check-offline-gateways-every-60s": {
        "task": "apps.devices.tasks.mark_stale_gateways_offline",
        "schedule": 60.0,
    },
    "enforce-message-retention-daily": {
        "task": "apps.messaging.tasks.purge_expired_retention_messages",
        "schedule": crontab(hour=3, minute=15),
    },
}
