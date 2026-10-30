from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    APIKeyViewSet,
    WebhookEndpointViewSet,
    WebhookEventViewSet,
    WebhookSignatureVerifyView,
)

router = DefaultRouter()
router.register(r"api-keys", APIKeyViewSet, basename="api-key")
router.register(r"webhooks", WebhookEndpointViewSet, basename="webhook-endpoint")
router.register(r"webhook-deliveries", WebhookEventViewSet, basename="webhook-event")

urlpatterns = [
    path("webhooks/verify-signature/", WebhookSignatureVerifyView.as_view(), name="webhook-verify-signature"),
    path("", include(router.urls)),
]
