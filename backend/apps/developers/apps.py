from django.apps import AppConfig


class DevelopersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.developers"
    verbose_name = "Developer API Keys & Outbound Webhooks"
