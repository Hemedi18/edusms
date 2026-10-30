from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import ContactGroupViewSet, ContactViewSet, SuppressionRecordViewSet

router = DefaultRouter()
router.register(r"contacts", ContactViewSet, basename="contact")
router.register(r"groups", ContactGroupViewSet, basename="contact-group")
router.register(r"suppressions", SuppressionRecordViewSet, basename="suppression")

urlpatterns = [
    path("", include(router.urls)),
]
