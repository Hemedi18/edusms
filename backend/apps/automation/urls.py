from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    AICallLogListView,
    AIProviderConfigViewSet,
    AutoReplyRuleViewSet,
    AutomationModeViewSet,
    GlobalAutomationToggleView,
    RulePreviewTestView,
    ScheduleValidateView,
    ScheduleWindowViewSet,
)

router = DefaultRouter()
router.register(r"modes", AutomationModeViewSet, basename="automation-mode")
router.register(r"rules", AutoReplyRuleViewSet, basename="auto-reply-rule")
router.register(r"schedules", ScheduleWindowViewSet, basename="schedule-window")
router.register(r"ai-providers", AIProviderConfigViewSet, basename="ai-provider")

urlpatterns = [
    path("rules/test/", RulePreviewTestView.as_view(), name="rule-preview-test"),
    path("schedules/validate/", ScheduleValidateView.as_view(), name="schedule-validate"),
    path("ai-logs/", AICallLogListView.as_view(), name="ai-call-logs"),
    path("global-toggle/", GlobalAutomationToggleView.as_view(), name="automation-global-toggle"),
    path("", include(router.urls)),
]
