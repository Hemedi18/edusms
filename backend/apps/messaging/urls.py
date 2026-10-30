from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    MessageViewSet,
    SenderIdentityViewSet,
    SimulationInjectInboundView,
    SimulationResetView,
    SimulationSeedDemoView,
)

router = DefaultRouter()
router.register(r"messages", MessageViewSet, basename="message")
router.register(r"sender-identities", SenderIdentityViewSet, basename="sender-identity")

urlpatterns = [
    path("", include(router.urls)),
    path("simulation/inject-inbound/", SimulationInjectInboundView.as_view(), name="simulation-inject-inbound"),
    path("simulation/seed-demo/", SimulationSeedDemoView.as_view(), name="simulation-seed-demo"),
    path("simulation/reset/", SimulationResetView.as_view(), name="simulation-reset"),
]
