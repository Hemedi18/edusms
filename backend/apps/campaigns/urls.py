from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import BulkCampaignViewSet

router = DefaultRouter()
router.register(r"", BulkCampaignViewSet, basename="campaign")

urlpatterns = [
    path("", include(router.urls)),
]
