from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    DeviceViewSet,
    GatewayAckJobView,
    GatewayHeartbeatView,
    GatewayInboundSyncView,
    GatewayPollJobsView,
    GatewayStatusCallbackView,
    PairingConfirmView,
    PairingInitView,
)

router = DefaultRouter()
router.register(r"", DeviceViewSet, basename="device")

urlpatterns = [
    path("pair/init/", PairingInitView.as_view(), name="device-pair-init"),
    path("pair/confirm/", PairingConfirmView.as_view(), name="device-pair-confirm"),
    path("gateway/heartbeat/", GatewayHeartbeatView.as_view(), name="gateway-heartbeat"),
    path("gateway/jobs/poll/", GatewayPollJobsView.as_view(), name="gateway-poll-jobs"),
    path("gateway/jobs/<uuid:attempt_id>/ack/", GatewayAckJobView.as_view(), name="gateway-ack-job"),
    path("gateway/inbound/", GatewayInboundSyncView.as_view(), name="gateway-inbound"),
    path("gateway/status-callback/", GatewayStatusCallbackView.as_view(), name="gateway-status-callback"),
    path("", include(router.urls)),
]
