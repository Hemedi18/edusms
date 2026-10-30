from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView


def health_view(_request):
    return JsonResponse({"status": "ok", "service": "edusms-backend", "api_version": "v1"})


urlpatterns = [
    path("health/", health_view, name="health"),
    path("admin/", admin.site.urls),
    # OpenAPI 3 Schema & Interactive Docs
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    # Versioned v1 Functional API Groups
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/devices/", include("apps.devices.urls")),
    path("api/v1/", include("apps.contacts.urls")),
    path("api/v1/", include("apps.messaging.urls")),
    path("api/v1/automation/", include("apps.automation.urls")),
    path("api/v1/campaigns/", include("apps.campaigns.urls")),
    path("api/v1/developers/", include("apps.developers.urls")),
    path("api/v1/analytics/", include("apps.analytics.urls")),
    path("api/v1/", include("apps.core.urls")),
]
