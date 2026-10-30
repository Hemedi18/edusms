from django.urls import path
from .views import (
    ActiveSupportThreadView,
    AuditEventListView,
    ErrorReportDetailView,
    ErrorReportListCreateView,
    GitHubPushWebhookView,
    NotificationListView,
    NotificationMarkAllReadView,
    NotificationMarkReadView,
    ServerOpsCpanelProvisionView,
    ServerOpsGitSyncView,
    ServerOpsStatusView,
    SupportInboundEmailReplyWebhookView,
    SupportThreadDetailView,
    SupportThreadListView,
    SupportThreadSendMessageView,
)

urlpatterns = [
    path("notifications/", NotificationListView.as_view(), name="notification-list"),
    path("notifications/mark-all-read/", NotificationMarkAllReadView.as_view(), name="notification-mark-all-read"),
    path("notifications/<uuid:pk>/read/", NotificationMarkReadView.as_view(), name="notification-mark-read"),
    path("audit-events/", AuditEventListView.as_view(), name="audit-event-list"),
    # Automatic & Manual Error Reporting
    path("support/errors/", ErrorReportListCreateView.as_view(), name="support-error-list-create"),
    path("support/errors/<uuid:pk>/", ErrorReportDetailView.as_view(), name="support-error-detail"),
    # Instant Help, AI Assistant & Live Customer Support Chat
    path("support/threads/", SupportThreadListView.as_view(), name="support-thread-list"),
    path("support/threads/active/", ActiveSupportThreadView.as_view(), name="support-thread-active"),
    path("support/threads/<uuid:pk>/", SupportThreadDetailView.as_view(), name="support-thread-detail"),
    path("support/threads/<uuid:pk>/messages/", SupportThreadSendMessageView.as_view(), name="support-thread-messages"),
    path(
        "support/email-reply-webhook/",
        SupportInboundEmailReplyWebhookView.as_view(),
        name="support-email-reply-webhook",
    ),
    # Server Hosting (`edusms.edusphere.co.tz`), cPanel UAPI & GitHub Auto-Sync (`Hemedi18/edusms`)
    path("ops/status/", ServerOpsStatusView.as_view(), name="ops-status"),
    path("ops/cpanel/provision/", ServerOpsCpanelProvisionView.as_view(), name="ops-cpanel-provision"),
    path("ops/git-sync/", ServerOpsGitSyncView.as_view(), name="ops-git-sync"),
    path("ops/github-webhook/", GitHubPushWebhookView.as_view(), name="ops-github-webhook"),
]
